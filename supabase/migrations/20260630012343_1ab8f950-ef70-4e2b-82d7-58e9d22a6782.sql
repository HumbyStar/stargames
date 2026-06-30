-- 1) Enum de responsabilidades
DO $$ BEGIN
  CREATE TYPE public.user_responsibility AS ENUM (
    'cobranca','mgmv','envio','importacao','revisao_ia',
    'cadastro','financeiro','atendimento','leiloes','admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabela user_responsibilities
CREATE TABLE IF NOT EXISTS public.user_responsibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsibility public.user_responsibility NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, responsibility)
);

GRANT SELECT ON public.user_responsibilities TO authenticated;
GRANT ALL ON public.user_responsibilities TO service_role;

ALTER TABLE public.user_responsibilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own responsibilities or admins/managers see all"
  ON public.user_responsibilities FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'admin_master')
    OR public.has_role(auth.uid(),'gerente')
    OR public.has_role(auth.uid(),'manager')
  );

CREATE POLICY "Admins manage responsibilities"
  ON public.user_responsibilities FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_master'));

-- 3) profiles.can_receive_tasks
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_receive_tasks BOOLEAN NOT NULL DEFAULT true;

-- 4) Campos extras em team_tasks
ALTER TABLE public.team_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS linked_filter JSONB,
  ADD COLUMN IF NOT EXISTS linked_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS linked_entity_id TEXT;

CREATE INDEX IF NOT EXISTS idx_team_tasks_task_type ON public.team_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_user_responsibilities_user ON public.user_responsibilities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_responsibilities_resp ON public.user_responsibilities(responsibility);