
-- Only admins can access files in the system-backups bucket
CREATE POLICY "Admins select system-backups objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'system-backups'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  );

CREATE POLICY "Admins insert system-backups objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'system-backups'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  );

CREATE POLICY "Admins update system-backups objects"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'system-backups'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  )
  WITH CHECK (
    bucket_id = 'system-backups'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  );

CREATE POLICY "Admins delete system-backups objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'system-backups'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'admin_master'))
  );
