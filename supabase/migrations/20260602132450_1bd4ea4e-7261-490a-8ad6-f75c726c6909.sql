ALTER TABLE public.video_ads ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'video';

DELETE FROM public.admin_alerts;