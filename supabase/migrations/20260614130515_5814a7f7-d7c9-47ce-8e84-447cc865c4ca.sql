
CREATE TABLE IF NOT EXISTS public.advertisers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.advertisers TO service_role;
ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advertisers_no_client_access" ON public.advertisers;
CREATE POLICY "advertisers_no_client_access" ON public.advertisers
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS advertiser_id uuid REFERENCES public.advertisers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_advertiser ON public.tasks(advertiser_id);
