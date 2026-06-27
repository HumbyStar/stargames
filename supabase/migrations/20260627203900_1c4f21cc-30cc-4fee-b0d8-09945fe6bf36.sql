
-- Add classification + MGMV linkage columns to existing tables
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'common';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS included_in_mgmv BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mgmv_agreement_id UUID,
  ADD COLUMN IF NOT EXISTS collection_eligible BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS clients_client_type_idx ON public.clients(client_type);
CREATE INDEX IF NOT EXISTS products_mgmv_agreement_id_idx ON public.products(mgmv_agreement_id);

-- =====================================================================
-- MGMV AGREEMENTS
-- =====================================================================
CREATE TABLE public.mgmv_agreements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  total_agreement_value NUMERIC,
  installments_count INTEGER,
  installment_value NUMERIC,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  pending_installments INTEGER,
  first_due_date TIMESTAMPTZ,
  next_due_date TIMESTAMPTZ,
  due_day INTEGER,
  paid_value NUMERIC NOT NULL DEFAULT 0,
  remaining_value NUMERIC,
  status TEXT NOT NULL DEFAULT 'Ativo',
  needs_review BOOLEAN NOT NULL DEFAULT false,
  source_folder TEXT,
  source_file TEXT,
  original_notes TEXT,
  detection_log JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mgmv_agreements_client_id_idx ON public.mgmv_agreements(client_id);
CREATE INDEX mgmv_agreements_status_idx ON public.mgmv_agreements(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mgmv_agreements TO anon, authenticated;
GRANT ALL ON public.mgmv_agreements TO service_role;
ALTER TABLE public.mgmv_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read mgmv_agreements" ON public.mgmv_agreements FOR SELECT USING (true);
CREATE POLICY "Public insert mgmv_agreements" ON public.mgmv_agreements FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update mgmv_agreements" ON public.mgmv_agreements FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete mgmv_agreements" ON public.mgmv_agreements FOR DELETE USING (true);

-- =====================================================================
-- MGMV INSTALLMENTS
-- =====================================================================
CREATE TABLE public.mgmv_installments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.mgmv_agreements(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  amount NUMERIC,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mgmv_installments_agreement_id_idx ON public.mgmv_installments(agreement_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mgmv_installments TO anon, authenticated;
GRANT ALL ON public.mgmv_installments TO service_role;
ALTER TABLE public.mgmv_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read mgmv_installments" ON public.mgmv_installments FOR SELECT USING (true);
CREATE POLICY "Public insert mgmv_installments" ON public.mgmv_installments FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update mgmv_installments" ON public.mgmv_installments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete mgmv_installments" ON public.mgmv_installments FOR DELETE USING (true);

-- updated_at triggers
CREATE TRIGGER mgmv_agreements_touch_updated_at
  BEFORE UPDATE ON public.mgmv_agreements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER mgmv_installments_touch_updated_at
  BEFORE UPDATE ON public.mgmv_installments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
