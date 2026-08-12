CREATE TABLE public.shipments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  recipient JSONB NOT NULL DEFAULT '{}'::jsonb,
  carrier TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT '',
  eta_days INTEGER,
  price_cents INTEGER NOT NULL DEFAULT 0,
  total_weight_kg NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_ids UUID[] NOT NULL DEFAULT '{}',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Enviado',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  env public.app_env NOT NULL DEFAULT public.current_env(),
  sandbox_owner UUID REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal read shipments" ON public.shipments
  FOR SELECT TO authenticated
  USING (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Shippers insert shipments" ON public.shipments
  FOR INSERT TO authenticated
  WITH CHECK ((public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission)
    OR public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Shippers update shipments" ON public.shipments
  FOR UPDATE TO authenticated
  USING ((public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission)
    OR public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK ((public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission)
    OR public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Shippers delete shipments" ON public.shipments
  FOR DELETE TO authenticated
  USING ((public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission)
    OR public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner));

CREATE TRIGGER shipments_sandbox_owner_guard
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.sandbox_owner_guard();

CREATE TRIGGER shipments_touch_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER audit_shipments
  AFTER INSERT OR UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE INDEX shipments_client_idx ON public.shipments (env, client_id, created_at DESC);

DROP POLICY IF EXISTS "Editors update products" ON public.products;
CREATE POLICY "Editors update products" ON public.products
  FOR UPDATE TO authenticated
  USING ((public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission)
      OR public.has_permission(auth.uid(), 'mgmv.register_product'::public.app_permission)
      OR public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner))
  WITH CHECK ((public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission)
      OR public.has_permission(auth.uid(), 'mgmv.register_product'::public.app_permission)
      OR public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner));