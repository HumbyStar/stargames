REVOKE EXECUTE ON FUNCTION public.current_env() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_env() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_env() TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated can view nf_invoices" ON public.nf_invoices;
DROP POLICY IF EXISTS "Authenticated can insert nf_invoices" ON public.nf_invoices;
DROP POLICY IF EXISTS "Authenticated can delete nf_invoices" ON public.nf_invoices;

CREATE POLICY "Internal roles can view nf_invoices"
ON public.nf_invoices FOR SELECT TO authenticated
USING (public.has_any_internal_role(auth.uid()) AND env = public.current_env());

CREATE POLICY "Internal roles can insert nf_invoices"
ON public.nf_invoices FOR INSERT TO authenticated
WITH CHECK (public.has_any_internal_role(auth.uid()) AND env = public.current_env());

CREATE POLICY "Internal roles can delete nf_invoices"
ON public.nf_invoices FOR DELETE TO authenticated
USING (public.has_any_internal_role(auth.uid()) AND env = public.current_env());