
-- Add brand customization columns to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#f97316',
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create logos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for logos bucket
CREATE POLICY "Public can view logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

CREATE POLICY "Authenticated users can upload logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'logos' AND auth.role() = 'authenticated');
