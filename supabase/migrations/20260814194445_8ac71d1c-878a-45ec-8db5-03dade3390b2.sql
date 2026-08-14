ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS superfrete_order_id text,
  ADD COLUMN IF NOT EXISTS superfrete_status text,
  ADD COLUMN IF NOT EXISTS selected_service_id text,
  ADD COLUMN IF NOT EXISTS selected_service_name text,
  ADD COLUMN IF NOT EXISTS estimated_delivery_days integer,
  ADD COLUMN IF NOT EXISTS tracking_code text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS payload_quote jsonb,
  ADD COLUMN IF NOT EXISTS response_quote jsonb,
  ADD COLUMN IF NOT EXISTS payload_cart jsonb,
  ADD COLUMN IF NOT EXISTS response_cart jsonb,
  ADD COLUMN IF NOT EXISTS response_order_info jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS shipments_superfrete_order_id_idx ON public.shipments (superfrete_order_id);

CREATE TABLE IF NOT EXISTS public.shipment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  action text NOT NULL,
  previous_status text,
  new_status text,
  message text,
  payload jsonb,
  response jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  env public.app_env NOT NULL DEFAULT public.current_env(),
  sandbox_owner uuid
);

GRANT SELECT, INSERT ON public.shipment_logs TO authenticated;
GRANT ALL ON public.shipment_logs TO service_role;

ALTER TABLE public.shipment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal read shipment_logs" ON public.shipment_logs
  FOR SELECT TO authenticated
  USING (public.has_any_internal_role(auth.uid()) AND public.env_row_visible(env, sandbox_owner));

CREATE POLICY "Shippers insert shipment_logs" ON public.shipment_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_permission(auth.uid(), 'shipping.mark_sent'::public.app_permission)
      OR public.has_permission(auth.uid(), 'clientes.edit'::public.app_permission))
    AND public.env_row_visible(env, sandbox_owner)
  );

CREATE TRIGGER shipment_logs_sandbox_owner_guard
  BEFORE INSERT OR UPDATE ON public.shipment_logs
  FOR EACH ROW EXECUTE FUNCTION public.sandbox_owner_guard();

CREATE INDEX IF NOT EXISTS shipment_logs_shipment_idx ON public.shipment_logs (shipment_id, created_at DESC);