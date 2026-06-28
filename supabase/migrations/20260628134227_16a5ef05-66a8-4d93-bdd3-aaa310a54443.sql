-- Allow uploads to video-ads bucket from anon/authenticated (admin panel uses anon key)
DROP POLICY IF EXISTS "video_ads_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_public_update" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_public_delete" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_public_select" ON storage.objects;

CREATE POLICY "video_ads_public_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'video-ads');

CREATE POLICY "video_ads_public_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'video-ads')
  WITH CHECK (bucket_id = 'video-ads');

CREATE POLICY "video_ads_public_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'video-ads');

CREATE POLICY "video_ads_public_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'video-ads');