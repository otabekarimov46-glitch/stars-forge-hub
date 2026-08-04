ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS unsub_warn_limit integer NOT NULL DEFAULT 1;
ALTER TABLE public.subscription_checks ADD COLUMN IF NOT EXISTS warn_count integer NOT NULL DEFAULT 0;