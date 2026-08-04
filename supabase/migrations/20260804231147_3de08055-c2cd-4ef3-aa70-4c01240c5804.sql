CREATE OR REPLACE FUNCTION public.protect_completed_mgmv_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL
     AND NEW.completed_at IS NULL
     AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at THEN
    NEW.completed_at := OLD.completed_at;
    NEW.status := 'Quitado';
    NEW.pending_installments := 0;
    NEW.remaining_value := 0;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_completed_mgmv_agreement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_completed_mgmv_agreement() TO service_role;

DROP TRIGGER IF EXISTS protect_completed_mgmv_agreement_update ON public.mgmv_agreements;
CREATE TRIGGER protect_completed_mgmv_agreement_update
BEFORE UPDATE ON public.mgmv_agreements
FOR EACH ROW
EXECUTE FUNCTION public.protect_completed_mgmv_agreement();