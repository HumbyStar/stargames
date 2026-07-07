
-- 1) Novas colunas em clients para rastrear o HTML original importado
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS original_html_file_name TEXT,
  ADD COLUMN IF NOT EXISTS original_html_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS original_html_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_html_source_folder TEXT,
  ADD COLUMN IF NOT EXISTS original_html_checksum TEXT;

-- 2) Função auxiliar que autoriza leitura/escrita do HTML original.
CREATE OR REPLACE FUNCTION public.can_access_notion_html_originals(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('admin','admin_master','manager','gerente','supervisor')
  );
$$;

-- 3) Políticas de storage: bucket privado 'notion-html-originals'.
DROP POLICY IF EXISTS "notion_html_select_authorized" ON storage.objects;
DROP POLICY IF EXISTS "notion_html_insert_authorized" ON storage.objects;
DROP POLICY IF EXISTS "notion_html_update_authorized" ON storage.objects;
DROP POLICY IF EXISTS "notion_html_delete_authorized" ON storage.objects;

CREATE POLICY "notion_html_select_authorized"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'notion-html-originals'
  AND public.can_access_notion_html_originals(auth.uid())
);

CREATE POLICY "notion_html_insert_authorized"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'notion-html-originals'
  AND public.can_access_notion_html_originals(auth.uid())
);
