ALTER TABLE public.system_backups
  ADD COLUMN IF NOT EXISTS error_details jsonb,
  ADD COLUMN IF NOT EXISTS debug_log jsonb NOT NULL DEFAULT '[]'::jsonb;