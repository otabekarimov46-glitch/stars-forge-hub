
-- Add daily bonus tracking to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS daily_bonus_at timestamp with time zone;

-- Add task limits for advertisers
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS max_completions integer DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS current_completions integer DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS hold_days integer DEFAULT 5;

-- Add external link to video ads (shown after 100% watch)
ALTER TABLE public.video_ads ADD COLUMN IF NOT EXISTS external_link_url text;
ALTER TABLE public.video_ads ADD COLUMN IF NOT EXISTS external_link_label text DEFAULT 'Перейти';
