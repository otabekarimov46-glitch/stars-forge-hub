import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
          .select("duration_seconds")
          .eq("id", video_ad_id)
          .single();
        if (!video) throw new Error("Video not found");

        // Dynamic-hash session: 4 checkpoints at 20/40/60/80% (not 100% to avoid
        // racing with finish_view). Frontend reports them with the secret;
        // server verifies sequence + reasonable timing — but soft, not strict.
        const sessionSecret = crypto.randomUUID() + "." + crypto.randomUUID();
        const dur = Number(video.duration_seconds);
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
          .select("duration_seconds, reward_pt")
          .eq("id", view.video_ad_id)
          .single();
        if (!video) throw new Error("Video not found");

        const startedAt = new Date(view.started_at).getTime();
        const elapsedSec = (Date.now() - startedAt) / 1000;
        const dur = Number(video.duration_seconds);

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

        // Notify user in Telegram chat
        const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
        if (botToken) {
          try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: user.telegram_id,
                text: `🎉 Видео просмотрено!\n+${video.reward_pt} PT\n💎 Баланс: ${newBalance.toFixed(1)} PT`,
              }),
            });
          } catch {}
        }

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
