
-- Balance math log: append-only line-per-change
CREATE TABLE public.balance_math_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  delta NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_balance_math_log_user ON public.balance_math_log(user_id, id DESC);
GRANT SELECT ON public.balance_math_log TO authenticated;
GRANT ALL ON public.balance_math_log TO service_role;
ALTER TABLE public.balance_math_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access to balance_math_log" ON public.balance_math_log USING (false);

-- Add withdrawal fields
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'usdt',
  ADD COLUMN IF NOT EXISTS amount_usdt NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS request_number BIGSERIAL,
  ADD COLUMN IF NOT EXISTS channel_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS paid_tx_hash TEXT;

-- Default withdrawal minimum settings
INSERT INTO public.settings(key, value) VALUES
  ('min_withdraw_usdt', '1'),
  ('min_withdraw_stars', '50'),
  ('withdraw_channel_id', '-1004319308562'),
  ('support_bot_url', 'https://t.me/starmenthelp_bot'),
  ('usdt_jetton_address', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')
ON CONFLICT (key) DO NOTHING;
