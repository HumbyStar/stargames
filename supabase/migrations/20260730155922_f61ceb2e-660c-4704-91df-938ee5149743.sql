CREATE TABLE public.sandbox_import_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_email TEXT,
  env app_env NOT NULL DEFAULT 'sandbox',
  source TEXT NOT NULL,
  file_name TEXT,
  mode TEXT NOT NULL,
  tables_affected TEXT[] NOT NULL DEFAULT '{}',
  row_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  result TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  production_untouched BOOLEAN NOT NULL DEFAULT true,
  production_counts_before JSONB NOT NULL DEFAULT '{}'::jsonb,
  production_counts_after JSONB NOT NULL DEFAULT '{}'::jsonb,
  report JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.sandbox_import_audit TO authenticated;
GRANT ALL ON public.sandbox_import_audit TO service_role;

ALTER TABLE public.sandbox_import_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sandbox_audit_select_own_or_admin"
  ON public.sandbox_import_audit FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_master')
  );

CREATE POLICY "sandbox_audit_insert_own"
  ON public.sandbox_import_audit FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_sandbox_import_audit_created_at
  ON public.sandbox_import_audit (created_at DESC);
CREATE INDEX idx_sandbox_import_audit_user
  ON public.sandbox_import_audit (user_id, created_at DESC);