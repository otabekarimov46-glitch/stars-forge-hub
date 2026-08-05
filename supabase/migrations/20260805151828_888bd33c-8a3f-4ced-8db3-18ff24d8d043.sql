ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS ref_from_user_id uuid,
  ADD COLUMN IF NOT EXISTS ref_from_username text,
  ADD COLUMN IF NOT EXISTS ref_from_telegram_id bigint,
  ADD COLUMN IF NOT EXISTS ref_percent numeric,
  ADD COLUMN IF NOT EXISTS ref_source_log_id uuid;

CREATE INDEX IF NOT EXISTS activity_logs_ref_source_log_id_idx ON public.activity_logs (ref_source_log_id);
CREATE INDEX IF NOT EXISTS activity_logs_action_type_idx ON public.activity_logs (action_type);