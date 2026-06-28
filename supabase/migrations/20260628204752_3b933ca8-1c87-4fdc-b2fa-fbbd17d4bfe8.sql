-- ============================================================
-- Backfill MGMV: legacy clients.mgmv (jsonb) -> mgmv_agreements + mgmv_installments
-- Idempotente: pula clientes que já têm acordo na tabela oficial.
-- ============================================================
DO $$
DECLARE
  c RECORD;
  ins_record RECORD;
  v_total NUMERIC;
  v_count INT;
  v_value NUMERIC;
  v_paid_count INT;
  v_paid_value NUMERIC;
  v_remaining NUMERIC;
  v_first_due TIMESTAMPTZ;
  v_next_due TIMESTAMPTZ;
  v_needs_review BOOLEAN;
  v_status TEXT;
  v_sum_ins NUMERIC;
BEGIN
  FOR c IN
    SELECT id, name, phone, folder, notes, mgmv
      FROM public.clients
     WHERE mgmv IS NOT NULL
       AND jsonb_typeof(mgmv->'installments') = 'array'
       AND jsonb_array_length(mgmv->'installments') > 0
       AND NOT EXISTS (SELECT 1 FROM public.mgmv_agreements a WHERE a.id = clients.id)
  LOOP
    v_total := COALESCE((c.mgmv->>'totalDebt')::NUMERIC, 0);
    v_count := jsonb_array_length(c.mgmv->'installments');

    SELECT COALESCE((c.mgmv->'installments'->0->>'value')::NUMERIC, 0) INTO v_value;

    SELECT COUNT(*) FILTER (WHERE (i->>'paid')::BOOLEAN IS TRUE),
           COALESCE(SUM(CASE WHEN (i->>'paid')::BOOLEAN THEN (i->>'value')::NUMERIC ELSE 0 END), 0),
           COALESCE(SUM((i->>'value')::NUMERIC), 0)
      INTO v_paid_count, v_paid_value, v_sum_ins
      FROM jsonb_array_elements(c.mgmv->'installments') AS i;

    v_remaining := GREATEST(0, v_total - v_paid_value);

    SELECT MIN((i->>'dueDate')::TIMESTAMPTZ) INTO v_first_due
      FROM jsonb_array_elements(c.mgmv->'installments') AS i;

    SELECT MIN((i->>'dueDate')::TIMESTAMPTZ) INTO v_next_due
      FROM jsonb_array_elements(c.mgmv->'installments') AS i
     WHERE (i->>'paid')::BOOLEAN IS NOT TRUE;

    v_needs_review := v_total > 0 AND ABS(v_sum_ins - v_total) > 0.01;
    v_status := CASE
                  WHEN v_paid_count >= v_count THEN 'Quitado'
                  WHEN v_needs_review THEN 'Revisão necessária'
                  ELSE 'Ativo'
                END;

    INSERT INTO public.mgmv_agreements (
      id, client_id, client_name, client_phone,
      total_agreement_value, installments_count, installment_value,
      paid_installments, pending_installments,
      first_due_date, next_due_date,
      paid_value, remaining_value,
      status, needs_review,
      source_folder, original_notes
    ) VALUES (
      c.id, c.id, c.name, COALESCE(c.phone, ''),
      v_total, v_count, v_value,
      v_paid_count, v_count - v_paid_count,
      v_first_due, v_next_due,
      v_paid_value, v_remaining,
      v_status, v_needs_review,
      c.folder, c.notes
    );

    FOR ins_record IN
      SELECT (i->>'number')::INT AS number,
             (i->>'value')::NUMERIC AS value,
             (i->>'dueDate')::TIMESTAMPTZ AS due_date,
             (i->>'paid')::BOOLEAN AS paid,
             NULLIF(i->>'paidAt','')::TIMESTAMPTZ AS paid_at
        FROM jsonb_array_elements(c.mgmv->'installments') AS i
    LOOP
      INSERT INTO public.mgmv_installments (
        agreement_id, installment_number, amount, due_date, paid_at, status
      ) VALUES (
        c.id,
        ins_record.number,
        ins_record.value,
        ins_record.due_date,
        CASE WHEN ins_record.paid THEN COALESCE(ins_record.paid_at, now()) ELSE NULL END,
        CASE WHEN ins_record.paid THEN 'Paga' ELSE 'Pendente' END
      );
    END LOOP;

    UPDATE public.clients
       SET client_type = 'mgmv'
     WHERE id = c.id AND client_type IS DISTINCT FROM 'mgmv';
  END LOOP;
END $$;

-- Atualiza flags dos produtos para todos os acordos existentes.
UPDATE public.products p
   SET included_in_mgmv = TRUE,
       mgmv_agreement_id = a.id,
       collection_eligible = FALSE
  FROM public.mgmv_agreements a
 WHERE p.client_id = a.client_id
   AND p.financial_status = 'MGMV'
   AND (p.included_in_mgmv IS DISTINCT FROM TRUE
        OR p.mgmv_agreement_id IS DISTINCT FROM a.id
        OR p.collection_eligible IS DISTINCT FROM FALSE);

UPDATE public.products p
   SET included_in_mgmv = FALSE,
       mgmv_agreement_id = NULL,
       collection_eligible = TRUE
 WHERE p.financial_status <> 'MGMV'
   AND (p.included_in_mgmv = TRUE OR p.mgmv_agreement_id IS NOT NULL OR p.collection_eligible = FALSE);
