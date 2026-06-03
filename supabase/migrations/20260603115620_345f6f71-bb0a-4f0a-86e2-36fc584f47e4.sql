DROP POLICY IF EXISTS "Service role write for video-ads" ON storage.objects;
DROP POLICY IF EXISTS "Service role delete for video-ads" ON storage.objects;

CREATE POLICY "Service role write for video-ads"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'video-ads');

CREATE POLICY "Service role delete for video-ads"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'video-ads');