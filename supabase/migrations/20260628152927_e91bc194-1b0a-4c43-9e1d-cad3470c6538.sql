
-- Drop public write/list policies on video-ads bucket
DROP POLICY IF EXISTS "video_ads_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_public_update" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_public_delete" ON storage.objects;
DROP POLICY IF EXISTS "video_ads_public_select" ON storage.objects;

-- Allow direct file reads via public URL (no listing). Bucket is public so
-- object URLs continue to work; we just don't grant a permissive SELECT policy
-- that enables listing the bucket contents.
-- Service role retains full access via existing "Service role write/delete for video-ads" policies.
