ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS env public.app_env NOT NULL DEFAULT 'producao'::public.app_env;

CREATE INDEX IF NOT EXISTS idx_audit_log_env_changed_at
  ON public.audit_log (env, changed_at DESC);

CREATE OR REPLACE FUNCTION public.audit_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_row_id TEXT;
  v_env public.app_env;
BEGIN
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  BEGIN
    v_env := public.current_env();
  EXCEPTION WHEN OTHERS THEN
    v_env := 'producao'::public.app_env;
  END;

  IF (TG_OP = 'DELETE') THEN
    v_row_id := (to_jsonb(OLD) ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, old_data, env)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, to_jsonb(OLD), v_env);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_row_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, old_data, new_data, env)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, to_jsonb(OLD), to_jsonb(NEW), v_env);
    RETURN NEW;
  ELSE
    v_row_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, new_data, env)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, to_jsonb(NEW), v_env);
    RETURN NEW;
  END IF;
END;
$function$;

ALTER TABLE public.system_backups
  ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_verification jsonb;