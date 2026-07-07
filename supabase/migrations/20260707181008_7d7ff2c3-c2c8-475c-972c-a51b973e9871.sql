
CREATE TABLE IF NOT EXISTS public.notion_html_access_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('view_original_notion_html','download_original_notion_html')),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notion_html_access_log_client_idx
  ON public.notion_html_access_log(client_id, created_at DESC);

GRANT SELECT, INSERT ON public.notion_html_access_log TO authenticated;
GRANT ALL ON public.notion_html_access_log TO service_role;

ALTER TABLE public.notion_html_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notion_html_access_log_insert_authorized"
ON public.notion_html_access_log FOR INSERT
TO authenticated
WITH CHECK (
  public.can_access_notion_html_originals(auth.uid())
  AND (user_id IS NULL OR user_id = auth.uid())
);

CREATE POLICY "notion_html_access_log_select_authorized"
ON public.notion_html_access_log FOR SELECT
TO authenticated
USING (public.can_access_notion_html_originals(auth.uid()));
