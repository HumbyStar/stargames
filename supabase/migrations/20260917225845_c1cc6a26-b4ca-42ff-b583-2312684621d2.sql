DROP POLICY IF EXISTS "Internal insert mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Internal update mgmv_installments" ON public.mgmv_installments;
DROP POLICY IF EXISTS "Internal delete mgmv_installments" ON public.mgmv_installments;

CREATE POLICY "MGMV editors insert installments" ON public.mgmv_installments FOR INSERT TO authenticated
WITH CHECK (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "MGMV editors update installments" ON public.mgmv_installments FOR UPDATE TO authenticated
USING (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner))
WITH CHECK (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "MGMV editors delete installments" ON public.mgmv_installments FOR DELETE TO authenticated
USING (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner));