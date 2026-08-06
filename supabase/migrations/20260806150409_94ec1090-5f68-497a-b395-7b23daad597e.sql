-- 1) Tabela de catálogo de NCM
CREATE TABLE public.product_ncm (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name_key text NOT NULL,
  platform_key text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL DEFAULT '',
  ncm text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  confidence numeric,
  rationale text,
  source text NOT NULL DEFAULT 'ai',
  status text NOT NULL DEFAULT 'ok',
  verified_at timestamptz,
  env public.app_env NOT NULL DEFAULT public.current_env(),
  sandbox_owner uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_ncm_unique_key
  ON public.product_ncm (env, COALESCE(sandbox_owner, '00000000-0000-0000-0000-000000000000'::uuid), name_key, platform_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_ncm TO authenticated;
GRANT ALL ON public.product_ncm TO service_role;

ALTER TABLE public.product_ncm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_ncm_select" ON public.product_ncm
  FOR SELECT TO authenticated
  USING (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "product_ncm_insert" ON public.product_ncm
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "product_ncm_update" ON public.product_ncm
  FOR UPDATE TO authenticated
  USING (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "product_ncm_delete" ON public.product_ncm
  FOR DELETE TO authenticated
  USING (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE TRIGGER product_ncm_sandbox_owner_guard
  BEFORE INSERT OR UPDATE ON public.product_ncm
  FOR EACH ROW EXECUTE FUNCTION public.sandbox_owner_guard();

CREATE TRIGGER product_ncm_touch
  BEFORE UPDATE ON public.product_ncm
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Índices auxiliares no products
CREATE INDEX IF NOT EXISTS products_env_owner_platform_idx
  ON public.products (env, sandbox_owner, platform);
CREATE INDEX IF NOT EXISTS products_env_owner_lower_name_idx
  ON public.products (env, sandbox_owner, lower(name));

-- 3) Catálogo agregado
CREATE OR REPLACE FUNCTION public.product_catalog(
  _search text DEFAULT '',
  _platform text DEFAULT '',
  _sort text DEFAULT 'name_asc',
  _page integer DEFAULT 1,
  _page_size integer DEFAULT 25,
  _only_missing_ncm boolean DEFAULT false
)
RETURNS TABLE(
  name text,
  platform text,
  total_qty bigint,
  paid_qty bigint,
  open_qty bigint,
  total_value numeric,
  paid_value numeric,
  ncm text,
  ncm_category text,
  ncm_source text,
  ncm_status text,
  ncm_confidence numeric,
  ncm_rationale text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env public.app_env;
  v_owner uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(_page_size, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE(_page, 1) - 1, 0) * v_limit;
  v_search text := COALESCE(NULLIF(btrim(_search), ''), NULL);
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_internal_role(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_env := public.current_env();
  v_owner := CASE WHEN v_env = 'sandbox'::public.app_env THEN v_uid ELSE NULL END;

  RETURN QUERY
  WITH agg AS (
    SELECT
      min(p.name) AS name,
      COALESCE(p.platform, '') AS platform,
      lower(btrim(p.name)) AS name_key,
      lower(btrim(COALESCE(p.platform, ''))) AS platform_key,
      count(*)::bigint AS total_qty,
      count(*) FILTER (WHERE p.financial_status = 'Pago')::bigint AS paid_qty,
      count(*) FILTER (WHERE p.financial_status <> 'Pago')::bigint AS open_qty,
      COALESCE(sum(p.total_value), 0)::numeric AS total_value,
      COALESCE(sum(p.total_value) FILTER (WHERE p.financial_status = 'Pago'), 0)::numeric AS paid_value
    FROM public.products p
    WHERE p.env = v_env
      AND (v_env <> 'sandbox'::public.app_env OR p.sandbox_owner = v_owner)
      AND (v_search IS NULL OR p.name ILIKE '%' || v_search || '%')
      AND (COALESCE(NULLIF(btrim(_platform), ''), '') = '' OR COALESCE(p.platform, '') = _platform)
    GROUP BY 2, 3, 4
  ),
  joined AS (
    SELECT a.*, n.ncm, n.category, n.source, n.status, n.confidence, n.rationale
    FROM agg a
    LEFT JOIN public.product_ncm n
      ON n.env = v_env
     AND (v_env <> 'sandbox'::public.app_env OR n.sandbox_owner = v_owner)
     AND n.name_key = a.name_key
     AND n.platform_key = a.platform_key
  ),
  filtered AS (
    SELECT * FROM joined j
    WHERE NOT COALESCE(_only_missing_ncm, false)
       OR j.ncm IS NULL OR j.ncm = ''
  ),
  counted AS (SELECT count(*)::bigint AS n FROM filtered)
  SELECT f.name, f.platform, f.total_qty, f.paid_qty, f.open_qty,
         f.total_value, f.paid_value,
         COALESCE(f.ncm, ''), COALESCE(f.category, ''), COALESCE(f.source, ''),
         COALESCE(f.status, ''), f.confidence, f.rationale,
         (SELECT n FROM counted)
  FROM filtered f
  ORDER BY
    CASE WHEN _sort = 'name_asc' THEN lower(f.name) END ASC,
    CASE WHEN _sort = 'name_desc' THEN lower(f.name) END DESC,
    CASE WHEN _sort = 'qty_desc' THEN f.total_qty END DESC,
    CASE WHEN _sort = 'paid_desc' THEN f.paid_qty END DESC,
    CASE WHEN _sort = 'value_desc' THEN f.total_value END DESC,
    lower(f.name) ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

-- 4) Relatórios
CREATE OR REPLACE FUNCTION public.product_reports(_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env public.app_env;
  v_owner uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_internal_role(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_env := public.current_env();
  v_owner := CASE WHEN v_env = 'sandbox'::public.app_env THEN v_uid ELSE NULL END;

  WITH base AS (
    SELECT COALESCE(NULLIF(btrim(p.platform), ''), 'Sem plataforma') AS platform,
           btrim(p.name) AS name,
           p.total_value,
           (p.financial_status = 'Pago') AS is_paid
    FROM public.products p
    WHERE p.env = v_env
      AND (v_env <> 'sandbox'::public.app_env OR p.sandbox_owner = v_owner)
  ),
  plat_paid AS (
    SELECT platform, count(*)::bigint qty, COALESCE(sum(total_value),0)::numeric value
    FROM base WHERE is_paid GROUP BY 1 ORDER BY qty DESC LIMIT v_limit
  ),
  plat_open AS (
    SELECT platform, count(*)::bigint qty, COALESCE(sum(total_value),0)::numeric value
    FROM base WHERE NOT is_paid GROUP BY 1 ORDER BY qty DESC LIMIT v_limit
  ),
  prod_paid AS (
    SELECT name, platform, count(*)::bigint qty, COALESCE(sum(total_value),0)::numeric value
    FROM base WHERE is_paid GROUP BY 1,2 ORDER BY qty DESC LIMIT v_limit
  ),
  prod_open AS (
    SELECT name, platform, count(*)::bigint qty, COALESCE(sum(total_value),0)::numeric value
    FROM base WHERE NOT is_paid GROUP BY 1,2 ORDER BY qty DESC LIMIT v_limit
  ),
  totals AS (
    SELECT count(*)::bigint AS total,
           count(*) FILTER (WHERE is_paid)::bigint AS paid,
           count(*) FILTER (WHERE NOT is_paid)::bigint AS open,
           COALESCE(sum(total_value),0)::numeric AS total_value,
           COALESCE(sum(total_value) FILTER (WHERE is_paid),0)::numeric AS paid_value
    FROM base
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'platformsPaid', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM plat_paid x), '[]'::jsonb),
    'platformsOpen', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM plat_open x), '[]'::jsonb),
    'productsPaid', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM prod_paid x), '[]'::jsonb),
    'productsOpen', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM prod_open x), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.product_catalog(text, text, text, integer, integer, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.product_reports(integer) FROM anon;