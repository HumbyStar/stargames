
DROP POLICY IF EXISTS "admins insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins update roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins delete roles" ON public.user_roles;

CREATE POLICY "admins insert roles" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  AND (role <> 'admin_master' OR public.has_role(auth.uid(), 'admin_master'))
);

CREATE POLICY "admins update roles" ON public.user_roles
FOR UPDATE TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  AND (role <> 'admin_master' OR public.has_role(auth.uid(), 'admin_master'))
)
WITH CHECK (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  AND (role <> 'admin_master' OR public.has_role(auth.uid(), 'admin_master'))
);

CREATE POLICY "admins delete roles" ON public.user_roles
FOR DELETE TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  AND (role <> 'admin_master' OR public.has_role(auth.uid(), 'admin_master'))
);
