GRANT UPDATE ON public.nf_invoices TO authenticated;
CREATE POLICY "Internal roles can update nf_invoices"
ON public.nf_invoices FOR UPDATE TO authenticated
USING (has_any_internal_role(auth.uid()) AND env_row_visible(env, sandbox_owner))
WITH CHECK (has_any_internal_role(auth.uid()) AND env_row_visible(env, sandbox_owner));