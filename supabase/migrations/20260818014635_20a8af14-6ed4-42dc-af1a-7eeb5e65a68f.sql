DROP POLICY IF EXISTS "Internal roles can update nf_invoices" ON public.nf_invoices;
DROP POLICY IF EXISTS "Internal roles can delete nf_invoices" ON public.nf_invoices;

CREATE POLICY "Admins can update nf_invoices"
ON public.nf_invoices FOR UPDATE TO authenticated
USING (
  public.env_row_visible(env, sandbox_owner)
  AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
)
WITH CHECK (
  public.env_row_visible(env, sandbox_owner)
  AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
);

CREATE POLICY "Admins can delete nf_invoices"
ON public.nf_invoices FOR DELETE TO authenticated
USING (
  public.env_row_visible(env, sandbox_owner)
  AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
);