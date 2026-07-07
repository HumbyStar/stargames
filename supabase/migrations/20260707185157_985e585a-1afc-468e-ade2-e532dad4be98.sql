DROP POLICY IF EXISTS "notion_html_update_authorized" ON storage.objects;
DROP POLICY IF EXISTS "notion_html_delete_authorized" ON storage.objects;

CREATE POLICY "notion_html_update_authorized"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'notion-html-originals' AND public.can_access_notion_html_originals(auth.uid()))
WITH CHECK (bucket_id = 'notion-html-originals' AND public.can_access_notion_html_originals(auth.uid()));

CREATE POLICY "notion_html_delete_authorized"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'notion-html-originals' AND public.can_access_notion_html_originals(auth.uid()));