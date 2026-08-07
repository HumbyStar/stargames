REVOKE EXECUTE ON FUNCTION public.audit_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sandbox_owner_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.import_history_set_author() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_completed_mgmv_agreement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_completed_mgmv_client() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'admin_master'::public.app_role)
);