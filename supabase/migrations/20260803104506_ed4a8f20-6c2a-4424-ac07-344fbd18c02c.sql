ALTER TABLE public.promo_redemptions ADD COLUMN IF NOT EXISTS promo_code text;

UPDATE public.promo_redemptions r
SET promo_code = p.code
FROM public.promo_codes p
WHERE r.promo_id = p.id AND r.promo_code IS NULL;

ALTER TABLE public.promo_redemptions ALTER COLUMN promo_id DROP NOT NULL;

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'public.promo_redemptions'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%promo_codes%' LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.promo_redemptions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.promo_redemptions
  ADD CONSTRAINT promo_redemptions_promo_id_fkey
  FOREIGN KEY (promo_id) REFERENCES public.promo_codes(id) ON DELETE SET NULL;

INSERT INTO public.activity_logs (user_id, user_username, user_telegram_id, action_type, reward_pt, task_title, task_public_id, created_at)
SELECT r.user_id, u.username, u.telegram_id, 'promo_reward', r.reward_pt,
       'Промокод ' || COALESCE(r.promo_code, '—'), COALESCE(r.promo_code, NULL), r.redeemed_at
FROM public.promo_redemptions r
LEFT JOIN public.users u ON u.id = r.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.activity_logs a
  WHERE a.user_id = r.user_id AND a.action_type = 'promo_reward' AND a.created_at = r.redeemed_at
);