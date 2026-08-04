ALTER TABLE public.mgmv_agreements
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_completed_mgmv_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_completed text := OLD.mgmv ->> 'completedAt';
  v_new_completed text := NEW.mgmv ->> 'completedAt';
  v_old_start text := OLD.mgmv ->> 'startDate';
  v_new_start text := NEW.mgmv ->> 'startDate';
BEGIN
  IF v_old_completed IS NOT NULL
     AND v_new_completed IS NULL
     AND v_old_start IS NOT DISTINCT FROM v_new_start THEN
    NEW.mgmv := OLD.mgmv;
    NEW.client_type := 'common';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_completed_mgmv_client() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_completed_mgmv_client() TO service_role;

DROP TRIGGER IF EXISTS protect_completed_mgmv_client_update ON public.clients;
CREATE TRIGGER protect_completed_mgmv_client_update
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.protect_completed_mgmv_client();

CREATE OR REPLACE FUNCTION public.complete_mgmv_agreement(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env public.app_env;
  v_client public.clients%ROWTYPE;
  v_agreement public.mgmv_agreements%ROWTYPE;
  v_completed_at timestamptz;
  v_moved integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_internal_role(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_env := public.current_env();

  SELECT * INTO v_client
  FROM public.clients
  WHERE id = _client_id
    AND env = v_env
    AND public.env_row_visible(env, sandbox_owner)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_agreement
  FROM public.mgmv_agreements
  WHERE client_id = _client_id
    AND env = v_env
    AND public.env_row_visible(env, sandbox_owner)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agreement_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_agreement.pending_installments, 0) > 0
     OR COALESCE(v_agreement.paid_installments, 0) < COALESCE(v_agreement.installments_count, 0) THEN
    RAISE EXCEPTION 'agreement_not_fully_paid' USING ERRCODE = '22023';
  END IF;

  v_completed_at := COALESCE(v_agreement.completed_at, now());

  UPDATE public.products
  SET financial_status = 'Pago',
      paid_value = total_value,
      situation = CASE
        WHEN situation IN ('Enviado', 'Retirado', 'Removido') THEN situation
        ELSE 'Em Aberto'
      END,
      included_in_mgmv = false,
      mgmv_agreement_id = NULL,
      collection_eligible = true,
      updated_at = now()
  WHERE client_id = _client_id
    AND env = v_env
    AND public.env_row_visible(env, sandbox_owner)
    AND (
      financial_status = 'MGMV'
      OR included_in_mgmv = true
      OR mgmv_agreement_id = v_agreement.id
    );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE public.mgmv_agreements
  SET status = 'Quitado',
      pending_installments = 0,
      remaining_value = 0,
      completed_at = v_completed_at,
      updated_at = now()
  WHERE id = v_agreement.id;

  UPDATE public.clients
  SET client_type = 'common',
      mgmv = jsonb_set(
        COALESCE(mgmv, '{}'::jsonb),
        '{completedAt}',
        to_jsonb(v_completed_at::text),
        true
      ),
      updated_at = now()
  WHERE id = _client_id;

  RETURN jsonb_build_object(
    'ok', true,
    'movedProducts', v_moved,
    'completedAt', v_completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_mgmv_agreement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_mgmv_agreement(uuid) TO authenticated, service_role;

WITH repairable AS (
  SELECT a.id, a.client_id, COALESCE(a.completed_at, a.updated_at, now()) AS completed_at
  FROM public.mgmv_agreements a
  WHERE a.status = 'Quitado'
    AND NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.client_id = a.client_id
        AND p.env = a.env
        AND p.sandbox_owner IS NOT DISTINCT FROM a.sandbox_owner
        AND (p.financial_status = 'MGMV' OR p.included_in_mgmv OR p.mgmv_agreement_id = a.id)
    )
), repaired_agreements AS (
  UPDATE public.mgmv_agreements a
  SET completed_at = r.completed_at,
      pending_installments = 0,
      remaining_value = 0,
      updated_at = now()
  FROM repairable r
  WHERE a.id = r.id
  RETURNING a.client_id, a.completed_at
)
UPDATE public.clients c
SET client_type = 'common',
    mgmv = jsonb_set(
      COALESCE(c.mgmv, '{}'::jsonb),
      '{completedAt}',
      to_jsonb(r.completed_at::text),
      true
    ),
    updated_at = now()
FROM repaired_agreements r
WHERE c.id = r.client_id;