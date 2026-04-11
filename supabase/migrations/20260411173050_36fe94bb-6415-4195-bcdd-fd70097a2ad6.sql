
-- Enum types
CREATE TYPE public.task_type AS ENUM ('subscribe', 'video');
CREATE TYPE public.withdrawal_status AS ENUM ('pending', 'approved', 'rejected');

-- 1. users
CREATE TABLE public.users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  balance_pt NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_frozen BOOLEAN NOT NULL DEFAULT false,
  is_banned BOOLEAN NOT NULL DEFAULT false,
  is_suspicious BOOLEAN NOT NULL DEFAULT false,
  referrer_id UUID REFERENCES public.users(id),
  captcha_count INT NOT NULL DEFAULT 0,
  violation_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 2. user_ips
CREATE TABLE public.user_ips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, ip_address)
);
ALTER TABLE public.user_ips ENABLE ROW LEVEL SECURITY;

-- 3. tasks
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type public.task_type NOT NULL,
  channel_username TEXT,
  channel_id BIGINT,
  reward_pt NUMERIC(8,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 4. task_completions
CREATE TABLE public.task_completions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, task_id)
);
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

-- 5. video_ads
CREATE TABLE public.video_ads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  duration_seconds INT NOT NULL,
  reward_pt NUMERIC(8,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.video_ads ENABLE ROW LEVEL SECURITY;

-- 6. video_views
CREATE TABLE public.video_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_ad_id UUID NOT NULL REFERENCES public.video_ads(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  rewarded BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;

-- 7. withdrawals
CREATE TABLE public.withdrawals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount_pt NUMERIC(12,2) NOT NULL,
  amount_stars NUMERIC(12,2) NOT NULL,
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  ip_address INET NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- 8. admin_alerts
CREATE TABLE public.admin_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

-- 9. settings
CREATE TABLE public.settings (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- 10. logs_activity
CREATE TABLE public.logs_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  ip_address INET,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.logs_activity ENABLE ROW LEVEL SECURITY;

-- Anti-fraud trigger on user_ips
CREATE OR REPLACE FUNCTION public.check_suspicious_ip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ip_user_count INT;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO ip_user_count
  FROM public.user_ips
  WHERE ip_address = NEW.ip_address;

  IF ip_user_count > 2 THEN
    UPDATE public.users SET is_suspicious = true
    WHERE id IN (SELECT user_id FROM public.user_ips WHERE ip_address = NEW.ip_address);

    INSERT INTO public.admin_alerts (type, user_id, message)
    VALUES (
      'suspicious_ip',
      NEW.user_id,
      'IP ' || NEW.ip_address::text || ' используется ' || ip_user_count::text || ' аккаунтами. Все помечены как подозрительные.'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_suspicious_ip
AFTER INSERT ON public.user_ips
FOR EACH ROW
EXECUTE FUNCTION public.check_suspicious_ip();

-- RLS policies: all tables accessed via service_role key from edge functions/bot
-- No direct client access needed, so we add restrictive policies

-- Service role bypasses RLS, so these policies block anon/authenticated direct access
CREATE POLICY "No direct access to users" ON public.users FOR ALL USING (false);
CREATE POLICY "No direct access to user_ips" ON public.user_ips FOR ALL USING (false);
CREATE POLICY "No direct access to tasks" ON public.tasks FOR ALL USING (false);
CREATE POLICY "No direct access to task_completions" ON public.task_completions FOR ALL USING (false);
CREATE POLICY "No direct access to video_ads" ON public.video_ads FOR ALL USING (false);
CREATE POLICY "No direct access to video_views" ON public.video_views FOR ALL USING (false);
CREATE POLICY "No direct access to withdrawals" ON public.withdrawals FOR ALL USING (false);
CREATE POLICY "No direct access to admin_alerts" ON public.admin_alerts FOR ALL USING (false);
CREATE POLICY "No direct access to settings" ON public.settings FOR ALL USING (false);
CREATE POLICY "No direct access to logs_activity" ON public.logs_activity FOR ALL USING (false);

-- Seed initial settings
INSERT INTO public.settings (key, value) VALUES ('exchange_rate', '1');

-- Indexes for performance
CREATE INDEX idx_user_ips_ip ON public.user_ips(ip_address);
CREATE INDEX idx_video_views_user ON public.video_views(user_id);
CREATE INDEX idx_withdrawals_user ON public.withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON public.withdrawals(status);
CREATE INDEX idx_logs_activity_user ON public.logs_activity(user_id);
CREATE INDEX idx_logs_activity_action ON public.logs_activity(action);
CREATE INDEX idx_admin_alerts_unread ON public.admin_alerts(is_read) WHERE is_read = false;
CREATE INDEX idx_task_completions_user ON public.task_completions(user_id);
