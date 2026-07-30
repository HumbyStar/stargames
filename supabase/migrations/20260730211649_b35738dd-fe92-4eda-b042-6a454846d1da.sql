-- Audit triggers on relevant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','products','mgmv_agreements','mgmv_installments',
    'system_backups','nf_invoices','team_tasks','user_roles',
    'role_permissions','ai_automations','sandbox_state'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',
      t
    );
  END LOOP;
END $$;

-- Index for recent-events listing
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON public.audit_log(changed_at DESC);

-- Realtime for the activity feed
ALTER TABLE public.audit_log REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Allow internal users to see who is currently online
DROP POLICY IF EXISTS "Internal users can view active sessions" ON public.active_sessions;
CREATE POLICY "Internal users can view active sessions"
  ON public.active_sessions FOR SELECT TO authenticated
  USING (public.has_any_internal_role(auth.uid()));