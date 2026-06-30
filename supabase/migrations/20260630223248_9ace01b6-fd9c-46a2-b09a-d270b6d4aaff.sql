-- Restore upload access for video-ads bucket (admin panel uses anon key, needs uploads to work)
DROP POLICY IF EXISTS "video_ads_anon_all" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_auth_all" ON storage.objects;

CREATE POLICY "video_ads_anon_all" ON storage.objects
  FOR ALL TO anon
  USING (bucket_id = 'video-ads')
  WITH CHECK (bucket_id = 'video-ads');

CREATE POLICY "video_ads_auth_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'video-ads')
  WITH CHECK (bucket_id = 'video-ads');