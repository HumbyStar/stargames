CREATE INDEX IF NOT EXISTS products_env_owner_idx ON public.products (env, sandbox_owner);
CREATE INDEX IF NOT EXISTS products_env_client_idx ON public.products (env, client_id);
CREATE INDEX IF NOT EXISTS clients_env_owner_idx ON public.clients (env, sandbox_owner);
CREATE INDEX IF NOT EXISTS mgmv_agreements_env_owner_idx ON public.mgmv_agreements (env, sandbox_owner);
CREATE INDEX IF NOT EXISTS mgmv_installments_env_owner_idx ON public.mgmv_installments (env, sandbox_owner);
CREATE INDEX IF NOT EXISTS import_history_env_owner_idx ON public.import_history (env, sandbox_owner);