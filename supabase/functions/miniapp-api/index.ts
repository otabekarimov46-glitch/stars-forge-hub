import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MP4_HEADER_SCAN_BYTES = 2 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, ...params } = await req.json();

    const DAILY_VIDEO_LIMIT = 100;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "0.0.0.0";

    switch (action) {
      case "get_next_video": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        let { data: user } = await supabase
          .from("users")
          .select("id, is_banned, balance_frozen, captcha_pending, balance_pt, daily_bonus_at")
          .eq("telegram_id", telegram_id)
          .single();

        if (!user) {
          const { data: newUser, error } = await supabase
            .from("users")
            .insert({ telegram_id })
            .select("id, is_banned, balance_frozen, captcha_pending, balance_pt, daily_bonus_at")
            .single();
          if (error) throw error;
          user = newUser;
        }

        if (user.is_banned) throw new Error("Аккаунт заблокирован");
        if (user.captcha_pending) {
          return jsonResponse({ data: { locked: true } });
        }

        // Record IP
        await recordIp(supabase, user.id, ip);

        // Log activity
        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "miniapp_open",
          ip_address: ip,
        });

        // Watched (rewarded) ids
        const { data: watched } = await supabase
          .from("video_views")
          .select("video_ad_id")
          .eq("user_id", user.id)
          .eq("rewarded", true);
        const watchedIds = new Set((watched || []).map((v: any) => v.video_ad_id));

        const { data: allVideos } = await supabase
          .from("video_ads")
          .select("id, title, video_url, duration_seconds, reward_pt, external_link_url, external_link_label, media_type")
          .eq("is_active", true);

        const list = allVideos || [];
        const userPayload = {
          balance_pt: Number(user.balance_pt),
          daily_bonus_at: user.daily_bonus_at,
        };
        if (list.length === 0) return jsonResponse({ data: { video: null, user: userPayload } });

        const unwatched = list.filter((v: any) => !watchedIds.has(v.id));
        const watchedAgain = list.filter((v: any) => watchedIds.has(v.id));
        const shuffle = <T,>(arr: T[]) => arr.map(a => [Math.random(), a] as const).sort((a, b) => a[0] - b[0]).map(([, a]) => a);
        const queue = [...shuffle(unwatched), ...shuffle(watchedAgain)];
        const video = queue[0] || null;

        return jsonResponse({ data: { video, user: userPayload } });
      }

      case "start_view": {
        const { telegram_id, video_ad_id } = params;
        if (!telegram_id || !video_ad_id) throw new Error("telegram_id and video_ad_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, captcha_pending, is_banned")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");
        if (user.is_banned) throw new Error("Аккаунт заблокирован");
        if (user.captcha_pending) throw new Error("Требуется решить капчу в чате");

        // ===== Daily limit: 100 rewarded videos per UTC calendar day =====
        const utcDayStart = new Date();
        utcDayStart.setUTCHours(0, 0, 0, 0);
        const { count: todayCount } = await supabase
          .from("video_views")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("rewarded", true)
          .gte("started_at", utcDayStart.toISOString());
        if ((todayCount || 0) >= DAILY_VIDEO_LIMIT) {
          return jsonResponse({ data: { limit_reached: true, watched_today: todayCount, limit: DAILY_VIDEO_LIMIT } });
        }

        const { data: video } = await supabase
          .from("video_ads")
          .select("video_url, duration_seconds")
          .eq("id", video_ad_id)
          .single();
        if (!video) throw new Error("Video not found");

        const dur = await getEffectiveVideoDuration(supabase, video_ad_id, video.video_url, Number(video.duration_seconds));

        // Dynamic-hash session: 4 checkpoints at 20/40/60/80% (not 100% to avoid
        // racing with finish_view). Frontend reports them with the secret;
        // server verifies sequence + reasonable timing — but soft, not strict.
        const sessionSecret = crypto.randomUUID() + "." + crypto.randomUUID();
        const checkpointTimes = [1, 2, 3, 4].map((i) => +(dur * i / 5).toFixed(2));

        const { data: view, error } = await supabase
          .from("video_views")
          .insert({ user_id: user.id, video_ad_id, ip_address: ip, session_secret: sessionSecret, checkpoints: [] })
          .select("id")
          .single();
        if (error) throw error;

        return jsonResponse({ data: { view_id: view.id, session_secret: sessionSecret, checkpoint_times: checkpointTimes } });
      }

      case "checkpoint": {
        const { telegram_id, view_id, session_secret, index } = params;
        if (!telegram_id || !view_id || !session_secret || typeof index !== "number") {
          throw new Error("invalid checkpoint payload");
        }
        const { data: user } = await supabase
          .from("users").select("id, username, telegram_id, captcha_pending, is_banned")
          .eq("telegram_id", telegram_id).single();
        if (!user) throw new Error("User not found");
        if (user.is_banned || user.captcha_pending) return jsonResponse({ data: { locked: true } });

        const { data: view } = await supabase
          .from("video_views")
          .select("id, started_at, session_secret, checkpoints, video_ad_id, rewarded")
          .eq("id", view_id).eq("user_id", user.id).single();
        if (!view) throw new Error("View not found");
        if (view.rewarded) return jsonResponse({ data: { ok: false } });
        if (view.session_secret !== session_secret) {
          await issueCaptcha(supabase, user, "недействительный ключ сессии видео");
          return jsonResponse({ data: { locked: true } });
        }
        const list: number[] = Array.isArray(view.checkpoints) ? view.checkpoints : [];
        if (index !== list.length || index < 0 || index > 4) {
          return jsonResponse({ data: { ok: false } });
        }
        const elapsedSec = (Date.now() - new Date(view.started_at).getTime()) / 1000;
        list.push(+elapsedSec.toFixed(2));
        await supabase.from("video_views").update({ checkpoints: list }).eq("id", view_id);
        return jsonResponse({ data: { ok: true } });
      }

      case "finish_view": {
        const { telegram_id, view_id, session_secret } = params;
        if (!telegram_id || !view_id) throw new Error("telegram_id and view_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, balance_pt, balance_frozen, violation_count, is_suspicious, username, telegram_id, captcha_pending, is_banned")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");
        if (user.is_banned) throw new Error("Аккаунт заблокирован");
        if (user.captcha_pending) throw new Error("Требуется решить капчу в чате");

        const { data: view } = await supabase
          .from("video_views")
          .select("id, video_ad_id, started_at, rewarded, session_secret, checkpoints")
          .eq("id", view_id)
          .eq("user_id", user.id)
          .single();
        if (!view) throw new Error("View not found");
        if (view.rewarded) throw new Error("Already rewarded");

        const { data: video } = await supabase
          .from("video_ads")
          .select("video_url, duration_seconds, reward_pt")
          .eq("id", view.video_ad_id)
          .single();
        if (!video) throw new Error("Video not found");

        const startedAt = new Date(view.started_at).getTime();
        const elapsedSec = (Date.now() - startedAt) / 1000;
        const dur = await getEffectiveVideoDuration(supabase, view.video_ad_id, video.video_url, Number(video.duration_seconds));

        // ====== Anti-userbot validation (тонкая, не мешает живым) ======
        // Тиры:
        //  HARD fraud → freeze balance + captcha (только явный userbot):
        //    - нет/неверный session_secret
        //    - elapsed < 50% длины видео
        //    - 0 чекпоинтов (вообще ни одного отчёта от Mini App)
        //  SOFT fail → отказать в награде БЕЗ заморозки и БЕЗ капчи
        //  (вкладка свернулась, плеер прервался и т.п.)
        //    - elapsed < 85% длины
        //    - чекпоинтов меньше 2
        //  Каденс между чекпоинтами специально НЕ проверяем строго —
        //  фронтовый таймер останавливается при потере фокуса, а
        //  серверное wall-time от этого расходится — это ложные срабатывания.
        const cps: number[] = Array.isArray(view.checkpoints) ? view.checkpoints : [];

        const hardBadSecret = !session_secret || view.session_secret !== session_secret;
        const hardTooFast = elapsedSec < dur * 0.5;
        const hardNoCheckpoints = cps.length === 0 && dur >= 5;

        if (hardBadSecret || hardTooFast || hardNoCheckpoints) {
          const reason = hardBadSecret
            ? "запрос награды без действительного ключа сессии (возможен userbot)"
            : hardTooFast
            ? `просмотр завершён слишком быстро (${elapsedSec.toFixed(1)}с / ${dur}с)`
            : `ни одного чекпоинта Mini App за ${dur}с просмотра`;
          await issueCaptcha(supabase, user, reason, /*freeze*/ true);
          return jsonResponse({ data: { locked: true } });
        }

        // Soft fail — просто не выдаём награду, без капчи/заморозки.
        if (elapsedSec < dur * 0.85 || (dur >= 10 && cps.length < 2)) {
          return jsonResponse({ data: { rewarded: false, reason: "incomplete" } });
        }

        await supabase
          .from("video_views")
          .update({ finished_at: new Date().toISOString(), rewarded: true })
          .eq("id", view_id);

        let newBalance = Number(user.balance_pt);
        if (!user.balance_frozen) {
          newBalance = Number(user.balance_pt) + Number(video.reward_pt);
          await supabase
            .from("users")
            .update({ balance_pt: newBalance })
            .eq("id", user.id);
        }

        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "video_reward",
          ip_address: ip,
          metadata: { video_ad_id: view.video_ad_id, reward_pt: video.reward_pt },
        });

        // NOTE: We intentionally do NOT send a Telegram message on every reward.
        // Per-view chat spam caused the bot to be rate-limited / temporarily restricted
        // by Telegram's anti-spam system. Balance is shown live in the Mini App header.

        // Sustained activity check — мягкая, срабатывает только на явный фарм:
        // 200+ наград/час БЕЗ единой паузы ≥ 5 минут → капча без заморозки.
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from("logs_activity")
          .select("created_at")
          .eq("user_id", user.id)
          .eq("action", "video_reward")
          .gte("created_at", oneHourAgo)
          .order("created_at", { ascending: true });
        if (recent && recent.length >= 200) {
          let maxPauseMs = 0;
          for (let i = 1; i < recent.length; i++) {
            const d = new Date(recent[i].created_at).getTime() - new Date(recent[i - 1].created_at).getTime();
            if (d > maxPauseMs) maxPauseMs = d;
          }
          if (maxPauseMs < 5 * 60 * 1000) {
            await issueCaptcha(supabase, user, "длительная непрерывная активность без пауз", /*freeze*/ false);
            return jsonResponse({ data: { rewarded: true, amount: video.reward_pt, new_balance: newBalance, locked: true } });
          }
        }

        // Pick next video so the frontend can show it immediately
        const { data: watchedAfter } = await supabase
          .from("video_views").select("video_ad_id").eq("user_id", user.id).eq("rewarded", true);
        const watchedSet = new Set((watchedAfter || []).map((v: any) => v.video_ad_id));
        const { data: allVids } = await supabase
          .from("video_ads")
          .select("id, title, video_url, duration_seconds, reward_pt, external_link_url, external_link_label, media_type")
          .eq("is_active", true);
        const pool = (allVids || []).filter((v: any) => v.id !== view.video_ad_id);
        const fresh = pool.filter((v: any) => !watchedSet.has(v.id));
        const rest = pool.filter((v: any) => watchedSet.has(v.id));
        const shuffle2 = <T,>(arr: T[]) => arr.map(a => [Math.random(), a] as const).sort((a, b) => a[0] - b[0]).map(([, a]) => a);
        const nextVideo = [...shuffle2(fresh), ...shuffle2(rest)][0] || null;

        return jsonResponse({ data: { rewarded: true, amount: video.reward_pt, new_balance: newBalance, next_video: nextVideo } });
      }



      case "claim_daily_bonus": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, balance_pt, daily_bonus_at, is_banned, balance_frozen, captcha_pending")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");
        if (user.is_banned) throw new Error("Аккаунт заблокирован");
        if (user.captcha_pending) throw new Error("Требуется решить капчу в чате");

        const now = new Date();
        if (user.daily_bonus_at) {
          const diff = now.getTime() - new Date(user.daily_bonus_at).getTime();
          if (diff < 24 * 60 * 60 * 1000) {
            const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - diff) / (60 * 60 * 1000));
            return jsonResponse({ data: { claimed: false, hours_left: hoursLeft } });
          }
        }

        const bonus = Math.round((1.5 + Math.random() * 1.5) * 10) / 10;
        const newBalance = Number(user.balance_pt) + bonus;

        await supabase.from("users").update({
          balance_pt: newBalance,
          daily_bonus_at: now.toISOString(),
        }).eq("id", user.id);

        await recordIp(supabase, user.id, ip);

        return jsonResponse({ data: { claimed: true, bonus, new_balance: newBalance } });
      }

      case "report_suspicious_click": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, username, telegram_id, captcha_pending, captcha_count")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");

        // Сколько раз антикликер срабатывал на этого юзера за последние 24ч.
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: recentReports } = await supabase
          .from("logs_activity")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("action", "autoclicker_detected")
          .gte("created_at", dayAgo);

        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "autoclicker_detected",
          ip_address: ip,
        });

        // 1-е срабатывание за сутки → просто лог, без капчи и без заморозки
        // (живой человек мог случайно быстро понажимать).
        if ((recentReports || 0) < 1) {
          return jsonResponse({ data: { locked: false, warned: true } });
        }

        // 2-е срабатывание → мягкая капча, БЕЗ заморозки баланса.
        // 3-е и далее → капча + заморозка (устойчивый паттерн).
        const freeze = (recentReports || 0) >= 2;
        if (!user.captcha_pending) {
          await issueCaptcha(supabase, user, "повторный паттерн действий, похожий на автокликер", freeze);
        }

        return jsonResponse({ data: { locked: true } });
      }

      case "get_config": {
        return jsonResponse({ data: { turnstile_site_key: Deno.env.get("TURNSTILE_SITE_KEY") || null } });
      }

      case "verify_turnstile": {
        const { telegram_id, token } = params;
        if (!telegram_id || !token) throw new Error("telegram_id and token required");
        const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
        if (!secret) return jsonResponse({ data: { ok: false, reason: "not_configured" } });

        const form = new URLSearchParams();
        form.append("secret", secret);
        form.append("response", token);
        form.append("remoteip", ip);

        const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST", body: form,
        });
        const result = await r.json().catch(() => ({ success: false }));

        const { data: user } = await supabase
          .from("users").select("id").eq("telegram_id", telegram_id).single();
        if (user) {
          await supabase.from("logs_activity").insert({
            user_id: user.id,
            action: result.success ? "turnstile_pass" : "turnstile_fail",
            ip_address: ip,
            metadata: { codes: result["error-codes"] || [] },
          });
        }
        return jsonResponse({ data: { ok: !!result.success } });
      }

      case "list_tasks": {
        const { telegram_id, is_extra } = params;
        let completedIds = new Set<string>();
        if (telegram_id) {
          const { data: user } = await supabase
            .from("users").select("id").eq("telegram_id", telegram_id).single();
          if (user) {
            const { data: done } = await supabase
              .from("task_completions").select("task_id").eq("user_id", user.id);
            completedIds = new Set((done || []).map((d: any) => d.task_id));
          }
        }
        let q = supabase
          .from("tasks")
          .select("id, type, title, channel_username, channel_id, post_url, reward_pt, max_completions, current_completions, min_seconds_away, is_extra")
          .eq("is_active", true)
          .neq("type", "video")
          .order("created_at", { ascending: false });
        if (typeof is_extra === "boolean") q = q.eq("is_extra", is_extra);
        const { data: tasks } = await q;
        const filtered = (tasks || []).filter((t: any) => !completedIds.has(t.id));
        return jsonResponse({ data: { tasks: filtered } });
      }

      case "start_task": {
        const { telegram_id, task_id } = params;
        if (!telegram_id || !task_id) throw new Error("telegram_id and task_id required");
        const { data: user } = await supabase
          .from("users").select("id, is_banned").eq("telegram_id", telegram_id).single();
        if (!user || user.is_banned) return jsonResponse({ data: { ok: false } });
        await supabase.from("logs_activity").insert({
          user_id: user.id, action: "task_started", ip_address: ip, metadata: { task_id },
        });
        return jsonResponse({ data: { ok: true } });
      }

      case "verify_task": {
        const { telegram_id, task_id } = params;
        if (!telegram_id || !task_id) throw new Error("telegram_id and task_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, balance_pt, balance_frozen, is_banned, captcha_pending")
          .eq("telegram_id", telegram_id).single();
        if (!user) throw new Error("User not found");
        if (user.is_banned) throw new Error("Аккаунт заблокирован");
        if (user.captcha_pending) return jsonResponse({ data: { locked: true } });

        // Already done?
        const { data: existing } = await supabase
          .from("task_completions")
          .select("id").eq("user_id", user.id).eq("task_id", task_id).maybeSingle();
        if (existing) {
          return jsonResponse({ data: { completed: true, subscribed: true, already: true, new_balance: Number(user.balance_pt) } });
        }

        const { data: task } = await supabase
          .from("tasks")
          .select("id, type, channel_username, channel_id, post_url, reward_pt, is_active, max_completions, current_completions, min_seconds_away")
          .eq("id", task_id).single();
        if (!task || !task.is_active) throw new Error("Task unavailable");
        if (task.max_completions && task.current_completions >= task.max_completions) {
          return jsonResponse({ data: { completed: false, subscribed: false, reason: "limit_reached" } });
        }

        let completed = false;
        let failReason = "";

        if (task.type === "subscribe") {
          // IMPORTANT: use the NEW bot token first — the active bot (channel admin)
          // is the one configured in TELEGRAM_BOT_TOKEN_NEW (same as telegram-bot fn).
          const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_NEW") || Deno.env.get("TELEGRAM_BOT_TOKEN");
          if (!botToken) return jsonResponse({ data: { completed: false, subscribed: false, reason: "bot_not_configured" } });

          const candidates: (string | number)[] = [];
          if (task.channel_id) candidates.push(Number(task.channel_id));
          if (task.channel_username) candidates.push(`@${String(task.channel_username).replace(/^@/, "")}`);
          if (candidates.length === 0) {
            return jsonResponse({ data: { completed: false, subscribed: false, reason: "no_channel" } });
          }

          for (const chatId of candidates) {
            try {
              const r = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, user_id: Number(telegram_id) }),
              });
              const j = await r.json();
              console.log("verify_task getChatMember", JSON.stringify({ chatId, ok: j?.ok, status: j?.result?.status, error: j?.description }));
              if (j?.ok) {
                const st = j.result?.status;
                if (st === "member" || st === "administrator" || st === "creator") completed = true;
                else failReason = "not_member";
                break; // definitive answer received
              } else {
                failReason = j?.description || "telegram_error";
              }
            } catch (e) {
              console.log("verify_task getChatMember fetch error", String(e));
              failReason = "network_error";
            }
          }
        } else if (task.type === "view_post" || task.type === "view_story" || task.type === "survey") {
          // Time-based check: user must have been away for >= min_seconds_away (default 2s), within last hour.
          const minMs = Math.max(1, Number(task.min_seconds_away ?? 2)) * 1000;
          const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { data: started } = await supabase
            .from("logs_activity")
            .select("created_at")
            .eq("user_id", user.id)
            .eq("action", "task_started")
            .contains("metadata", { task_id })
            .gte("created_at", hourAgo)
            .order("created_at", { ascending: false })
            .limit(1);
          const startedAt = started?.[0]?.created_at;
          if (!startedAt) {
            failReason = "not_started";
          } else if (Date.now() - new Date(startedAt).getTime() < minMs) {
            failReason = "too_fast";
          } else {
            completed = true;
          }
        } else {
          return jsonResponse({ data: { completed: false, subscribed: false, reason: "unsupported_type" } });
        }

        if (!completed) {
          return jsonResponse({ data: { completed: false, subscribed: false, reason: failReason } });
        }

        // Record completion and award PT
        await supabase.from("task_completions").insert({ user_id: user.id, task_id });
        await supabase.from("tasks").update({
          current_completions: (task.current_completions || 0) + 1,
        }).eq("id", task_id);

        let newBalance = Number(user.balance_pt);
        if (!user.balance_frozen) {
          newBalance = Number(user.balance_pt) + Number(task.reward_pt);
          await supabase.from("users").update({ balance_pt: newBalance }).eq("id", user.id);
        }

        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "task_reward",
          ip_address: ip,
          metadata: { task_id, reward_pt: task.reward_pt, type: task.type },
        });

        // Anti-unsubscribe: schedule exactly ONE re-check 1 hour later for subscribe tasks.
        if (task.type === "subscribe") {
          const checkAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          await supabase.from("delayed_checks").insert({
            user_id: user.id,
            task_id,
            check_at: checkAt,
          });
        }

        return jsonResponse({ data: { completed: true, subscribed: true, new_balance: newBalance, reward: Number(task.reward_pt) } });
      }



      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function recordIp(supabase: any, userId: string, ip: string) {
  const { data: existingIp } = await supabase
    .from("user_ips")
    .select("id")
    .eq("user_id", userId)
    .eq("ip_address", ip)
    .single();

  if (existingIp) {
    await supabase.from("user_ips")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existingIp.id);
  } else {
    await supabase.from("user_ips")
      .insert({ user_id: userId, ip_address: ip });
  }
}

