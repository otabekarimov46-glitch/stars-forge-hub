
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recheck_delay_minutes INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.delayed_checks
  ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_delayed_checks_user_pending
  ON public.delayed_checks (user_id) WHERE checked = false;

CREATE INDEX IF NOT EXISTS idx_delayed_checks_redo
  ON public.delayed_checks (user_id, task_id) WHERE reward_deducted = true AND acknowledged = false;
