
-- 1) Track "online" users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON public.users (last_seen_at);

-- 2) TON wallet address per user
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ton_wallet_address text;

-- 3) Per-task subscribe re-check (minutes). NULL = use no re-check (global setting removed).
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recheck_minutes integer;

-- 4) Prevent duplicate promo codes (case-insensitive) — de-dupe first, then unique index.
WITH ranked AS (
  SELECT id, lower(code) AS lc,
         row_number() OVER (PARTITION BY lower(code) ORDER BY created_at ASC, id ASC) AS rn
  FROM public.promo_codes
)
DELETE FROM public.promo_codes p
USING ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_lower_key
  ON public.promo_codes (lower(code));

-- 5) USDT rate setting default
INSERT INTO public.settings (key, value)
VALUES ('usdt_rate', '0.02')
ON CONFLICT (key) DO NOTHING;
