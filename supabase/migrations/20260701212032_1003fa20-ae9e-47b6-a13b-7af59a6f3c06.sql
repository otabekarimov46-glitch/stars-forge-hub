
DROP TABLE IF EXISTS public.delayed_checks CASCADE;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS recheck_delay_minutes;
