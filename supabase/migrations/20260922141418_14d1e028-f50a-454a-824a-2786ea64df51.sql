ALTER TABLE public.import_progress
  ADD COLUMN IF NOT EXISTS env public.app_env NOT NULL DEFAULT public.current_env(),
  ADD COLUMN IF NOT EXISTS sandbox_owner uuid;

UPDATE public.import_progress SET sandbox_owner = user_id WHERE env = 'sandbox'::public.app_env AND sandbox_owner IS NULL;

DROP TRIGGER IF EXISTS import_progress_sandbox_owner_guard ON public.import_progress;
CREATE TRIGGER import_progress_sandbox_owner_guard
  BEFORE INSERT OR UPDATE ON public.import_progress
  FOR EACH ROW EXECUTE FUNCTION public.sandbox_owner_guard();

DROP POLICY IF EXISTS "Users read own import progress" ON public.import_progress;
DROP POLICY IF EXISTS "Users insert own import progress" ON public.import_progress;
DROP POLICY IF EXISTS "Users update own import progress" ON public.import_progress;
DROP POLICY IF EXISTS "Users delete own import progress" ON public.import_progress;

CREATE POLICY "Internal read own import progress"
  ON public.import_progress FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Internal insert own import progress"
  ON public.import_progress FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Internal update own import progress"
  ON public.import_progress FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK (auth.uid() = user_id AND public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Internal delete own import progress"
  ON public.import_progress FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_progress TO authenticated;
GRANT ALL ON public.import_progress TO service_role;