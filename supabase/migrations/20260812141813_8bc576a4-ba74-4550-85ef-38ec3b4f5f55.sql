-- clients: write requires clientes.edit
DROP POLICY IF EXISTS "Internal insert clients" ON public.clients;
DROP POLICY IF EXISTS "Internal update clients" ON public.clients;
DROP POLICY IF EXISTS "Internal delete clients" ON public.clients;

CREATE POLICY "Editors insert clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "Editors update clients" ON public.clients FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "Editors delete clients" ON public.clients FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));

-- products: write requires clientes.edit or mgmv.register_product
DROP POLICY IF EXISTS "Internal insert products" ON public.products;
DROP POLICY IF EXISTS "Internal update products" ON public.products;
DROP POLICY IF EXISTS "Internal delete products" ON public.products;

CREATE POLICY "Editors insert products" ON public.products FOR INSERT TO authenticated
  WITH CHECK ((public.has_permission(auth.uid(), 'clientes.edit') OR public.has_permission(auth.uid(), 'mgmv.register_product'))
              AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "Editors update products" ON public.products FOR UPDATE TO authenticated
  USING ((public.has_permission(auth.uid(), 'clientes.edit') OR public.has_permission(auth.uid(), 'mgmv.register_product'))
         AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK ((public.has_permission(auth.uid(), 'clientes.edit') OR public.has_permission(auth.uid(), 'mgmv.register_product'))
              AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "Editors delete products" ON public.products FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));

-- product_ncm: write requires clientes.edit
DROP POLICY IF EXISTS "product_ncm_insert" ON public.product_ncm;
DROP POLICY IF EXISTS "product_ncm_update" ON public.product_ncm;
DROP POLICY IF EXISTS "product_ncm_delete" ON public.product_ncm;

CREATE POLICY "product_ncm_insert" ON public.product_ncm FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "product_ncm_update" ON public.product_ncm FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "product_ncm_delete" ON public.product_ncm FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.edit') AND public.env_row_visible(env, sandbox_owner));

-- mgmv_agreements: write requires mgmv.edit
DROP POLICY IF EXISTS "Internal insert mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Internal update mgmv_agreements" ON public.mgmv_agreements;
DROP POLICY IF EXISTS "Internal delete mgmv_agreements" ON public.mgmv_agreements;

CREATE POLICY "Editors insert mgmv_agreements" ON public.mgmv_agreements FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "Editors update mgmv_agreements" ON public.mgmv_agreements FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner));
CREATE POLICY "Editors delete mgmv_agreements" ON public.mgmv_agreements FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'mgmv.edit') AND public.env_row_visible(env, sandbox_owner));