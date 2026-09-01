-- 1) Remove duplicidades de parcela por acordo, mantendo a linha mais "forte"
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY agreement_id, installment_number
           ORDER BY (paid_at IS NOT NULL) DESC,
                    COALESCE(paid_amount, 0) DESC,
                    updated_at DESC,
                    created_at DESC
         ) AS rn
  FROM public.mgmv_installments
)
DELETE FROM public.mgmv_installments i
USING ranked r
WHERE i.id = r.id AND r.rn > 1;

-- 2) Impede novas duplicidades e habilita upsert idempotente
CREATE UNIQUE INDEX IF NOT EXISTS mgmv_installments_agreement_number_key
  ON public.mgmv_installments (agreement_id, installment_number);