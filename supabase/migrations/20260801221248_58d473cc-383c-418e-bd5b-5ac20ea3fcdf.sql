REVOKE EXECUTE ON FUNCTION public.env_row_visible(public.app_env, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sandbox_owner_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.env_row_visible(public.app_env, uuid) TO authenticated, service_role;