ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_earnings_pt numeric(12,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_referrer_id ON public.users(referrer_id);
INSERT INTO public.settings(key, value) VALUES ('bot_username', '') ON CONFLICT (key) DO NOTHING;