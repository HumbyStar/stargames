
DROP POLICY IF EXISTS "Public read mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Public insert mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Public update mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Public delete mgmv_agreements" ON public.mgmv_agreements;

CREATE POLICY "Authenticated read mgmv_agreements" ON public.mgmv_agreements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert mgmv_agreements" ON public.mgmv_agreements FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated update mgmv_agreements" ON public.mgmv_agreements FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete mgmv_agreements" ON public.mgmv_agreements FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Public read mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Public insert mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Public update mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Public delete mgmv_installments" ON public.mgmv_installments;

CREATE POLICY "Authenticated read mgmv_installments" ON public.mgmv_installments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert mgmv_installments" ON public.mgmv_installments FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated update mgmv_installments" ON public.mgmv_installments FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete mgmv_installments" ON public.mgmv_installments FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
