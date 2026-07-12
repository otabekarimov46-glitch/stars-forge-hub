
-- 1. Registry table (permanent, survives deletes)
CREATE TABLE IF NOT EXISTS public.public_ids_registry (
  public_id text PRIMARY KEY,
  prefix text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.public_ids_registry TO service_role;
ALTER TABLE public.public_ids_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "registry no client access" ON public.public_ids_registry;
CREATE POLICY "registry no client access" ON public.public_ids_registry FOR SELECT USING (false);

-- 2. New generator: prefix + 9 digits, atomically registered
CREATE OR REPLACE FUNCTION public.gen_public_id_prefixed(_prefix text, _entity_type text, _entity_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate text;
  tries int := 0;
BEGIN
  LOOP
    candidate := _prefix || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
    BEGIN
      INSERT INTO public.public_ids_registry(public_id, prefix, entity_type, entity_id)
      VALUES (candidate, _prefix, _entity_type, _entity_id);
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1;
      IF tries > 100 THEN
        RAISE EXCEPTION 'Could not generate unique public_id after 100 tries';
      END IF;
    END;
  END LOOP;
END;
$$;

-- 3. Trigger picks prefix by table (and task type)
CREATE OR REPLACE FUNCTION public.assign_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  p text;
BEGIN
  IF NEW.public_id IS NOT NULL AND NEW.public_id <> '' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'advertisers' THEN
    p := 'r';
  ELSIF TG_TABLE_NAME = 'video_ads' THEN
    p := 'v';
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    p := CASE NEW.type::text
      WHEN 'subscribe' THEN 's'
      WHEN 'view_post' THEN 'p'
      WHEN 'view_story' THEN 'i'
      WHEN 'reaction' THEN 'p'
      WHEN 'video'     THEN 'v'
      ELSE 't'
    END;
  ELSE
    p := 'x';
  END IF;
  NEW.public_id := public.gen_public_id_prefixed(p, TG_TABLE_NAME, NEW.id);
  RETURN NEW;
END;
$$;

-- 4. Backfill all existing rows with new prefixed IDs
DO $$
DECLARE
  r record;
BEGIN
  UPDATE public.advertisers SET public_id = NULL;
  UPDATE public.tasks       SET public_id = NULL;
  UPDATE public.video_ads   SET public_id = NULL;

  FOR r IN SELECT id FROM public.advertisers LOOP
    UPDATE public.advertisers
      SET public_id = public.gen_public_id_prefixed('r','advertisers', r.id)
      WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id FROM public.video_ads LOOP
    UPDATE public.video_ads
      SET public_id = public.gen_public_id_prefixed('v','video_ads', r.id)
      WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, type FROM public.tasks LOOP
    UPDATE public.tasks
      SET public_id = public.gen_public_id_prefixed(
        CASE r.type::text
          WHEN 'subscribe' THEN 's'
          WHEN 'view_post' THEN 'p'
          WHEN 'view_story' THEN 'i'
          WHEN 'reaction'  THEN 'p'
          WHEN 'video'     THEN 'v'
          ELSE 't'
        END,
        'tasks', r.id)
      WHERE id = r.id;
  END LOOP;
END $$;
