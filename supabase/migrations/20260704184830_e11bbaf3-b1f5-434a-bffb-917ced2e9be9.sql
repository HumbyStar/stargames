-- Restrict SELECT policies to users with an internal role
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Profiles readable by internal roles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_any_internal_role(auth.uid()));

DROP POLICY IF EXISTS "Auth read app_settings" ON public.app_settings;
CREATE POLICY "Internal roles read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.has_any_internal_role(auth.uid()));

DROP POLICY IF EXISTS "auth read permissions" ON public.role_permissions;
CREATE POLICY "Internal roles read role_permissions"
  ON public.role_permissions FOR SELECT
  TO authenticated
  USING (public.has_any_internal_role(auth.uid()));