
ALTER TABLE public.video_ads
  ADD COLUMN IF NOT EXISTS advertiser_id uuid REFERENCES public.advertisers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_video_ads_advertiser ON public.video_ads(advertiser_id);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'delayed-check-every-10min';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'delayed-check-every-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qdnzeihwtdefdnpyslng.supabase.co/functions/v1/delayed-check',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkbnplaWh3dGRlZmRucHlzbG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MjIzNTksImV4cCI6MjA5MTQ5ODM1OX0.GHfBJ7nvy02yZiRvqReJ8TQFBg1DPZ3t-DVYCcqXoao'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
