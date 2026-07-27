ALTER TABLE public.clients ADD COLUMN customer_data text;

GRANT SELECT, INSERT, UPDATE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

COMMENT ON COLUMN public.clients.customer_data IS 'Campo de texto livre para dados completos do cliente (CPF, endereço, etc.). Não substitui nome e telefone.';