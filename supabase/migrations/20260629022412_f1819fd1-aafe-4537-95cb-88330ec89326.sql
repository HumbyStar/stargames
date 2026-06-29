
ALTER TABLE public.mgmv_agreements
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_review_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_review_raw_result jsonb;

ALTER TABLE public.mgmv_agreements
  DROP CONSTRAINT IF EXISTS mgmv_agreements_review_status_check;

ALTER TABLE public.mgmv_agreements
  ADD CONSTRAINT mgmv_agreements_review_status_check
  CHECK (review_status IN ('none','review_required','ai_reviewed','manually_reviewed'));

UPDATE public.mgmv_agreements
SET review_status = CASE
  WHEN review_status IN ('ai_reviewed','manually_reviewed') THEN review_status
  WHEN needs_review IS TRUE THEN 'review_required'
  ELSE 'none'
END;
