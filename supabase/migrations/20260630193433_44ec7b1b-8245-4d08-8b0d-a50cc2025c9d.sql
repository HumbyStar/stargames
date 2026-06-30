
CREATE TABLE public.ai_training_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  onboarding_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  last_analysis_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_training_profile TO authenticated;
GRANT ALL ON public.ai_training_profile TO service_role;
ALTER TABLE public.ai_training_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.ai_training_profile FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own profile insert" ON public.ai_training_profile FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own profile update" ON public.ai_training_profile FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own profile delete" ON public.ai_training_profile FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER ai_training_profile_touch BEFORE UPDATE ON public.ai_training_profile FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ai_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'general',
  trigger TEXT NOT NULL DEFAULT 'manual',
  applies_to TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL DEFAULT '',
  python_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  estimated_ai_savings TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_automations TO authenticated;
GRANT ALL ON public.ai_automations TO service_role;
ALTER TABLE public.ai_automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own auto select" ON public.ai_automations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own auto insert" ON public.ai_automations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own auto update" ON public.ai_automations FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own auto delete" ON public.ai_automations FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER ai_automations_touch BEFORE UPDATE ON public.ai_automations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX ai_automations_user_idx ON public.ai_automations(user_id, created_at DESC);
