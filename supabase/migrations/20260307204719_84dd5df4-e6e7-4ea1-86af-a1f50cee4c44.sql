
-- Drop the broad policies and replace with owner-scoped ones
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete logos" ON storage.objects;

-- Only allow upload/update/delete when the file is in the owner's folder
CREATE POLICY "Owners can upload their logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can update their logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete their logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
