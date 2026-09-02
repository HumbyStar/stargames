-- ============ helper ============
CREATE OR REPLACE FUNCTION public.platform_norm_key(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(trim(regexp_replace(coalesce(_v,''), '\s+', ' ', 'g')))
$$;

REVOKE EXECUTE ON FUNCTION public.platform_norm_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_norm_key(text) TO authenticated, service_role;

-- ============ product_categories ============
CREATE TABLE public.product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  parent_id uuid REFERENCES public.product_categories(id) ON DELETE CASCADE,
  sort integer NOT NULL DEFAULT 0,
  env app_env NOT NULL DEFAULT current_env(),
  sandbox_owner uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_categories_select ON public.product_categories FOR SELECT TO authenticated
  USING (has_any_internal_role(auth.uid()) AND env_row_visible(env, sandbox_owner));
CREATE POLICY product_categories_insert ON public.product_categories FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner));
CREATE POLICY product_categories_update ON public.product_categories FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner))
  WITH CHECK (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner));
CREATE POLICY product_categories_delete ON public.product_categories FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner));

CREATE TRIGGER product_categories_sandbox_owner_guard BEFORE INSERT OR UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION sandbox_owner_guard();
CREATE TRIGGER product_categories_touch BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX product_categories_env_idx ON public.product_categories(env, sandbox_owner);
CREATE INDEX product_categories_parent_idx ON public.product_categories(parent_id);

-- ============ platform_categories ============
CREATE TABLE public.platform_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform_key text NOT NULL,
  platform text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE CASCADE,
  env app_env NOT NULL DEFAULT current_env(),
  sandbox_owner uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_categories TO authenticated;
GRANT ALL ON public.platform_categories TO service_role;

ALTER TABLE public.platform_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_categories_select ON public.platform_categories FOR SELECT TO authenticated
  USING (has_any_internal_role(auth.uid()) AND env_row_visible(env, sandbox_owner));
CREATE POLICY platform_categories_insert ON public.platform_categories FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner));
CREATE POLICY platform_categories_update ON public.platform_categories FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner))
  WITH CHECK (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner));
CREATE POLICY platform_categories_delete ON public.platform_categories FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'clientes.edit') AND env_row_visible(env, sandbox_owner));

CREATE TRIGGER platform_categories_sandbox_owner_guard BEFORE INSERT OR UPDATE ON public.platform_categories
  FOR EACH ROW EXECUTE FUNCTION sandbox_owner_guard();
