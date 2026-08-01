-- 1) Auditoria: ignorar mudanças que tocam apenas o estado de tela (ui_state)
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
  -- app_settings: mudanças que só alteram ui_state (busca, chips, rascunhos,
  -- layout) são ruído de navegação e não entram no histórico.
  IF TG_TABLE_NAME = 'app_settings' AND TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) - 'ui_state' - 'updated_at' IS NOT DISTINCT FROM
       to_jsonb(NEW) - 'ui_state' - 'updated_at' THEN
      RETURN NEW;
    END IF;
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

-- 2) Resumo de uso da equipe
CREATE OR REPLACE FUNCTION public.team_usage_stats(_days integer DEFAULT 30)
 RETURNS TABLE(
   user_id uuid,
   user_email text,
   total_actions bigint,
   inserts bigint,
   updates bigint,
   deletes bigint,
   active_days bigint,
   active_blocks bigint,
   last_action_at timestamptz,
   by_table jsonb,
   daily jsonb
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(_days, 30), 1), 180);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_internal_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT a.user_id AS uid,
           MIN(a.user_email) OVER (PARTITION BY a.user_id) AS email,
           a.action,
           a.table_name,
           a.changed_at
    FROM public.audit_log a
    WHERE a.user_id IS NOT NULL
      AND a.changed_at > now() - make_interval(days => v_days)
      AND NOT (
        a.table_name = 'app_settings'
        AND a.action = 'UPDATE'
        AND (COALESCE(a.old_data, '{}'::jsonb) - 'ui_state' - 'updated_at')
            IS NOT DISTINCT FROM
            (COALESCE(a.new_data, '{}'::jsonb) - 'ui_state' - 'updated_at')
      )
  )
  SELECT
    b.uid,
    MIN(b.email),
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE b.action = 'INSERT')::bigint,
    COUNT(*) FILTER (WHERE b.action = 'UPDATE')::bigint,
    COUNT(*) FILTER (WHERE b.action = 'DELETE')::bigint,
    COUNT(DISTINCT (b.changed_at AT TIME ZONE 'America/Sao_Paulo')::date)::bigint,
    COUNT(DISTINCT date_trunc('hour', b.changed_at)
          + make_interval(mins => (EXTRACT(MINUTE FROM b.changed_at)::int / 5) * 5))::bigint,
    MAX(b.changed_at),
    (
      SELECT COALESCE(jsonb_object_agg(t.table_name, t.n), '{}'::jsonb)
      FROM (
        SELECT b2.table_name, COUNT(*) AS n
        FROM base b2 WHERE b2.uid = b.uid
        GROUP BY b2.table_name
      ) t
    ),
    (
      SELECT COALESCE(jsonb_object_agg(d.day::text, d.n), '{}'::jsonb)
      FROM (
        SELECT (b3.changed_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, COUNT(*) AS n
        FROM base b3 WHERE b3.uid = b.uid
        GROUP BY 1
      ) d
    )
  FROM base b
  GROUP BY b.uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.team_usage_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_usage_stats(integer) TO authenticated;