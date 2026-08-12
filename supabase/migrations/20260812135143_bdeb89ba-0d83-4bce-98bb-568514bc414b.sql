-- nf_invoices: escopo por autoria + cargos de gestão
DROP POLICY IF EXISTS "Internal roles can view nf_invoices" ON public.nf_invoices;

CREATE POLICY "Owners and managers can view nf_invoices"
ON public.nf_invoices
FOR SELECT
TO authenticated
USING (
  public.env_row_visible(env, sandbox_owner)
  AND (
    generated_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin_master'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
  )
);

-- active_sessions: leitura ampla apenas para administradores
DROP POLICY IF EXISTS "Internal users can view active sessions" ON public.active_sessions;

CREATE POLICY "Admins can view all active sessions"
ON public.active_sessions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin_master'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Tira active_sessions da publicação em tempo real
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'active_sessions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.active_sessions';
  END IF;
END;
$$;