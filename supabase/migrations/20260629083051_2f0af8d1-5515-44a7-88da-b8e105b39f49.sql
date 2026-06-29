
-- ============= PUNCH (Ponto eletrônico) =============
DO $$ BEGIN
  CREATE TYPE public.punch_kind AS ENUM ('in','lunch_out','lunch_in','out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.team_punch_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  kind public.punch_kind NOT NULL,
  punched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  feedback_mood SMALLINT,           -- 1..5 (saída final)
  feedback_environment SMALLINT,    -- 1..5 (saída final)
  feedback_optimization TEXT,       -- texto livre (saída final)
  feedback_notes TEXT,              -- observação opcional
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_punch_user_day ON public.team_punch_entries(user_id, day DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_punch_user_day_kind ON public.team_punch_entries(user_id, day, kind);

GRANT SELECT, INSERT, UPDATE ON public.team_punch_entries TO authenticated;
GRANT ALL ON public.team_punch_entries TO service_role;

ALTER TABLE public.team_punch_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "punch_select_own_or_supervisor" ON public.team_punch_entries;
CREATE POLICY "punch_select_own_or_supervisor" ON public.team_punch_entries
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_master')
    OR public.has_role(auth.uid(),'manager')
    OR public.has_role(auth.uid(),'gerente')
    OR public.has_role(auth.uid(),'supervisor')
  );

DROP POLICY IF EXISTS "punch_insert_self" ON public.team_punch_entries;
CREATE POLICY "punch_insert_self" ON public.team_punch_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "punch_update_self_recent" ON public.team_punch_entries;
CREATE POLICY "punch_update_self_recent" ON public.team_punch_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND punched_at > now() - interval '30 minutes')
  WITH CHECK (user_id = auth.uid());

-- ============= Reforço de permissões por papel =============
-- punch.clock para todos os papéis operacionais
INSERT INTO public.role_permissions (role, permission)
SELECT r::app_role, 'punch.clock'::app_permission
FROM unnest(ARRAY[
  'admin','admin_master','manager','gerente','supervisor',
  'funcionario','envio','mgmv','operator','viewer'
]) AS r
ON CONFLICT DO NOTHING;

-- shipping.mark_sent apenas para envio/admin/admin_master
INSERT INTO public.role_permissions (role, permission)
SELECT r::app_role, 'shipping.mark_sent'::app_permission
FROM unnest(ARRAY['envio','admin','admin_master']) AS r
ON CONFLICT DO NOTHING;

-- mgmv.register_product apenas para mgmv/admin/admin_master
INSERT INTO public.role_permissions (role, permission)
SELECT r::app_role, 'mgmv.register_product'::app_permission
FROM unnest(ARRAY['mgmv','admin','admin_master']) AS r
ON CONFLICT DO NOTHING;

-- team.assign.all para admin/admin_master, team.assign.team para gerente/supervisor
INSERT INTO public.role_permissions (role, permission) VALUES
  ('admin','team.assign.all'),
  ('admin_master','team.assign.all'),
  ('manager','team.assign.team'),
  ('gerente','team.assign.team'),
  ('supervisor','team.assign.team')
ON CONFLICT DO NOTHING;

-- team.view para papéis com visão de equipe
INSERT INTO public.role_permissions (role, permission)
SELECT r::app_role, 'team.view'::app_permission
FROM unnest(ARRAY['admin','admin_master','manager','gerente','supervisor','funcionario','envio','mgmv']) AS r
ON CONFLICT DO NOTHING;
