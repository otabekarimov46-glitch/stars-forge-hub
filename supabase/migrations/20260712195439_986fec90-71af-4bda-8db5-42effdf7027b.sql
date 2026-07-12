
-- Auto math log via trigger (captures every balance mutation from anywhere)
CREATE OR REPLACE FUNCTION public.log_balance_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.balance_pt IS DISTINCT FROM OLD.balance_pt THEN
    INSERT INTO public.balance_math_log(user_id, delta, balance_after, reason)
    VALUES (NEW.id, NEW.balance_pt - OLD.balance_pt, NEW.balance_pt,
            COALESCE(current_setting('app.balance_reason', true), 'balance_change'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_balance_change ON public.users;
CREATE TRIGGER trg_log_balance_change
AFTER UPDATE OF balance_pt ON public.users
FOR EACH ROW EXECUTE FUNCTION public.log_balance_change();

-- Only one pending USDT withdrawal per user
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_usdt_withdrawal
  ON public.withdrawals(user_id) WHERE status = 'pending' AND method = 'usdt';
