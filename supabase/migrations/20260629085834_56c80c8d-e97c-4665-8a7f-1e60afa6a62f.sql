-- Tighten EXECUTE on SECURITY DEFINER functions: revoke from PUBLIC,
-- grant only to the roles that actually need to call them.

-- RLS helpers — invoked during policy evaluation by signed-in users.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_permission(uuid, public.app_permission) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_view_team_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_team_tasks(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_assign_to(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_assign_to(uuid, uuid) TO authenticated, service_role;

-- User-initiated bootstrap — only signed-in users.
REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated, service_role;

-- Trigger functions — only the table owner / service role needs to call them;
-- triggers execute regardless of caller EXECUTE grants.
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.audit_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_change() TO service_role;