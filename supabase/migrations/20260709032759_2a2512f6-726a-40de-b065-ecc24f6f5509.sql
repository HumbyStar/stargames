
REVOKE EXECUTE ON FUNCTION public.can_view_team_tasks(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_assign_to(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_any_internal_role(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_notion_html_originals(uuid) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_view_team_tasks(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_assign_to(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_internal_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_notion_html_originals(uuid) TO authenticated, service_role;
