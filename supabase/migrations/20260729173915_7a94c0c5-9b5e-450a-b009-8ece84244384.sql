-- 1. Tipo de ambiente
DO $$ BEGIN
  CREATE TYPE public.app_env AS ENUM ('producao','sandbox');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Estado do sandbox por usuário
CREATE TABLE IF NOT EXISTS public.sandbox_state (
  user_id UUID PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  cloned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sandbox_state TO authenticated;
GRANT ALL ON public.sandbox_state TO service_role;

ALTER TABLE public.sandbox_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own sandbox state select" ON public.sandbox_state;
CREATE POLICY "own sandbox state select" ON public.sandbox_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own sandbox state insert" ON public.sandbox_state;
CREATE POLICY "own sandbox state insert" ON public.sandbox_state
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
  );
DROP POLICY IF EXISTS "own sandbox state update" ON public.sandbox_state;
CREATE POLICY "own sandbox state update" ON public.sandbox_state
  FOR UPDATE TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
  );
DROP POLICY IF EXISTS "own sandbox state delete" ON public.sandbox_state;
CREATE POLICY "own sandbox state delete" ON public.sandbox_state
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS touch_sandbox_state ON public.sandbox_state;
CREATE TRIGGER touch_sandbox_state BEFORE UPDATE ON public.sandbox_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Ambiente atual do usuário
CREATE OR REPLACE FUNCTION public.current_env()
RETURNS public.app_env
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.sandbox_state s
      WHERE s.user_id = auth.uid() AND s.active
    ) THEN 'sandbox'::public.app_env
    ELSE 'producao'::public.app_env
  END;
$$;

GRANT EXECUTE ON FUNCTION public.current_env() TO authenticated, service_role;

-- 4. Coluna env nas tabelas de dados
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'clients','products','mgmv_agreements','mgmv_installments','import_history',
    'nf_invoices','team_tasks','team_task_comments','team_task_activity',
    'team_punch_entries','saved_filters','app_settings','ai_automations',
    'ai_training_profile','system_backups'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS env public.app_env NOT NULL DEFAULT public.current_env()', t
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (env)', t || '_env_idx', t);
  END LOOP;
END $$;

-- 5. Chaves primárias que precisam incluir o ambiente
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE public.app_settings ADD PRIMARY KEY (id, env);

ALTER TABLE public.ai_training_profile DROP CONSTRAINT IF EXISTS ai_training_profile_pkey;
ALTER TABLE public.ai_training_profile ADD PRIMARY KEY (user_id, env);

-- 6. Aplicar o filtro de ambiente nas políticas existentes
DO $$
DECLARE
  p RECORD;
  tables TEXT[] := ARRAY[
    'clients','products','mgmv_agreements','mgmv_installments','import_history',
    'nf_invoices','team_tasks','team_task_comments','team_task_activity',
    'team_punch_entries','saved_filters','app_settings','ai_automations',
    'ai_training_profile'
  ];
BEGIN
  FOR p IN
    SELECT policyname, tablename, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(tables)
  LOOP
    IF p.qual IS NOT NULL AND p.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING ((%s) AND env = public.current_env()) WITH CHECK ((%s) AND env = public.current_env())',
        p.policyname, p.tablename, p.qual, p.with_check);
    ELSIF p.qual IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING ((%s) AND env = public.current_env())',
        p.policyname, p.tablename, p.qual);
    ELSIF p.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I WITH CHECK ((%s) AND env = public.current_env())',
        p.policyname, p.tablename, p.with_check);
    END IF;
  END LOOP;
END $$;