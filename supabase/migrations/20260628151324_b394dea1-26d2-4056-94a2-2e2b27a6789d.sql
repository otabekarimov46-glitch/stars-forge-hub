ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
ALTER TABLE public.video_ads ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS tasks_is_extra_idx ON public.tasks(is_extra) WHERE is_active = true;