
-- Add unique 9-digit public IDs to advertisers, tasks, and video_ads
ALTER TABLE public.advertisers ADD COLUMN IF NOT EXISTS public_id text UNIQUE;
ALTER TABLE public.tasks       ADD COLUMN IF NOT EXISTS public_id text UNIQUE;
ALTER TABLE public.video_ads   ADD COLUMN IF NOT EXISTS public_id text UNIQUE;

-- Generator: 9 random digits, retry on collision across all three tables
CREATE OR REPLACE FUNCTION public.gen_public_id9()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate text;
  tries int := 0;
BEGIN
  LOOP
    candidate := lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
    IF NOT EXISTS (SELECT 1 FROM public.advertisers WHERE public_id = candidate)
       AND NOT EXISTS (SELECT 1 FROM public.tasks     WHERE public_id = candidate)
       AND NOT EXISTS (SELECT 1 FROM public.video_ads WHERE public_id = candidate)
    THEN
      RETURN candidate;
    END IF;
    tries := tries + 1;
    IF tries > 50 THEN
      RAISE EXCEPTION 'Could not generate unique public_id after 50 tries';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.gen_public_id9();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advertisers_public_id ON public.advertisers;
CREATE TRIGGER trg_advertisers_public_id BEFORE INSERT ON public.advertisers
  FOR EACH ROW EXECUTE FUNCTION public.assign_public_id();

DROP TRIGGER IF EXISTS trg_tasks_public_id ON public.tasks;
CREATE TRIGGER trg_tasks_public_id BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.assign_public_id();

DROP TRIGGER IF EXISTS trg_video_ads_public_id ON public.video_ads;
CREATE TRIGGER trg_video_ads_public_id BEFORE INSERT ON public.video_ads
  FOR EACH ROW EXECUTE FUNCTION public.assign_public_id();

-- Backfill existing rows one-by-one so gen_public_id9 sees prior inserts
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.advertisers WHERE public_id IS NULL LOOP
    UPDATE public.advertisers SET public_id = public.gen_public_id9() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.tasks WHERE public_id IS NULL LOOP
    UPDATE public.tasks SET public_id = public.gen_public_id9() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.video_ads WHERE public_id IS NULL LOOP
    UPDATE public.video_ads SET public_id = public.gen_public_id9() WHERE id = r.id;
  END LOOP;
END $$;
