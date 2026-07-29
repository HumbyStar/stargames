
-- URL estável de produção do projeto e chave anon (publishable, segura em código).
-- Ambas são públicas: URL do site e anon key são disponibilizadas ao cliente.
CREATE OR REPLACE FUNCTION public.get_system_backup_schedule()
RETURNS TABLE (jobid BIGINT, schedule TEXT, active BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT j.jobid, j.schedule::TEXT, j.active
    FROM cron.job j
    WHERE j.jobname = 'system-backup-daily'
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_backup_schedule() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_system_backup_schedule() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_system_backup_schedule(_frequency TEXT, _job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_url TEXT := 'https://project--9675ace6-1d0a-4259-a33a-8378153df5fa.lovable.app/api/public/hooks/backup-run';
  v_anon TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0aGp4eGNtY3NoeWJmbWVteWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjA5OTUsImV4cCI6MjA5Nzk5Njk5NX0.PA9zcgZWfwAS1Rh4WuMxXlbKvbS-vlnSitjoYcXgim0';
  v_schedule TEXT;
  v_command TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Desliga qualquer job existente com esse nome
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = _job_name;

  IF _frequency = 'off' THEN
    RETURN;
  END IF;

  IF _frequency = 'daily' THEN
    v_schedule := '0 3 * * *';
  ELSIF _frequency = 'weekly' THEN
    v_schedule := '0 3 * * 0';
  ELSE
    RAISE EXCEPTION 'invalid frequency: %', _frequency;
  END IF;

  v_command := format(
    $cron$
    SELECT net.http_post(
      url := %L,
      headers := %L::jsonb,
      body := '{"type":"scheduled"}'::jsonb
    ) AS request_id;
    $cron$,
    v_url,
    json_build_object('Content-Type', 'application/json', 'apikey', v_anon)::text
  );

  PERFORM cron.schedule(_job_name, v_schedule, v_command);
END;
$$;

REVOKE ALL ON FUNCTION public.set_system_backup_schedule(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_system_backup_schedule(TEXT, TEXT) TO authenticated;
