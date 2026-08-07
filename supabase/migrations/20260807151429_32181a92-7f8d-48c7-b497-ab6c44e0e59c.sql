CREATE OR REPLACE FUNCTION public.set_system_backup_schedule(
  _frequency text,
  _job_name text,
  _hour integer DEFAULT 3,
  _minute integer DEFAULT 0,
  _weekday integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_url TEXT := 'https://project--9675ace6-1d0a-4259-a33a-8378153df5fa.lovable.app/api/public/hooks/backup-run';
  v_anon TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0aGp4eGNtY3NoeWJmbWVteWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjA5OTUsImV4cCI6MjA5Nzk5Njk5NX0.PA9zcgZWfwAS1Rh4WuMxXlbKvbS-vlnSitjoYcXgim0';
  v_schedule TEXT;
  v_command TEXT;
  v_hour INTEGER := COALESCE(_hour, 3);
  v_minute INTEGER := COALESCE(_minute, 0);
  v_weekday INTEGER := COALESCE(_weekday, 0);
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_hour < 0 OR v_hour > 23 OR v_minute < 0 OR v_minute > 59 OR v_weekday < 0 OR v_weekday > 6 THEN
    RAISE EXCEPTION 'invalid schedule time';
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = _job_name;

  IF _frequency = 'off' THEN
    RETURN;
  ELSIF _frequency = 'every_10h' THEN
    v_schedule := format('%s %s/10 * * *', v_minute, v_hour);
  ELSIF _frequency = 'daily' THEN
    v_schedule := format('%s %s * * *', v_minute, v_hour);
  ELSIF _frequency = 'weekly' THEN
    v_schedule := format('%s %s * * %s', v_minute, v_hour, v_weekday);
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
$function$;

REVOKE EXECUTE ON FUNCTION public.set_system_backup_schedule(text, text, integer, integer, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_system_backup_schedule(text, text, integer, integer, integer) TO authenticated;