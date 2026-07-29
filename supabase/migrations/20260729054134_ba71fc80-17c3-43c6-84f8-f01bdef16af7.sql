ALTER TABLE public.system_backups DROP CONSTRAINT IF EXISTS system_backups_status_check;
ALTER TABLE public.system_backups ADD CONSTRAINT system_backups_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE public.system_backups ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;