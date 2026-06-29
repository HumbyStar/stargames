
-- Revoke broad execute from PUBLIC and anon on SECURITY DEFINER helpers,
-- keep EXECUTE for authenticated where required by RLS policies.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, app_permission) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, app_permission) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_view_team_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_team_tasks(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_assign_to(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_assign_to(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated, service_role;

-- audit_change is a trigger function; it should never be called directly via the API.
REVOKE EXECUTE ON FUNCTION public.audit_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_change() TO service_role;

-- touch_updated_at is also a trigger function only.
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO service_role;
