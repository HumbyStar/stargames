
-- Extensions used by scheduled backups
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- system_backups: metadata for every backup snapshot
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('manual','scheduled')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  storage_path TEXT,
  size_bytes BIGINT,
  duration_ms INTEGER,
  row_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_object_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS system_backups_created_at_idx
  ON public.system_backups (created_at DESC);
CREATE INDEX IF NOT EXISTS system_backups_type_idx
  ON public.system_backups (type, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_backups TO authenticated;
GRANT ALL ON public.system_backups TO service_role;

ALTER TABLE public.system_backups ENABLE ROW LEVEL SECURITY;

-- Only admins / admin_masters can see or manage backups
CREATE POLICY "Admins view backups"
  ON public.system_backups FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_master')
  );

CREATE POLICY "Admins insert backups"
  ON public.system_backups FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_master')
  );

CREATE POLICY "Admins update backups"
  ON public.system_backups FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_master')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_master')
  );

CREATE POLICY "Admins delete backups"
  ON public.system_backups FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_master')
  );

-- updated_at trigger reusing existing touch_updated_at()
DROP TRIGGER IF EXISTS system_backups_touch_updated_at ON public.system_backups;
CREATE TRIGGER system_backups_touch_updated_at
  BEFORE UPDATE ON public.system_backups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