CREATE TRIGGER platform_categories_touch BEFORE UPDATE ON public.platform_categories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE UNIQUE INDEX platform_categories_unique_idx
  ON public.platform_categories(platform_key, env, coalesce(sandbox_owner, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX platform_categories_category_idx ON public.platform_categories(category_id);

CREATE INDEX IF NOT EXISTS products_client_env_idx ON public.products(client_id, env);
CREATE INDEX IF NOT EXISTS products_platform_key_idx ON public.products(public.platform_norm_key(platform));

-- ============ seed inicial (produção) ============
DO $seed$
DECLARE
  v_brinq uuid; v_games uuid; v_outros uuid;
  v_figures uuid; v_pops uuid; v_action uuid; v_colec uuid;
  v_ps5 uuid; v_ps4 uuid; v_ps3 uuid; v_ps2 uuid; v_xbox uuid; v_nin uuid;
BEGIN
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Brinquedos', NULL, 1, 'producao') RETURNING id INTO v_brinq;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Games', NULL, 2, 'producao') RETURNING id INTO v_games;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Outros', NULL, 3, 'producao') RETURNING id INTO v_outros;

  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Figures', v_brinq, 1, 'producao') RETURNING id INTO v_figures;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Pops', v_brinq, 2, 'producao') RETURNING id INTO v_pops;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Action Figures', v_brinq, 3, 'producao') RETURNING id INTO v_action;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Colecionáveis', v_brinq, 4, 'producao') RETURNING id INTO v_colec;

  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('PS5', v_games, 1, 'producao') RETURNING id INTO v_ps5;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('PS4', v_games, 2, 'producao') RETURNING id INTO v_ps4;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('PS3', v_games, 3, 'producao') RETURNING id INTO v_ps3;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('PS2', v_games, 4, 'producao') RETURNING id INTO v_ps2;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Xbox', v_games, 5, 'producao') RETURNING id INTO v_xbox;
  INSERT INTO public.product_categories (name, parent_id, sort, env) VALUES ('Nintendo', v_games, 6, 'producao') RETURNING id INTO v_nin;

  INSERT INTO public.platform_categories (platform_key, platform, category_id, env)
  SELECT k, p, (CASE
      WHEN k LIKE '%action figure%' THEN v_action
      WHEN k LIKE '%pop%' THEN v_pops
      WHEN k LIKE '%figure%' OR k LIKE '%figura%' THEN v_figures
      WHEN k LIKE '%colecion%' THEN v_colec
      WHEN k LIKE '%ps5%' OR k LIKE '%playstation 5%' THEN v_ps5
      WHEN k LIKE '%ps4%' OR k LIKE '%playstation 4%' THEN v_ps4
      WHEN k LIKE '%ps3%' OR k LIKE '%playstation 3%' THEN v_ps3
      WHEN k LIKE '%ps2%' OR k LIKE '%playstation 2%' THEN v_ps2
      WHEN k LIKE '%xbox%' THEN v_xbox
      WHEN k LIKE '%nintendo%' OR k LIKE '%switch%' THEN v_nin
      WHEN k LIKE '%playstation%' THEN v_games
      ELSE v_outros
    END), 'producao'::app_env
  FROM (
    SELECT DISTINCT public.platform_norm_key(platform) AS k, min(platform) AS p
    FROM public.products WHERE env = 'producao' AND coalesce(platform,'') <> ''
    GROUP BY 1
  ) s
  WHERE k <> '' AND (
    k LIKE '%pop%' OR k LIKE '%figure%' OR k LIKE '%figura%' OR k LIKE '%colecion%'
    OR k LIKE '%ps5%' OR k LIKE '%ps4%' OR k LIKE '%ps3%' OR k LIKE '%ps2%'
    OR k LIKE '%playstation%' OR k LIKE '%xbox%' OR k LIKE '%nintendo%' OR k LIKE '%switch%'
  )
  ON CONFLICT DO NOTHING;
END
$seed$;

