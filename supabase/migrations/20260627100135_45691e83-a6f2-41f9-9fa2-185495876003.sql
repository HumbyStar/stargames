
-- =====================================================================
-- 1) PROFILES
-- =====================================================================
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles readable by authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Profiles insert self"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Profiles update self"
  ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 2) AUDIT LOG
-- =====================================================================
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,            -- INSERT | UPDATE | DELETE
  row_id TEXT,
  user_id UUID,
  user_email TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_data JSONB,
  new_data JSONB
);
CREATE INDEX audit_log_table_idx ON public.audit_log(table_name, changed_at DESC);
CREATE INDEX audit_log_user_idx ON public.audit_log(user_id, changed_at DESC);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit log readable by authenticated"
  ON public.audit_log FOR SELECT TO authenticated USING (true);
-- Writes happen exclusively via SECURITY DEFINER trigger function below.

CREATE OR REPLACE FUNCTION public.audit_change() RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_row_id TEXT;
BEGIN
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    v_row_id := (to_jsonb(OLD) ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, old_data)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, to_jsonb(OLD));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_row_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, old_data, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE -- INSERT
    v_row_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log(table_name, action, row_id, user_id, user_email, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_user_id, v_user_email, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_audit_app_settings
AFTER INSERT OR UPDATE OR DELETE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE TRIGGER trg_audit_saved_filters
AFTER INSERT OR UPDATE OR DELETE ON public.saved_filters
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE TRIGGER trg_audit_import_history
AFTER INSERT OR UPDATE OR DELETE ON public.import_history
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

-- =====================================================================
-- 3) TIGHTEN RLS — authenticated only, no anon
-- =====================================================================

-- CLIENTS
DROP POLICY IF EXISTS "Public read clients"   ON public.clients;
DROP POLICY IF EXISTS "Public insert clients" ON public.clients;
DROP POLICY IF EXISTS "Public update clients" ON public.clients;
DROP POLICY IF EXISTS "Public delete clients" ON public.clients;
REVOKE ALL ON public.clients FROM anon;
CREATE POLICY "Auth read clients"   ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update clients" ON public.clients FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete clients" ON public.clients FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- PRODUCTS
DROP POLICY IF EXISTS "Public read products"   ON public.products;
DROP POLICY IF EXISTS "Public insert products" ON public.products;
DROP POLICY IF EXISTS "Public update products" ON public.products;
DROP POLICY IF EXISTS "Public delete products" ON public.products;
REVOKE ALL ON public.products FROM anon;
CREATE POLICY "Auth read products"   ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update products" ON public.products FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete products" ON public.products FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- IMPORT HISTORY
DROP POLICY IF EXISTS "Public read import_history"   ON public.import_history;
DROP POLICY IF EXISTS "Public insert import_history" ON public.import_history;
DROP POLICY IF EXISTS "Public update import_history" ON public.import_history;
DROP POLICY IF EXISTS "Public delete import_history" ON public.import_history;
REVOKE ALL ON public.import_history FROM anon;
CREATE POLICY "Auth read import_history"   ON public.import_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert import_history" ON public.import_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update import_history" ON public.import_history FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete import_history" ON public.import_history FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- APP SETTINGS
DROP POLICY IF EXISTS "Public read app_settings"   ON public.app_settings;
DROP POLICY IF EXISTS "Public insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Public update app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Public delete app_settings" ON public.app_settings;
REVOKE ALL ON public.app_settings FROM anon;
CREATE POLICY "Auth read app_settings"   ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert app_settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update app_settings" ON public.app_settings FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete app_settings" ON public.app_settings FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- SAVED FILTERS
DROP POLICY IF EXISTS "Public read saved_filters"   ON public.saved_filters;
DROP POLICY IF EXISTS "Public insert saved_filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Public update saved_filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Public delete saved_filters" ON public.saved_filters;
REVOKE ALL ON public.saved_filters FROM anon;
CREATE POLICY "Auth read saved_filters"   ON public.saved_filters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert saved_filters" ON public.saved_filters FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth update saved_filters" ON public.saved_filters FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete saved_filters" ON public.saved_filters FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
