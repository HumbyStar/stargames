-- ============================================================
-- 1) Estender enums app_role e app_permission
-- ============================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin_master';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gerente';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supervisor';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'funcionario';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'envio';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'mgmv';

ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'team.view';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'team.assign.all';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'team.assign.team';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'team.task.update_own';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'team.task.comment';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'punch.clock';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'shipping.mark_sent';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'mgmv.register_product';

-- ============================================================
-- 2) Helper: can_assign_to (escada empresarial)
-- Precisa ser criado depois do COMMIT do enum (Postgres). Usamos
-- DO/EXECUTE pra defer com texto.
-- ============================================================
COMMIT;
BEGIN;

CREATE OR REPLACE FUNCTION public.can_assign_to(_assigner uuid, _assignee uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_is_gerente boolean;
  v_is_supervisor boolean;
  v_target_roles text[];
BEGIN
  IF _assigner IS NULL OR _assignee IS NULL THEN RETURN false; END IF;
  IF _assigner = _assignee THEN RETURN true; END IF;

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_assigner AND role IN ('admin','admin_master'))
    INTO v_is_admin;
  IF v_is_admin THEN RETURN true; END IF;

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_assigner AND role IN ('manager','gerente'))
    INTO v_is_gerente;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_assigner AND role='supervisor')
    INTO v_is_supervisor;

  SELECT array_agg(role::text) FROM public.user_roles WHERE user_id=_assignee INTO v_target_roles;
  IF v_target_roles IS NULL THEN v_target_roles := ARRAY[]::text[]; END IF;

  IF v_is_gerente THEN
    RETURN v_target_roles && ARRAY['supervisor','funcionario','envio','mgmv','operator','viewer'];
  END IF;

  IF v_is_supervisor THEN
    RETURN v_target_roles && ARRAY['funcionario','envio','mgmv','operator','viewer'];
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_team_tasks(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','admin_master','manager','gerente','supervisor')
  );
$$;

-- ============================================================
-- 3) Popular role_permissions para os novos cargos
-- ============================================================
INSERT INTO public.role_permissions (role, permission)
SELECT r::app_role, p::app_permission FROM (VALUES
  -- admin_master: tudo
  ('admin_master','dashboard.view'),('admin_master','clientes.view'),('admin_master','clientes.edit'),
  ('admin_master','collection.view'),('admin_master','collection.edit'),('admin_master','mgmv.view'),
  ('admin_master','mgmv.edit'),('admin_master','import.use'),('admin_master','finance.view'),
  ('admin_master','settings.view'),('admin_master','users.manage'),
  ('admin_master','team.view'),('admin_master','team.assign.all'),('admin_master','team.assign.team'),
  ('admin_master','team.task.update_own'),('admin_master','team.task.comment'),
  ('admin_master','punch.clock'),('admin_master','shipping.mark_sent'),('admin_master','mgmv.register_product'),
  -- gerente
  ('gerente','dashboard.view'),('gerente','clientes.view'),('gerente','clientes.edit'),
  ('gerente','collection.view'),('gerente','collection.edit'),('gerente','mgmv.view'),
  ('gerente','mgmv.edit'),('gerente','import.use'),('gerente','finance.view'),
  ('gerente','team.view'),('gerente','team.assign.team'),
  ('gerente','team.task.update_own'),('gerente','team.task.comment'),('gerente','punch.clock'),
  -- supervisor
  ('supervisor','dashboard.view'),('supervisor','clientes.view'),('supervisor','clientes.edit'),
  ('supervisor','collection.view'),('supervisor','mgmv.view'),
  ('supervisor','team.view'),('supervisor','team.assign.team'),
  ('supervisor','team.task.update_own'),('supervisor','team.task.comment'),('supervisor','punch.clock'),
  -- funcionario
  ('funcionario','dashboard.view'),('funcionario','clientes.view'),
  ('funcionario','team.view'),('funcionario','team.task.update_own'),
  ('funcionario','team.task.comment'),('funcionario','punch.clock'),
  -- envio: funcionario + shipping
  ('envio','dashboard.view'),('envio','clientes.view'),
  ('envio','team.view'),('envio','team.task.update_own'),('envio','team.task.comment'),
  ('envio','punch.clock'),('envio','shipping.mark_sent'),
  -- mgmv: funcionario + cadastrar produto mgmv
  ('mgmv','dashboard.view'),('mgmv','clientes.view'),('mgmv','mgmv.view'),
  ('mgmv','team.view'),('mgmv','team.task.update_own'),('mgmv','team.task.comment'),
  ('mgmv','punch.clock'),('mgmv','mgmv.register_product')
) AS t(r,p)
ON CONFLICT DO NOTHING;

