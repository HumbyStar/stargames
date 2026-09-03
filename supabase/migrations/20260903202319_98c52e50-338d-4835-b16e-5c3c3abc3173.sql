CREATE OR REPLACE FUNCTION public.dashboard_aggregates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env public.app_env;
  v_owner uuid;
  v_now timestamptz := now();
  v_products jsonb;
  v_clients jsonb;
  v_mgmv bigint;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_internal_role(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_env := public.current_env();
  v_owner := CASE WHEN v_env = 'sandbox'::public.app_env THEN v_uid ELSE NULL END;

  SELECT jsonb_build_object(
    'totalProducts', count(*),
    'reservasAtivas', count(*) FILTER (WHERE financial_status = 'Reserva' AND situation = 'Em Aberto'),
    'reservasVencidas', count(*) FILTER (WHERE financial_status = 'Reserva' AND situation = 'Em Aberto' AND due_date < v_now),
    'pendencias', count(*) FILTER (WHERE financial_status = 'Pendente' AND situation = 'Em Aberto'),
    'pendenciasVencidas', count(*) FILTER (WHERE financial_status = 'Pendente' AND situation = 'Em Aberto' AND due_date < v_now),
    'pagosAgEnvio', count(*) FILTER (WHERE financial_status = 'Pago' AND situation = 'Em Aberto'),
    'enviados', count(*) FILTER (WHERE situation = 'Enviado'),
    'desistencias', count(*) FILTER (WHERE situation = 'Desistiu'),
    'abandonos', count(*) FILTER (WHERE situation = 'Abandonou'),
    'retirar', count(*) FILTER (WHERE situation = 'Retirar'),
    'retirados', count(*) FILTER (WHERE situation = 'Retirado'),
    'removidos', count(*) FILTER (WHERE situation = 'Removido'),
    'cobrancaAtiva', count(*) FILTER (WHERE financial_status IN ('Reserva','Pendente') AND situation = 'Em Aberto' AND included_in_mgmv = false AND due_date < v_now),
    'aberto', count(*) FILTER (WHERE situation = 'Em Aberto'),
    'finPago', count(*) FILTER (WHERE financial_status = 'Pago'),
    'finReserva', count(*) FILTER (WHERE financial_status = 'Reserva'),
    'finMGMV', count(*) FILTER (WHERE financial_status = 'MGMV'),
    'finPend', count(*) FILTER (WHERE financial_status = 'Pendente')
  ) INTO v_products
  FROM public.products
  WHERE env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner);

  SELECT jsonb_build_object(
    'totalClients', count(*),
    'clientesMGMV', count(*) FILTER (WHERE client_type = 'mgmv')
  ) INTO v_clients
  FROM public.clients
  WHERE env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner);

  SELECT count(*) INTO v_mgmv
  FROM public.mgmv_installments
  WHERE env = v_env AND (v_env <> 'sandbox'::public.app_env OR sandbox_owner = v_owner)
    AND status <> 'Paga' AND due_date < v_now;

  RETURN v_products || v_clients || jsonb_build_object('mgmvVencidas', COALESCE(v_mgmv, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_aggregates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_aggregates() FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_aggregates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_aggregates() TO service_role;