
-- Tighten SELECT policies: remove "USING (true)" so unauthenticated requests are blocked.

-- mgmv_agreements
DROP POLICY IF EXISTS "Authenticated read mgmv_agreements" ON public.mgmv_agreements;
CREATE POLICY "Authenticated read mgmv_agreements"
  ON public.mgmv_agreements FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- mgmv_installments
DROP POLICY IF EXISTS "Authenticated read mgmv_installments" ON public.mgmv_installments;
CREATE POLICY "Authenticated read mgmv_installments"
  ON public.mgmv_installments FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- clients
DROP POLICY IF EXISTS "Auth read clients" ON public.clients;
CREATE POLICY "Auth read clients"
  ON public.clients FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- products
DROP POLICY IF EXISTS "Auth read products" ON public.products;
CREATE POLICY "Auth read products"
  ON public.products FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- import_history
DROP POLICY IF EXISTS "Auth read import_history" ON public.import_history;
CREATE POLICY "Auth read import_history"
  ON public.import_history FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
