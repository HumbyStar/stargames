
CREATE TABLE public.import_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_hash TEXT NOT NULL,
  zip_name TEXT NOT NULL,
  folders JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_idx INTEGER NOT NULL DEFAULT -1,
  total INTEGER NOT NULL DEFAULT 0,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_progress TO authenticated;
GRANT ALL ON public.import_progress TO service_role;

ALTER TABLE public.import_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own import progress"
  ON public.import_progress FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own import progress"
  ON public.import_progress FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own import progress"
  ON public.import_progress FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own import progress"
  ON public.import_progress FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER import_progress_touch_updated_at
  BEFORE UPDATE ON public.import_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX import_progress_user_done_idx
  ON public.import_progress (user_id, done, updated_at DESC);
