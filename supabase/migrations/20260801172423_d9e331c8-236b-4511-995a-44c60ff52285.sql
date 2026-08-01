ALTER TABLE public.import_history
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS raw_content TEXT;

UPDATE public.import_history h
SET user_id = a.user_id, user_email = a.user_email
FROM (
  SELECT DISTINCT ON (row_id) row_id, user_id, user_email
  FROM public.audit_log
  WHERE table_name = 'import_history' AND action = 'INSERT'
  ORDER BY row_id, changed_at ASC
) a
WHERE a.row_id = h.id::text AND h.user_id IS NULL;