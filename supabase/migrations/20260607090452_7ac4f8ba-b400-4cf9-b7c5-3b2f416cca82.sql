ALTER TABLE public.video_views
  ADD COLUMN IF NOT EXISTS session_secret TEXT,
  ADD COLUMN IF NOT EXISTS checkpoints JSONB NOT NULL DEFAULT '[]'::jsonb;