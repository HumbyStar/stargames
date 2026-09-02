CREATE OR REPLACE FUNCTION public.can_assign_to(_assigner uuid, _assignee uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assigner_rank int;
  v_target_max_rank int;
  v_unknown_target boolean;
BEGIN
  IF _assigner IS NULL OR _assignee IS NULL THEN RETURN false; END IF;
  IF _assigner = _assignee THEN RETURN true; END IF;

  -- Hierarquia explícita. Qualquer papel novo (ainda não mapeado) recebe NULL
  -- e o resultado é sempre negar: nunca "abre" sozinho ao evoluir o enum.
  SELECT max(CASE role::text
      WHEN 'admin_master' THEN 100
      WHEN 'admin'        THEN 90
      WHEN 'manager'      THEN 70
      WHEN 'gerente'      THEN 70
      WHEN 'supervisor'   THEN 50
      WHEN 'funcionario'  THEN 20
      WHEN 'operator'     THEN 20
      WHEN 'envio'        THEN 20
      WHEN 'mgmv'         THEN 20
      WHEN 'viewer'       THEN 10
      ELSE NULL END)
    INTO v_assigner_rank
  FROM public.user_roles WHERE user_id = _assigner;

  IF v_assigner_rank IS NULL THEN RETURN false; END IF;
  IF v_assigner_rank >= 90 THEN RETURN true; END IF;   -- admin / admin_master
  IF v_assigner_rank < 50 THEN RETURN false; END IF;   -- abaixo de supervisor não delega

  SELECT
    max(CASE role::text
      WHEN 'admin_master' THEN 100
      WHEN 'admin'        THEN 90
      WHEN 'manager'      THEN 70
      WHEN 'gerente'      THEN 70
      WHEN 'supervisor'   THEN 50
      WHEN 'funcionario'  THEN 20
      WHEN 'operator'     THEN 20
      WHEN 'envio'        THEN 20
      WHEN 'mgmv'         THEN 20
      WHEN 'viewer'       THEN 10
      ELSE NULL END),
    bool_or(role::text NOT IN ('admin_master','admin','manager','gerente','supervisor','funcionario','operator','envio','mgmv','viewer'))
    INTO v_target_max_rank, v_unknown_target
  FROM public.user_roles WHERE user_id = _assignee;

  -- Papel desconhecido no destinatário: negar (fail closed).
  IF COALESCE(v_unknown_target, false) THEN RETURN false; END IF;
  IF v_target_max_rank IS NULL THEN RETURN false; END IF;

  RETURN v_target_max_rank < v_assigner_rank;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.can_assign_to(uuid, uuid) FROM anon;