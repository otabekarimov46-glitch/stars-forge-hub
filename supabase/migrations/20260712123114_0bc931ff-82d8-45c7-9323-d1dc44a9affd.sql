
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  user_username text,
  user_telegram_id bigint,
  action_type text NOT NULL,
  task_id uuid,
  task_public_id text,
  task_title text,
  video_ad_id uuid,
  advertiser_id uuid,
  advertiser_public_id text,
  advertiser_name text,
  reward_pt numeric NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_action_type_idx ON public.activity_logs (action_type);
CREATE INDEX IF NOT EXISTS activity_logs_task_public_id_idx ON public.activity_logs (task_public_id);
CREATE INDEX IF NOT EXISTS activity_logs_advertiser_public_id_idx ON public.activity_logs (advertiser_public_id);
CREATE INDEX IF NOT EXISTS activity_logs_user_username_idx ON public.activity_logs (user_username);

GRANT ALL ON public.activity_logs TO service_role;

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
