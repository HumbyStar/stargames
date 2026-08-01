CREATE OR REPLACE FUNCTION public.import_history_set_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := v_uid;
  END IF;
  IF NEW.user_email IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT email INTO NEW.user_email FROM auth.users WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_history_set_author ON public.import_history;
CREATE TRIGGER trg_import_history_set_author
BEFORE INSERT ON public.import_history
FOR EACH ROW EXECUTE FUNCTION public.import_history_set_author();