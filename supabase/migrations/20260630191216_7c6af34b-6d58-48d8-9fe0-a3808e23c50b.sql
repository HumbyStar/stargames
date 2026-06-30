-- 1) Função auxiliar: verifica se o usuário tem qualquer papel atribuído.
CREATE OR REPLACE FUNCTION public.has_any_internal_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_any_internal_role(uuid) TO authenticated;

-- 2) clients
DROP POLICY IF EXISTS "Auth read clients" ON public.clients;
DROP POLICY IF EXISTS "Auth insert clients" ON public.clients;
DROP POLICY IF EXISTS "Auth update clients" ON public.clients;
DROP POLICY IF EXISTS "Auth delete clients" ON public.clients;

CREATE POLICY "Internal read clients" ON public.clients
  FOR SELECT TO authenticated USING (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal insert clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal update clients" ON public.clients
  FOR UPDATE TO authenticated USING (public.has_any_internal_role(auth.uid()))
  WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal delete clients" ON public.clients
  FOR DELETE TO authenticated USING (public.has_any_internal_role(auth.uid()));

-- 3) products
DROP POLICY IF EXISTS "Auth read products" ON public.products;
DROP POLICY IF EXISTS "Auth insert products" ON public.products;
DROP POLICY IF EXISTS "Auth update products" ON public.products;
DROP POLICY IF EXISTS "Auth delete products" ON public.products;

CREATE POLICY "Internal read products" ON public.products
  FOR SELECT TO authenticated USING (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal insert products" ON public.products
  FOR INSERT TO authenticated WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal update products" ON public.products
  FOR UPDATE TO authenticated USING (public.has_any_internal_role(auth.uid()))
  WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal delete products" ON public.products
  FOR DELETE TO authenticated USING (public.has_any_internal_role(auth.uid()));

-- 4) mgmv_agreements
DROP POLICY IF EXISTS "Authenticated read mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Authenticated insert mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Authenticated update mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Authenticated delete mgmv_agreements" ON public.mgmv_agreements;

CREATE POLICY "Internal read mgmv_agreements" ON public.mgmv_agreements
  FOR SELECT TO authenticated USING (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal insert mgmv_agreements" ON public.mgmv_agreements
  FOR INSERT TO authenticated WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal update mgmv_agreements" ON public.mgmv_agreements
  FOR UPDATE TO authenticated USING (public.has_any_internal_role(auth.uid()))
  WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal delete mgmv_agreements" ON public.mgmv_agreements
  FOR DELETE TO authenticated USING (public.has_any_internal_role(auth.uid()));

-- 5) mgmv_installments
DROP POLICY IF EXISTS "Authenticated read mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Authenticated insert mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Authenticated update mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Authenticated delete mgmv_installments" ON public.mgmv_installments;

CREATE POLICY "Internal read mgmv_installments" ON public.mgmv_installments
  FOR SELECT TO authenticated USING (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal insert mgmv_installments" ON public.mgmv_installments
  FOR INSERT TO authenticated WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal update mgmv_installments" ON public.mgmv_installments
  FOR UPDATE TO authenticated USING (public.has_any_internal_role(auth.uid()))
  WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal delete mgmv_installments" ON public.mgmv_installments
  FOR DELETE TO authenticated USING (public.has_any_internal_role(auth.uid()));

-- 6) import_history
DROP POLICY IF EXISTS "Auth read import_history" ON public.import_history;
DROP POLICY IF EXISTS "Auth insert import_history" ON public.import_history;
DROP POLICY IF EXISTS "Auth update import_history" ON public.import_history;
DROP POLICY IF EXISTS "Auth delete import_history" ON public.import_history;

CREATE POLICY "Internal read import_history" ON public.import_history
  FOR SELECT TO authenticated USING (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal insert import_history" ON public.import_history
  FOR INSERT TO authenticated WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal update import_history" ON public.import_history
  FOR UPDATE TO authenticated USING (public.has_any_internal_role(auth.uid()))
  WITH CHECK (public.has_any_internal_role(auth.uid()));
CREATE POLICY "Internal delete import_history" ON public.import_history
  FOR DELETE TO authenticated USING (public.has_any_internal_role(auth.uid()));
