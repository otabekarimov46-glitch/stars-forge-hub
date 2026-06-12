-- Revert test completion made during verification testing
DELETE FROM public.task_completions
WHERE task_id = 'fa7f015b-7a24-4323-a589-350b0591968f'
  AND user_id = (SELECT id FROM public.users WHERE telegram_id = 6597179394);

UPDATE public.tasks
SET current_completions = GREATEST(current_completions - 1, 0)
WHERE id = 'fa7f015b-7a24-4323-a589-350b0591968f';

UPDATE public.users
SET balance_pt = balance_pt - 5
WHERE telegram_id = 6597179394;