-- ============ segmentação ============
CREATE OR REPLACE FUNCTION public.segment_clients(
  _category_id uuid DEFAULT NULL,
  _platform text DEFAULT NULL,
  _min numeric DEFAULT 0,
  _max numeric DEFAULT NULL,
  _basis text DEFAULT 'total',
  _exclude_situations text[] DEFAULT ARRAY[]::text[],
  _sort text DEFAULT 'value_desc',
  _page integer DEFAULT 0,
  _page_size integer DEFAULT 20
)
RETURNS TABLE(
  client_id uuid, client_name text, phone text, customer_data text,
  products_count bigint, spent numeric,
  total_count bigint, group_total numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
BEGIN
  IF NOT has_any_internal_role(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito';
  END IF;

  RETURN QUERY
  WITH RECURSIVE tree AS (
    SELECT c.id FROM public.product_categories c WHERE _category_id IS NOT NULL AND c.id = _category_id
    UNION ALL
    SELECT c.id FROM public.product_categories c JOIN tree t ON c.parent_id = t.id
  ),
  valid AS (
    SELECT p.client_id AS cid,
           CASE _basis WHEN 'paid' THEN coalesce(p.paid_value,0) ELSE coalesce(p.total_value,0) END AS val
    FROM public.products p
    LEFT JOIN public.platform_categories pc
      ON pc.platform_key = public.platform_norm_key(p.platform)
     AND pc.env = p.env
     AND coalesce(pc.sandbox_owner,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p.sandbox_owner,'00000000-0000-0000-0000-000000000000'::uuid)
    WHERE (_category_id IS NULL OR pc.category_id IN (SELECT id FROM tree))
      AND (_platform IS NULL OR public.platform_norm_key(p.platform) = public.platform_norm_key(_platform))
      AND (_basis = 'total_all' OR coalesce(array_length(_exclude_situations,1),0) = 0
           OR lower(p.situation) <> ALL (SELECT lower(x) FROM unnest(_exclude_situations) x))
  ),
  agg AS (
    SELECT c.id AS cid, c.name, c.phone, c.customer_data,
           count(v.*) AS n, coalesce(sum(v.val),0) AS spent
    FROM public.clients c
    JOIN valid v ON v.cid = c.id
    GROUP BY c.id, c.name, c.phone, c.customer_data
  ),
  filtered AS (
    SELECT * FROM agg
    WHERE spent >= coalesce(_min,0) AND (_max IS NULL OR spent <= _max)
  ),
  totals AS (SELECT count(*) AS cnt, coalesce(sum(spent),0) AS sum_spent FROM filtered)
  SELECT f.cid, f.name, f.phone, f.customer_data, f.n, f.spent, t.cnt, t.sum_spent
  FROM filtered f CROSS JOIN totals t
  ORDER BY
    CASE WHEN _sort = 'value_desc' THEN f.spent END DESC NULLS LAST,
    CASE WHEN _sort = 'value_asc' THEN f.spent END ASC NULLS LAST,
    CASE WHEN _sort = 'count_desc' THEN f.n END DESC NULLS LAST,
    CASE WHEN _sort = 'count_asc' THEN f.n END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN lower(f.name) END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN lower(f.name) END DESC NULLS LAST,
    f.cid
  OFFSET greatest(coalesce(_page,0),0) * greatest(coalesce(_page_size,20),1)
  LIMIT greatest(coalesce(_page_size,20),1);
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.segment_clients(uuid,text,numeric,numeric,text,text[],text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.segment_clients(uuid,text,numeric,numeric,text,text[],text,integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.segment_client_products(
  _client_id uuid,
  _category_id uuid DEFAULT NULL,
  _platform text DEFAULT NULL,
  _basis text DEFAULT 'total',
  _exclude_situations text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE(
  id uuid, name text, platform text, category text,
  register_date timestamptz, situation text, financial_status text, value numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
BEGIN
  IF NOT has_any_internal_role(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito';
  END IF;

  RETURN QUERY
  WITH RECURSIVE tree AS (
    SELECT c.id FROM public.product_categories c WHERE _category_id IS NOT NULL AND c.id = _category_id
    UNION ALL
    SELECT c.id FROM public.product_categories c JOIN tree t ON c.parent_id = t.id
  )
  SELECT p.id, p.name, p.platform, coalesce(cat.name,'Sem categoria'),
         p.register_date, p.situation, p.financial_status,
         CASE _basis WHEN 'paid' THEN coalesce(p.paid_value,0) ELSE coalesce(p.total_value,0) END
  FROM public.products p
  LEFT JOIN public.platform_categories pc
    ON pc.platform_key = public.platform_norm_key(p.platform)
   AND pc.env = p.env
   AND coalesce(pc.sandbox_owner,'00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p.sandbox_owner,'00000000-0000-0000-0000-000000000000'::uuid)
  LEFT JOIN public.product_categories cat ON cat.id = pc.category_id
  WHERE p.client_id = _client_id
    AND (_category_id IS NULL OR pc.category_id IN (SELECT id FROM tree))
    AND (_platform IS NULL OR public.platform_norm_key(p.platform) = public.platform_norm_key(_platform))
    AND (_basis = 'total_all' OR coalesce(array_length(_exclude_situations,1),0) = 0
         OR lower(p.situation) <> ALL (SELECT lower(x) FROM unnest(_exclude_situations) x))
  ORDER BY p.register_date DESC;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.segment_client_products(uuid,uuid,text,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.segment_client_products(uuid,uuid,text,text,text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.segment_platform_stats()
RETURNS TABLE(platform_key text, platform text, products_count bigint, category_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
BEGIN
  IF NOT has_any_internal_role(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito';
  END IF;
  RETURN QUERY
  SELECT k.pk, k.pl, k.n, pc.category_id
  FROM (
    SELECT public.platform_norm_key(p.platform) AS pk, min(p.platform) AS pl, count(*) AS n
    FROM public.products p
    WHERE coalesce(p.platform,'') <> ''
    GROUP BY 1
  ) k
  LEFT JOIN public.platform_categories pc ON pc.platform_key = k.pk
  ORDER BY k.n DESC;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.segment_platform_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.segment_platform_stats() TO authenticated, service_role;