async function getEffectiveVideoDuration(supabase: any, videoId: string, videoUrl: string | null, fallbackSeconds: number) {
  const fallback = Number.isFinite(fallbackSeconds) && fallbackSeconds > 0 ? fallbackSeconds : 1;
  if (!videoUrl || !/\.mp4($|\?)/i.test(videoUrl)) return fallback;

  try {
    const duration = await readMp4Duration(videoUrl);
    if (duration && Math.abs(duration - fallback) > 0.75) {
      const normalized = Math.max(1, Math.round(duration));
      await supabase.from("video_ads").update({ duration_seconds: normalized }).eq("id", videoId);
      return duration;
    }
    return duration || fallback;
  } catch {
    return fallback;
  }
}

async function readMp4Duration(url: string) {
  const res = await fetch(url, { headers: { Range: `bytes=0-${MP4_HEADER_SCAN_BYTES - 1}` } });
  if (!res.ok) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  const moov = findBox(bytes, 0, bytes.length, "moov");
  if (!moov) return null;
  const mvhd = findBox(bytes, moov.start, moov.end, "mvhd");
  if (!mvhd) return null;
  return parseMvhdDuration(bytes, mvhd.start, mvhd.end);
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = readUint32(bytes, offset);
    const name = readType(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      size = Number(readUint64(bytes, offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!size || size < header) return null;
    const boxStart = offset + header;
    const boxEnd = Math.min(end, offset + size);
    if (name === type) return { start: boxStart, end: boxEnd };
    offset += size;
  }
  return null;
}

function parseMvhdDuration(bytes: Uint8Array, start: number, end: number) {
  if (start + 20 > end) return null;
  const version = bytes[start];
  if (version === 1) {
    if (start + 32 > end) return null;
    const timescale = readUint32(bytes, start + 20);
    const duration = Number(readUint64(bytes, start + 24));
    return timescale > 0 ? duration / timescale : null;
  }
  const timescale = readUint32(bytes, start + 12);
  const duration = readUint32(bytes, start + 16);
  return timescale > 0 ? duration / timescale : null;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] * 2 ** 24) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readUint64(bytes: Uint8Array, offset: number) {
  return (BigInt(readUint32(bytes, offset)) << 32n) + BigInt(readUint32(bytes, offset + 4));
}

function readType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function issueCaptcha(supabase: any, user: any, reason: string, freeze: boolean = true) {
  const captchaA = 2 + Math.floor(Math.random() * 8);
  const captchaB = 2 + Math.floor(Math.random() * 8);
  const update: any = {
    captcha_pending: `${captchaA}+${captchaB}`,
    captcha_answer: captchaA + captchaB,
  };
  if (freeze) update.balance_frozen = true;
  await supabase.from("users").update(update).eq("id", user.id);

  await supabase.from("admin_alerts").insert({
    type: "fraud",
    user_id: user.id,
    message: `🤖 Антифрод: @${user.username || user.telegram_id} — ${reason}.${freeze ? " Баланс заморожен," : ""} отправлена капча.`,
  });

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (botToken) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: user.telegram_id,
          text: `🔒 Подтвердите, что вы человек.\nРешите пример: *${captchaA} + ${captchaB} = ?*\nОтправьте число в этот чат.`,
          parse_mode: "Markdown",
        }),
      });
    } catch {}
  }
}
