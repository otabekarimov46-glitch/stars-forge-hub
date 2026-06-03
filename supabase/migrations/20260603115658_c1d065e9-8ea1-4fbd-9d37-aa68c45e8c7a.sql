-- Drop broad SELECT policy that allowed listing; public URLs still work for public buckets
DROP POLICY IF EXISTS "Public read access for video-ads" ON storage.objects;

-- Trigger function should not be callable by API roles
REVOKE EXECUTE ON FUNCTION public.check_suspicious_ip() FROM PUBLIC, anon, authenticated;