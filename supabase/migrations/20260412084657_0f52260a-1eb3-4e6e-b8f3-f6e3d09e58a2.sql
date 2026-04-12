
-- Add new task types
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'view_post';
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'reaction';

-- Add fields to tasks table
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS post_url text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS reaction_emoji text;

-- Add captcha fields to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS captcha_pending text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS captcha_answer integer;

-- Create delayed_checks table for 72h verification
CREATE TABLE IF NOT EXISTS public.delayed_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  check_at timestamptz NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  reward_deducted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delayed_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to delayed_checks" ON public.delayed_checks FOR ALL USING (false);

CREATE INDEX idx_delayed_checks_check_at ON public.delayed_checks(check_at) WHERE checked = false;

-- Create storage bucket for video ads
INSERT INTO storage.buckets (id, name, public) VALUES ('video-ads', 'video-ads', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for video-ads bucket
CREATE POLICY "Public read access for video-ads"
ON storage.objects FOR SELECT
USING (bucket_id = 'video-ads');

-- Service role write access (edge functions use service role)
CREATE POLICY "Service role write for video-ads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'video-ads');

CREATE POLICY "Service role delete for video-ads"
ON storage.objects FOR DELETE
USING (bucket_id = 'video-ads');
