ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sub_recheck_minutes integer NOT NULL DEFAULT 60;