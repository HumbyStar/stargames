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
    SELECT c.id AS cid, c.name AS cname, c.phone AS cphone, c.customer_data AS cdata,
           count(v.*) AS n, coalesce(sum(v.val),0) AS spent_v
    FROM public.clients c
    JOIN valid v ON v.cid = c.id
    GROUP BY c.id, c.name, c.phone, c.customer_data
  ),
  filtered AS (
    SELECT * FROM agg a
    WHERE a.spent_v >= coalesce(_min,0) AND (_max IS NULL OR a.spent_v <= _max)
  ),
  totals AS (SELECT count(*) AS cnt, coalesce(sum(f.spent_v),0) AS sum_spent FROM filtered f)
  SELECT f.cid, f.cname, f.cphone, f.cdata, f.n, f.spent_v, t.cnt, t.sum_spent
  FROM filtered f CROSS JOIN totals t
  ORDER BY
    CASE WHEN _sort = 'value_desc' THEN f.spent_v END DESC NULLS LAST,
    CASE WHEN _sort = 'value_asc' THEN f.spent_v END ASC NULLS LAST,
    CASE WHEN _sort = 'count_desc' THEN f.n END DESC NULLS LAST,
    CASE WHEN _sort = 'count_asc' THEN f.n END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN lower(f.cname) END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN lower(f.cname) END DESC NULLS LAST,
    f.cid
  OFFSET greatest(coalesce(_page,0),0) * greatest(coalesce(_page_size,20),1)
  LIMIT greatest(coalesce(_page_size,20),1);
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.segment_clients(uuid,text,numeric,numeric,text,text[],text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.segment_clients(uuid,text,numeric,numeric,text,text[],text,integer,integer) TO authenticated, service_role;