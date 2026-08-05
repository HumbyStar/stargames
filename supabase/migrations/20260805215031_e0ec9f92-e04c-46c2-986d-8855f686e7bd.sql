CREATE OR REPLACE FUNCTION public.count_env_rows(_table text, _env public.app_env, _owner uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count bigint;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_internal_role(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _env = 'sandbox'::public.app_env AND (_owner IS NULL OR _owner <> v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _table = 'clients' THEN
    SELECT count(*) INTO v_count FROM public.clients
      WHERE env = _env AND (_env <> 'sandbox'::public.app_env OR sandbox_owner = _owner);
  ELSIF _table = 'clients_mgmv' THEN
    SELECT count(*) INTO v_count FROM public.clients
      WHERE env = _env AND client_type = 'mgmv'
        AND (_env <> 'sandbox'::public.app_env OR sandbox_owner = _owner);
  ELSIF _table = 'products' THEN
    SELECT count(*) INTO v_count FROM public.products
      WHERE env = _env AND (_env <> 'sandbox'::public.app_env OR sandbox_owner = _owner);
  ELSIF _table = 'products_orphan_mgmv' THEN
    SELECT count(*) INTO v_count FROM public.products
      WHERE env = _env AND included_in_mgmv = true AND mgmv_agreement_id IS NULL
        AND (_env <> 'sandbox'::public.app_env OR sandbox_owner = _owner);
  ELSIF _table = 'mgmv_agreements' THEN
    SELECT count(*) INTO v_count FROM public.mgmv_agreements
      WHERE env = _env AND (_env <> 'sandbox'::public.app_env OR sandbox_owner = _owner);
  ELSIF _table = 'mgmv_installments' THEN
    SELECT count(*) INTO v_count FROM public.mgmv_installments
      WHERE env = _env AND (_env <> 'sandbox'::public.app_env OR sandbox_owner = _owner);
  ELSE
    RAISE EXCEPTION 'invalid table: %', _table USING ERRCODE = '22023';
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.count_env_rows(text, public.app_env, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_env_rows(text, public.app_env, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_env_rows(text, public.app_env, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_env_rows(text, public.app_env, uuid) TO service_role;