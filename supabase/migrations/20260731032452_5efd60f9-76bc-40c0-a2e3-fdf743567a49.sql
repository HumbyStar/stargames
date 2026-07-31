CREATE OR REPLACE FUNCTION public.export_db_schema_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'generatedAt', now(),
    'enums', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', t.typname, 'values', v.vals) ORDER BY t.typname), '[]'::jsonb)
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
       JOIN LATERAL (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) vals FROM pg_enum e WHERE e.enumtypid = t.oid) v ON true
       WHERE t.typtype = 'e'),
    'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name', c.relname,
          'columns', (SELECT jsonb_agg(jsonb_build_object(
               'name', a.attname,
               'type', format_type(a.atttypid, a.atttypmod),
               'notNull', a.attnotnull,
               'default', pg_get_expr(d.adbin, d.adrelid)
             ) ORDER BY a.attnum)
             FROM pg_attribute a
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
          'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', con.conname, 'type', con.contype, 'def', pg_get_constraintdef(con.oid)) ORDER BY con.contype DESC, con.conname), '[]'::jsonb)
             FROM pg_constraint con WHERE con.conrelid = c.oid),
          'indexes', (SELECT coalesce(jsonb_agg(i.indexdef ORDER BY i.indexname), '[]'::jsonb)
             FROM pg_indexes i
             WHERE i.schemaname = 'public' AND i.tablename = c.relname
               AND i.indexname NOT IN (SELECT con.conname FROM pg_constraint con WHERE con.conrelid = c.oid)),
          'rls', c.relrowsecurity,
          'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'name', p.polname, 'cmd', p.polcmd,
                'roles', (SELECT jsonb_agg(pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                'using', pg_get_expr(p.polqual, p.polrelid),
                'check', pg_get_expr(p.polwithcheck, p.polrelid)) ORDER BY p.polname), '[]'::jsonb)
             FROM pg_policy p WHERE p.polrelid = c.oid),
          'grants', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type)), '[]'::jsonb)
             FROM information_schema.role_table_grants g
             WHERE g.table_schema = 'public' AND g.table_name = c.relname
               AND g.grantee IN ('anon','authenticated','service_role')),
          'triggers', (SELECT coalesce(jsonb_agg(pg_get_triggerdef(tg.oid) ORDER BY tg.tgname), '[]'::jsonb)
             FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND NOT tg.tgisinternal)
        ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'),
    'functions', (SELECT coalesce(jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname), '[]'::jsonb)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
       WHERE p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'c'))
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.export_db_schema_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.export_db_schema_snapshot() FROM anon;
GRANT EXECUTE ON FUNCTION public.export_db_schema_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_db_schema_snapshot() TO service_role;