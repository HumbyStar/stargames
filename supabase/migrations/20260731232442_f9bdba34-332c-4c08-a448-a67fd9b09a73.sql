DROP INDEX IF EXISTS public.uniq_punch_user_day_kind;
CREATE UNIQUE INDEX uniq_punch_user_day_kind_env
  ON public.team_punch_entries (user_id, day, kind, env);