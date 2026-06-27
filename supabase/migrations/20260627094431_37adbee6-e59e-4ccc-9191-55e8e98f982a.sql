
-- =====================================================================
-- CLIENTS
-- =====================================================================
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT,
  folder TEXT,
  mgmv JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO anon, authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read clients" ON public.clients FOR SELECT USING (true);
CREATE POLICY "Public insert clients" ON public.clients FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update clients" ON public.clients FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete clients" ON public.clients FOR DELETE USING (true);

-- =====================================================================
-- PRODUCTS
-- =====================================================================
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  total_value NUMERIC NOT NULL DEFAULT 0,
  paid_value NUMERIC NOT NULL DEFAULT 0,
  financial_status TEXT NOT NULL DEFAULT 'Pendente',
  situation TEXT NOT NULL DEFAULT 'Em Aberto',
  register_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_client_id_idx ON public.products(client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public insert products" ON public.products FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update products" ON public.products FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete products" ON public.products FOR DELETE USING (true);

-- =====================================================================
-- IMPORT HISTORY
-- =====================================================================
CREATE TABLE public.import_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  file TEXT NOT NULL,
  clients_created INTEGER NOT NULL DEFAULT 0,
  products_added INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  file_hash TEXT,
  agreements_created INTEGER,
  agreements_replaced INTEGER,
  skipped_duplicates INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_history TO anon, authenticated;
GRANT ALL ON public.import_history TO service_role;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read import_history" ON public.import_history FOR SELECT USING (true);
CREATE POLICY "Public insert import_history" ON public.import_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update import_history" ON public.import_history FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete import_history" ON public.import_history FOR DELETE USING (true);

-- =====================================================================
-- APP SETTINGS (singleton)
-- =====================================================================
CREATE TABLE public.app_settings (
  id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  security JSONB NOT NULL DEFAULT '{}'::jsonb,
  ui_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id) VALUES ('default') ON CONFLICT DO NOTHING;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read app_settings" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "Public insert app_settings" ON public.app_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update app_settings" ON public.app_settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete app_settings" ON public.app_settings FOR DELETE USING (true);

-- =====================================================================
-- SAVED FILTERS
-- =====================================================================
CREATE TABLE public.saved_filters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX saved_filters_scope_idx ON public.saved_filters(scope);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO anon, authenticated;
GRANT ALL ON public.saved_filters TO service_role;
ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read saved_filters" ON public.saved_filters FOR SELECT USING (true);
CREATE POLICY "Public insert saved_filters" ON public.saved_filters FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update saved_filters" ON public.saved_filters FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete saved_filters" ON public.saved_filters FOR DELETE USING (true);

-- =====================================================================
-- updated_at trigger
-- =====================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_app_settings_updated BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_saved_filters_updated BEFORE UPDATE ON public.saved_filters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
