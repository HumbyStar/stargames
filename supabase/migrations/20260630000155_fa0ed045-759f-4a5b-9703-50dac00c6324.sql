
-- audit_log: admin-only SELECT
DROP POLICY IF EXISTS "Audit log readable by authenticated" ON public.audit_log;
CREATE POLICY "Audit log readable by admins"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));

-- app_settings: admin-only writes; keep authenticated reads
DROP POLICY IF EXISTS "Auth insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Auth update app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Auth delete app_settings" ON public.app_settings;
CREATE POLICY "Admins insert app_settings"
  ON public.app_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));
CREATE POLICY "Admins update app_settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));
CREATE POLICY "Admins delete app_settings"
  ON public.app_settings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));

-- saved_filters: owner-scoped
ALTER TABLE public.saved_filters
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS saved_filters_created_by_idx ON public.saved_filters(created_by);

DROP POLICY IF EXISTS "Auth read saved_filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Auth insert saved_filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Auth update saved_filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Auth delete saved_filters" ON public.saved_filters;

CREATE POLICY "Owners or admins read saved_filters"
  ON public.saved_filters FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_master')
  );
CREATE POLICY "Owners insert saved_filters"
  ON public.saved_filters FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Owners or admins update saved_filters"
  ON public.saved_filters FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_master')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_master')
  );
CREATE POLICY "Owners or admins delete saved_filters"
  ON public.saved_filters FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_master')
  );

-- team_task_activity: admin-scoped UPDATE/DELETE
CREATE POLICY "Admins update team_task_activity"
  ON public.team_task_activity FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));
CREATE POLICY "Admins delete team_task_activity"
  ON public.team_task_activity FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));

-- bootstrap_first_admin: revoke from regular users; only service_role may call
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO service_role;
