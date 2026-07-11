
CREATE TABLE IF NOT EXISTS public.subscription_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  telegram_id bigint NOT NULL,
  channel_id text,
  channel_username text,
  reward_pt numeric NOT NULL DEFAULT 0,
  check_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.subscription_checks TO service_role;

ALTER TABLE public.subscription_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_only_subscription_checks" ON public.subscription_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sub_checks_pending
  ON public.subscription_checks (check_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sub_checks_user_unresolved
  ON public.subscription_checks (user_id)
  WHERE status = 'unsub';

CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_checks_pending_per_task
  ON public.subscription_checks (user_id, task_id)
  WHERE status IN ('pending','unsub');

CREATE OR REPLACE FUNCTION public.set_updated_at_sub_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sub_checks_updated ON public.subscription_checks;
CREATE TRIGGER trg_sub_checks_updated
  BEFORE UPDATE ON public.subscription_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_sub_check();

INSERT INTO public.settings (key, value)
VALUES ('sub_recheck_minutes', '60')
ON CONFLICT (key) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
