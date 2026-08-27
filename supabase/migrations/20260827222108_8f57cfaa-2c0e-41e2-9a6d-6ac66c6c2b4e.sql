CREATE INDEX IF NOT EXISTS idx_products_client_id ON public.products (client_id);
CREATE INDEX IF NOT EXISTS idx_products_env_financial_status ON public.products (env, financial_status);
CREATE INDEX IF NOT EXISTS idx_products_env_due_date ON public.products (env, due_date);
CREATE INDEX IF NOT EXISTS idx_clients_env_client_type ON public.clients (env, client_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON public.audit_log (changed_at DESC);