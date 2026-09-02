CREATE OR REPLACE FUNCTION public.save_mgmv_agreement_atomic(
  _client_id uuid,
  _agreement jsonb,
  _installments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env public.app_env;
  v_owner uuid;
  v_existing_completed timestamptz;
  v_installment jsonb;
  v_numbers integer[] := ARRAY[]::integer[];
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_internal_role(v_uid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_env := public.current_env();
  v_owner := CASE WHEN v_env = 'sandbox'::public.app_env THEN v_uid ELSE NULL END;
  PERFORM 1 FROM public.clients WHERE id = _client_id AND env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT completed_at INTO v_existing_completed FROM public.mgmv_agreements WHERE id = _client_id AND env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner) FOR UPDATE;
  IF _agreement IS NULL OR _installments IS NULL OR jsonb_typeof(_installments) <> 'array' THEN
    DELETE FROM public.mgmv_agreements WHERE id = _client_id AND env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner) AND completed_at IS NULL;
    UPDATE public.products SET included_in_mgmv = false, mgmv_agreement_id = NULL, collection_eligible = true, updated_at = now() WHERE client_id = _client_id AND env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner);
    RETURN jsonb_build_object('ok', true, 'deleted', true);
  END IF;
  IF jsonb_array_length(_installments) = 0 THEN RAISE EXCEPTION 'agreement_requires_installments' USING ERRCODE = '22023'; END IF;
  IF v_existing_completed IS NOT NULL AND NULLIF(_agreement->>'completed_at', '') IS NULL THEN RAISE EXCEPTION 'agreement_already_completed' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.mgmv_agreements (id, client_id, client_name, client_phone, total_agreement_value, installments_count, installment_value, paid_installments, pending_installments, first_due_date, next_due_date, paid_value, remaining_value, status, completed_at, needs_review, review_status, ai_reviewed, ai_review_applied_at, ai_confidence, ai_review_raw_result, source_folder, original_notes, env, sandbox_owner, updated_at)
  VALUES (_client_id, _client_id, COALESCE(_agreement->>'client_name', ''), COALESCE(_agreement->>'client_phone', ''), NULLIF(_agreement->>'total_agreement_value', '')::numeric, NULLIF(_agreement->>'installments_count', '')::integer, NULLIF(_agreement->>'installment_value', '')::numeric, COALESCE(NULLIF(_agreement->>'paid_installments', '')::integer, 0), NULLIF(_agreement->>'pending_installments', '')::integer, NULLIF(_agreement->>'first_due_date', '')::timestamptz, NULLIF(_agreement->>'next_due_date', '')::timestamptz, COALESCE(NULLIF(_agreement->>'paid_value', '')::numeric, 0), NULLIF(_agreement->>'remaining_value', '')::numeric, COALESCE(_agreement->>'status', 'Ativo'), COALESCE(NULLIF(_agreement->>'completed_at', '')::timestamptz, v_existing_completed), COALESCE((_agreement->>'needs_review')::boolean, false), COALESCE(_agreement->>'review_status', 'none'), COALESCE((_agreement->>'ai_reviewed')::boolean, false), NULLIF(_agreement->>'ai_review_applied_at', '')::timestamptz, NULLIF(_agreement->>'ai_confidence', '')::numeric, _agreement->'ai_review_raw_result', NULLIF(_agreement->>'source_folder', ''), NULLIF(_agreement->>'original_notes', ''), v_env, v_owner, now())
  ON CONFLICT (id) DO UPDATE SET client_name=EXCLUDED.client_name, client_phone=EXCLUDED.client_phone, total_agreement_value=EXCLUDED.total_agreement_value, installments_count=EXCLUDED.installments_count, installment_value=EXCLUDED.installment_value, paid_installments=EXCLUDED.paid_installments, pending_installments=EXCLUDED.pending_installments, first_due_date=EXCLUDED.first_due_date, next_due_date=EXCLUDED.next_due_date, paid_value=EXCLUDED.paid_value, remaining_value=EXCLUDED.remaining_value, status=CASE WHEN mgmv_agreements.completed_at IS NOT NULL THEN 'Quitado' ELSE EXCLUDED.status END, completed_at=COALESCE(mgmv_agreements.completed_at, EXCLUDED.completed_at), needs_review=EXCLUDED.needs_review, review_status=EXCLUDED.review_status, ai_reviewed=EXCLUDED.ai_reviewed, ai_review_applied_at=EXCLUDED.ai_review_applied_at, ai_confidence=EXCLUDED.ai_confidence, ai_review_raw_result=EXCLUDED.ai_review_raw_result, source_folder=EXCLUDED.source_folder, original_notes=EXCLUDED.original_notes, env=EXCLUDED.env, sandbox_owner=EXCLUDED.sandbox_owner, updated_at=now();
  FOR v_installment IN SELECT value FROM jsonb_array_elements(_installments) LOOP
    v_numbers := array_append(v_numbers, (v_installment->>'installment_number')::integer); v_count := v_count + 1;
    INSERT INTO public.mgmv_installments (agreement_id, installment_number, amount, due_date, paid_at, status, paid_amount, manual_partial, env, sandbox_owner, updated_at)
    VALUES (_client_id, (v_installment->>'installment_number')::integer, NULLIF(v_installment->>'amount', '')::numeric, NULLIF(v_installment->>'due_date', '')::timestamptz, NULLIF(v_installment->>'paid_at', '')::timestamptz, COALESCE(v_installment->>'status', 'Pendente'), COALESCE(NULLIF(v_installment->>'paid_amount', '')::numeric, 0), COALESCE((v_installment->>'manual_partial')::boolean, false), v_env, v_owner, now())
    ON CONFLICT (agreement_id, installment_number) DO UPDATE SET amount=EXCLUDED.amount, due_date=EXCLUDED.due_date, paid_at=EXCLUDED.paid_at, status=EXCLUDED.status, paid_amount=EXCLUDED.paid_amount, manual_partial=EXCLUDED.manual_partial, env=EXCLUDED.env, sandbox_owner=EXCLUDED.sandbox_owner, updated_at=now();
  END LOOP;
  DELETE FROM public.mgmv_installments WHERE agreement_id = _client_id AND env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner) AND NOT (installment_number = ANY(v_numbers));
  UPDATE public.products SET included_in_mgmv=(financial_status='MGMV'), mgmv_agreement_id=CASE WHEN financial_status='MGMV' THEN _client_id ELSE NULL END, collection_eligible=(financial_status<>'MGMV'), updated_at=now() WHERE client_id=_client_id AND env=v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner=v_owner);
  RETURN jsonb_build_object('ok', true, 'installments', v_count);
END;
$$;