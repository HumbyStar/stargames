CREATE POLICY "Admins can read database export backups"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'database_export_31_07_26'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
);

CREATE POLICY "Admins can upload database export backups"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'database_export_31_07_26'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
);

CREATE POLICY "Admins can update database export backups"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'database_export_31_07_26'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
)
WITH CHECK (
  bucket_id = 'database_export_31_07_26'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
);

CREATE POLICY "Admins can delete database export backups"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'database_export_31_07_26'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
);