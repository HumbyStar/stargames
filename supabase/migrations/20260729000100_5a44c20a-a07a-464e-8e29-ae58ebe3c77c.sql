
CREATE TABLE public.nf_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  generated_by UUID,
  content TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,
  product_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX nf_invoices_client_id_created_at_idx
  ON public.nf_invoices (client_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.nf_invoices TO authenticated;
GRANT ALL ON public.nf_invoices TO service_role;

ALTER TABLE public.nf_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view nf_invoices"
  ON public.nf_invoices FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert nf_invoices"
  ON public.nf_invoices FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can delete nf_invoices"
  ON public.nf_invoices FOR DELETE
  TO authenticated
  USING (true);
