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
  v_old JSONB;
  v_new JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  -- app_settings: `ui_state` guarda só estado de tela (busca digitada, chips,
  -- paginação, rascunhos, layout). Nunca entra no histórico, em nenhum ambiente.
  IF TG_TABLE_NAME = 'app_settings' THEN
    IF TG_OP = 'UPDATE'
       AND (v_old - 'ui_state' - 'updated_at') IS NOT DISTINCT FROM (v_new - 'ui_state' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    v_old := v_old - 'ui_state';
    v_new := v_new - 'ui_state';
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  BEGIN
    v_env := public.current_env();
  EXCEPTION WHEN OTHERS THEN
    v_env := 'producao'::public.app_env;
  END;

  IF (TG_OP = 'DELETE') THEN
    v_row_id := (v_old ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, old_data, env)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, v_old, v_env);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_row_id := (v_new ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, old_data, new_data, env)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, v_old, v_new, v_env);
    RETURN NEW;
  ELSE
    v_row_id := (v_new ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, new_data, env)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, v_new, v_env);
    RETURN NEW;
  END IF;
END;
$function$;

-- Limpeza do histórico já gravado: remove o estado de tela (e os termos de
-- busca dentro dele) das linhas de auditoria de configurações.
UPDATE public.audit_log
SET old_data = old_data - 'ui_state',
    new_data = new_data - 'ui_state'
WHERE table_name = 'app_settings'
  AND (old_data ? 'ui_state' OR new_data ? 'ui_state');

-- Linhas que sobraram sem nenhuma diferença real eram só navegação/busca.
DELETE FROM public.audit_log
WHERE table_name = 'app_settings'
  AND action = 'UPDATE'
  AND (COALESCE(old_data, '{}'::jsonb) - 'updated_at')
      IS NOT DISTINCT FROM (COALESCE(new_data, '{}'::jsonb) - 'updated_at');