-- admin existente também ganha as novas permissões de equipe
INSERT INTO public.role_permissions (role, permission)
SELECT 'admin'::app_role, p::app_permission FROM (VALUES
  ('team.view'),('team.assign.all'),('team.assign.team'),
  ('team.task.update_own'),('team.task.comment'),
  ('punch.clock'),('shipping.mark_sent'),('mgmv.register_product')
) AS t(p)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission)
SELECT 'manager'::app_role, p::app_permission FROM (VALUES
  ('team.view'),('team.assign.team'),
  ('team.task.update_own'),('team.task.comment'),('punch.clock')
) AS t(p)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4) Tabela team_tasks
-- ============================================================
CREATE TABLE public.team_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','blocked','done')),
  priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('low','med','high','urgent')),
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  client_id UUID,
  product_id UUID,
  position INT NOT NULL DEFAULT 0,
  tags TEXT[] NOT NULL DEFAULT '{}',
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX team_tasks_assignee_idx ON public.team_tasks(assignee_id);
CREATE INDEX team_tasks_status_idx ON public.team_tasks(status);
CREATE INDEX team_tasks_created_by_idx ON public.team_tasks(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_tasks TO authenticated;
GRANT ALL ON public.team_tasks TO service_role;

ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_tasks select" ON public.team_tasks FOR SELECT TO authenticated
USING (
  assignee_id = auth.uid()
  OR created_by = auth.uid()
  OR public.can_view_team_tasks(auth.uid())
);

CREATE POLICY "team_tasks insert" ON public.team_tasks FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    assignee_id IS NULL
    OR assignee_id = auth.uid()
    OR public.can_assign_to(auth.uid(), assignee_id)
  )
);

CREATE POLICY "team_tasks update" ON public.team_tasks FOR UPDATE TO authenticated
USING (
  assignee_id = auth.uid()
  OR created_by = auth.uid()
  OR public.can_view_team_tasks(auth.uid())
)
WITH CHECK (
  assignee_id IS NULL
  OR assignee_id = auth.uid()
  OR created_by = auth.uid()
  OR public.can_assign_to(auth.uid(), assignee_id)
);

CREATE POLICY "team_tasks delete" ON public.team_tasks FOR DELETE TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'admin_master')
);

CREATE TRIGGER touch_team_tasks_updated_at
BEFORE UPDATE ON public.team_tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 5) Tabela team_task_comments
-- ============================================================
CREATE TABLE public.team_task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.team_tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','completion','observation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX team_task_comments_task_idx ON public.team_task_comments(task_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_task_comments TO authenticated;
GRANT ALL ON public.team_task_comments TO service_role;

ALTER TABLE public.team_task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_task_comments select" ON public.team_task_comments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.team_tasks t
    WHERE t.id = task_id
      AND (t.assignee_id = auth.uid() OR t.created_by = auth.uid() OR public.can_view_team_tasks(auth.uid()))
  )
);

CREATE POLICY "team_task_comments insert" ON public.team_task_comments FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.team_tasks t
    WHERE t.id = task_id
      AND (t.assignee_id = auth.uid() OR t.created_by = auth.uid() OR public.can_view_team_tasks(auth.uid()))
  )
);

CREATE POLICY "team_task_comments delete own" ON public.team_task_comments FOR DELETE TO authenticated
USING (author_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));

-- ============================================================
-- 6) Tabela team_task_activity (auditoria leve)
-- ============================================================
CREATE TABLE public.team_task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.team_tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX team_task_activity_task_idx ON public.team_task_activity(task_id);

GRANT SELECT, INSERT ON public.team_task_activity TO authenticated;
GRANT ALL ON public.team_task_activity TO service_role;

ALTER TABLE public.team_task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_task_activity select" ON public.team_task_activity FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.team_tasks t
    WHERE t.id = task_id
      AND (t.assignee_id = auth.uid() OR t.created_by = auth.uid() OR public.can_view_team_tasks(auth.uid()))
  )
);

CREATE POLICY "team_task_activity insert" ON public.team_task_activity FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());
