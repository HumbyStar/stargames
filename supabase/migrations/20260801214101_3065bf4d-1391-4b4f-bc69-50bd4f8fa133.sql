-- 1) Coluna de dono do sandbox
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','mgmv_agreements','mgmv_installments','products','nf_invoices','import_history','team_tasks','team_task_comments','team_task_activity','team_punch_entries','saved_filters','ai_automations','app_settings','ai_training_profile']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS sandbox_owner uuid REFERENCES auth.users(id) ON DELETE CASCADE', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (sandbox_owner) WHERE env = ''sandbox''::public.app_env', t || '_sandbox_owner_idx', t);
  END LOOP;
END $$;

-- 2) Visibilidade por ambiente + dono
CREATE OR REPLACE FUNCTION public.env_row_visible(_env public.app_env, _owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _env = public.current_env()
     AND (_env <> 'sandbox'::public.app_env OR _owner = auth.uid());
$$;

-- 3) Guarda de dono
CREATE OR REPLACE FUNCTION public.sandbox_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NEW.env = 'sandbox'::public.app_env THEN
    IF v_uid IS NOT NULL THEN
      NEW.sandbox_owner := v_uid;
    END IF;
  ELSE
    NEW.sandbox_owner := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','mgmv_agreements','mgmv_installments','products','nf_invoices','import_history','team_tasks','team_task_comments','team_task_activity','team_punch_entries','saved_filters','ai_automations','app_settings','ai_training_profile']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_sandbox_owner_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sandbox_owner_guard()', t || '_sandbox_owner_guard', t);
  END LOOP;
END $$;

-- 4) Reescreve as policies trocando (env = current_env()) por env_row_visible(env, sandbox_owner)
DO $$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_roles text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('clients','mgmv_agreements','mgmv_installments','products','nf_invoices','import_history','team_tasks','team_task_comments','team_task_activity','team_punch_entries','saved_filters','ai_automations','app_settings','ai_training_profile')
      AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%current_env()%'
  LOOP
    v_qual := replace(coalesce(r.qual,''), '(env = current_env())', 'public.env_row_visible(env, sandbox_owner)');
    v_check := replace(coalesce(r.with_check,''), '(env = current_env())', 'public.env_row_visible(env, sandbox_owner)');
    v_roles := array_to_string(r.roles, ', ');

    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);

    v_sql := format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s', r.policyname, r.tablename, r.cmd, v_roles);
    IF v_qual <> '' THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_check <> '' THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- 5) Chaves primárias compostas com env precisam incluir o dono
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS sandbox_key uuid
  GENERATED ALWAYS AS (coalesce(sandbox_owner, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;
ALTER TABLE public.ai_training_profile
  ADD COLUMN IF NOT EXISTS sandbox_key uuid
  GENERATED ALWAYS AS (coalesce(sandbox_owner, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

-- 6) Remove os dados de sandbox antigos (compartilhados, sem dono)
DELETE FROM public.ai_training_profile WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.app_settings WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.ai_automations WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.saved_filters WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.team_punch_entries WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.team_task_activity WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.team_task_comments WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.team_tasks WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.import_history WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.nf_invoices WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.products WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.mgmv_installments WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.mgmv_agreements WHERE env = 'sandbox'::public.app_env;
DELETE FROM public.clients WHERE env = 'sandbox'::public.app_env;

ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_pkey;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id, env, sandbox_key);
ALTER TABLE public.ai_training_profile DROP CONSTRAINT ai_training_profile_pkey;
ALTER TABLE public.ai_training_profile ADD CONSTRAINT ai_training_profile_pkey PRIMARY KEY (user_id, env, sandbox_key);