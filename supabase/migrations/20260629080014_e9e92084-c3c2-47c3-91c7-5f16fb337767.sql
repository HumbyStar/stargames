
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin','manager','operator','viewer');
CREATE TYPE public.app_permission AS ENUM (
  'dashboard.view',
  'clientes.view','clientes.edit',
  'collection.view','collection.edit',
  'mgmv.view','mgmv.edit',
  'import.use',
  'finance.view',
  'settings.view',
  'users.manage'
);

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- role_permissions
CREATE TABLE public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission public.app_permission NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, permission)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- has_permission
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission public.app_permission)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role
    WHERE ur.user_id = _user_id AND rp.permission = _permission
  );
$$;

-- Policies: user_roles
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins insert roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update roles" ON public.user_roles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins delete roles" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Policies: role_permissions
CREATE POLICY "auth read permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins write permissions ins" ON public.role_permissions
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write permissions upd" ON public.role_permissions
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write permissions del" ON public.role_permissions
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Seed role_permissions
INSERT INTO public.role_permissions(role, permission)
SELECT 'admin'::public.app_role, p FROM unnest(enum_range(NULL::public.app_permission)) p;

INSERT INTO public.role_permissions(role, permission) VALUES
  ('manager','dashboard.view'),
  ('manager','clientes.view'),('manager','clientes.edit'),
  ('manager','collection.view'),('manager','collection.edit'),
  ('manager','mgmv.view'),('manager','mgmv.edit'),
  ('manager','import.use'),
  ('manager','finance.view');

INSERT INTO public.role_permissions(role, permission) VALUES
  ('operator','dashboard.view'),
  ('operator','clientes.view'),('operator','clientes.edit'),
  ('operator','collection.view'),('operator','collection.edit'),
  ('operator','mgmv.view'),
  ('operator','import.use');

INSERT INTO public.role_permissions(role, permission) VALUES
  ('viewer','dashboard.view'),
  ('viewer','clientes.view'),
  ('viewer','collection.view'),
  ('viewer','mgmv.view'),
  ('viewer','finance.view');

-- Bootstrap: first user becomes admin
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_has_any BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin') INTO v_has_any;
  IF v_has_any THEN RETURN false; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid,'admin')
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;
