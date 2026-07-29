ALTER TABLE public.system_backups
  ADD COLUMN IF NOT EXISTS business_summary jsonb NOT NULL DEFAULT '{}'::jsonb;