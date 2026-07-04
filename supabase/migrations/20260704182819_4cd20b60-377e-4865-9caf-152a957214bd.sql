
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Products: filters and sorts
CREATE INDEX IF NOT EXISTS products_financial_status_idx ON public.products (financial_status);
CREATE INDEX IF NOT EXISTS products_situation_idx ON public.products (situation);
CREATE INDEX IF NOT EXISTS products_due_date_idx ON public.products (due_date);
CREATE INDEX IF NOT EXISTS products_platform_idx ON public.products (platform);
CREATE INDEX IF NOT EXISTS products_included_in_mgmv_idx ON public.products (included_in_mgmv);
CREATE INDEX IF NOT EXISTS products_collection_eligible_idx ON public.products (collection_eligible) WHERE collection_eligible = true;
CREATE INDEX IF NOT EXISTS products_status_situation_idx ON public.products (financial_status, situation);

-- Products: text search
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON public.products USING gin (name gin_trgm_ops);

-- Clients: text search on name and phone
CREATE INDEX IF NOT EXISTS clients_name_trgm_idx ON public.clients USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_phone_trgm_idx ON public.clients USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_name_idx ON public.clients (name);

-- MGMV
CREATE INDEX IF NOT EXISTS mgmv_agreements_next_due_date_idx ON public.mgmv_agreements (next_due_date);
CREATE INDEX IF NOT EXISTS mgmv_agreements_client_status_idx ON public.mgmv_agreements (client_id, status);
CREATE INDEX IF NOT EXISTS mgmv_installments_due_date_idx ON public.mgmv_installments (due_date);
CREATE INDEX IF NOT EXISTS mgmv_installments_status_idx ON public.mgmv_installments (status);
CREATE INDEX IF NOT EXISTS mgmv_installments_agreement_number_idx ON public.mgmv_installments (agreement_id, installment_number);
