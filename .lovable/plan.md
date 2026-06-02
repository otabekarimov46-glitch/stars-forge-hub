## Изменения

### 1. Ребрендинг
- Заменить все упоминания `StarGain` / `StarBot` на **Starment** во всех файлах (UI, тексты бота, alt у логотипа, заголовки страниц, `index.html`, `MiniApp.tsx`, тексты edge-функций).

### 2. Загрузка видео и фото в админке (`ContentPage.tsx`)
- Принимать любые видео/фото форматы (`accept="video/*,image/*"`).
- Если выбрано **видео** — автоматически читать длительность (`<video>.duration`) и подставлять её в поле «секунды».
- Если выбрано **фото** — длительность по умолчанию `30 сек`, поле редактируемое.
- Хранить тип контента (`video` / `image`) в `video_ads` (добавить колонку `media_type text default 'video'`).
- Заливка напрямую в Supabase Storage bucket `video-ads`, ссылка подставляется в задание.

### 3. Mini App — открытие только видео
- В bot inline-кнопке для задания «посмотреть видео» использовать `web_app` с URL вида `/miniapp?video_id=...&user_id=...`, чтобы Telegram открывал именно видео-плеер в WebApp.
- Страница `MiniApp.tsx`:
  - Полноэкранный плеер (без шапки/логотипа лишнего), фото показывается через `<img>` с таймером.
  - Использовать `Telegram.WebApp.expand()` и `disableVerticalSwipes()`.
  - Слушать `visibilitychange` и `Telegram.WebApp.onEvent('viewportChanged')`:
    - Свернули Telegram / переключили вкладку → `videoRef.pause()` + остановка таймера.
    - Вернулись → `play()` + продолжение таймера.
  - Слушать `Telegram.WebApp.onEvent('backButtonClicked')` и `beforeunload`: если закрыли до окончания — НЕ вызывать `finish_view` (просмотр не засчитан).
- После завершения: показать «✅ Видео просмотрено, +X PT» и кнопку «Вернуться в чат» (`Telegram.WebApp.close()`).

### 4. Уведомление в чат бота
- В `finish_view` (miniapp-api) после начисления PT слать пользователю в Telegram сообщение: `🎉 Видео просмотрено! +{reward} PT. Баланс: {balance} PT`.

### 5. Очередь видео — «вперемешку, но просмотренные в конец»
- Изменить `get_next_video` в `miniapp-api`:
  - Получить все активные видео.
  - Разделить на «непросмотренные» и «просмотренные».
  - Случайно перемешать непросмотренные (приоритет), затем перемешать просмотренные и поставить в конец.
  - Вернуть первое.

### 6. Алерты
- Очистить таблицу `admin_alerts` (DELETE всех записей через миграцию/insert).
- Новые алерты продолжат писаться как раньше (логика уже есть).

### 7. Защита от обхода (уже есть, оставляем)
- `finish_view` требует ≥80% длительности, и теперь дополнительно: если событие `pagehide`/закрытие до конца — view запись остаётся `rewarded=false`.

## Файлы

- `supabase/migrations/<new>.sql` — добавить `media_type` в `video_ads`; очистить `admin_alerts`.
- `supabase/functions/miniapp-api/index.ts` — новая логика очереди, уведомление в бота после `finish_view`.
- `supabase/functions/telegram-bot/index.ts` — заменить названия на Starment, ссылка на mini app для видео-задания.
- `src/pages/MiniApp.tsx` — фуллскрин-плеер, поддержка фото, pause/resume, anti-close.
- `src/pages/admin/ContentPage.tsx` — загрузка видео/фото с авто-длительностью.
- `index.html`, `src/lib/i18n.tsx`, `src/components/AdminLayout.tsx` и пр. — ребрендинг на Starment.
