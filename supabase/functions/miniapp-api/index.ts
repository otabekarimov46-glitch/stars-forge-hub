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
        const { telegram_id, start_param } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        let { data: user } = await supabase
          .from("users")
          .select("id, is_banned, balance_frozen, captcha_pending, balance_pt, daily_bonus_at")
          .eq("telegram_id", telegram_id)
          .single();

        if (!user) {
          let referrerId: string | null = null;
          if (typeof start_param === "string" && /^[a-f0-9-]{36}$/i.test(start_param)) {
            const { data: ref } = await supabase.from("users").select("id").eq("id", start_param).maybeSingle();
            if (ref) referrerId = ref.id;
          }
          const { data: newUser, error } = await supabase
            .from("users")
            .insert({ telegram_id, referrer_id: referrerId })
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
          balance_frozen: !!user.balance_frozen,
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
          await creditReferral(supabase, user.id, Number(video.reward_pt), "video", { video_ad_id: view.video_ad_id });
        }


        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "video_reward",
          ip_address: ip,
          metadata: { video_ad_id: view.video_ad_id, reward_pt: video.reward_pt },
        });

        // Snapshot: extended activity log (survives entity deletion)
        try {
          const [{ data: v2 }, { data: u2 }] = await Promise.all([
            supabase.from("video_ads")
              .select("id, title, public_id, advertiser_id, advertisers(name, public_id)")
              .eq("id", view.video_ad_id).maybeSingle(),
            supabase.from("users").select("username, telegram_id").eq("id", user.id).maybeSingle(),
          ]);
          const adv: any = (v2 as any)?.advertisers || null;
          await supabase.from("activity_logs").insert({
            user_id: user.id,
            user_username: u2?.username || null,
            user_telegram_id: u2?.telegram_id ?? null,
            action_type: "video",
            video_ad_id: view.video_ad_id,
            task_title: v2?.title || null,
            task_public_id: v2?.public_id || null,
            advertiser_id: v2?.advertiser_id || null,
            advertiser_name: adv?.name || null,
            advertiser_public_id: adv?.public_id || null,
            reward_pt: Number(video.reward_pt),
            started_at: view.started_at,
            finished_at: new Date().toISOString(),
          });
        } catch (_) { /* logging must never break reward flow */ }

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
        const { data: rows } = await supabase
          .from("settings")
          .select("key,value")
          .in("key", ["exchange_rate", "bot_username", "usdt_rate", "min_withdraw_usdt", "min_withdraw_stars", "support_bot_url"]);
        const map: Record<string, string> = {};
        (rows || []).forEach((r: any) => (map[r.key] = r.value));
        const exchange_rate = Number(map.exchange_rate ?? "1") || 1;
        const usdt_rate = Number(map.usdt_rate ?? "0.02") || 0;
        let bot_username = (map.bot_username || "").replace(/^@/, "");
        if (!bot_username) {
          const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_V2");
          if (botToken) {
            try {
              const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
              const j = await r.json();
              if (j?.ok && j.result?.username) {
                bot_username = j.result.username;
                await supabase.from("settings").upsert({ key: "bot_username", value: bot_username });
              }
            } catch {}
          }
        }
        return jsonResponse({
          data: {
            turnstile_site_key: Deno.env.get("TURNSTILE_SITE_KEY") || null,
            exchange_rate,
            usdt_rate,
            bot_username,
            min_withdraw_usdt: Number(map.min_withdraw_usdt ?? "1") || 1,
            min_withdraw_stars: Number(map.min_withdraw_stars ?? "50") || 50,
            support_bot_url: map.support_bot_url || "https://t.me/starmenthelp_bot",
          },
        });
      }

      case "get_pending_withdrawal": {
        const { telegram_id } = params;
        if (!telegram_id) return jsonResponse({ data: null });
        const { data: u } = await supabase.from("users").select("id").eq("telegram_id", telegram_id).maybeSingle();
        if (!u) return jsonResponse({ data: null });
        const { data: w } = await supabase
          .from("withdrawals")
          .select("id, amount_usdt, amount_pt, status, created_at, method")
          .eq("user_id", u.id).eq("status", "pending")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        return jsonResponse({ data: w || null });
      }

      case "create_withdrawal_usdt": {
        const { telegram_id, amount_usdt } = params;
        if (!telegram_id) return jsonResponse({ error: "telegram_id required" }, 400);
        const amt = Number(amount_usdt);
        if (!Number.isFinite(amt) || amt <= 0) return jsonResponse({ error: "invalid amount" }, 400);

        const { data: user } = await supabase.from("users")
          .select("id, telegram_id, username, balance_pt, balance_frozen, is_banned, is_suspicious, violation_count, ton_wallet_address, created_at")
          .eq("telegram_id", telegram_id).maybeSingle();
        if (!user) return jsonResponse({ error: "user_not_found" }, 404);
        if (user.is_banned) return jsonResponse({ error: "banned" }, 403);
        if (user.balance_frozen) return jsonResponse({ error: "frozen" }, 403);
        if (!user.ton_wallet_address) return jsonResponse({ error: "no_wallet" }, 400);

        // Duplicate pending?
        const { data: pend } = await supabase.from("withdrawals")
          .select("id").eq("user_id", user.id).eq("status", "pending").maybeSingle();
        if (pend) return jsonResponse({ error: "already_pending" }, 409);

        // Load settings
        const { data: sRows } = await supabase.from("settings").select("key,value")
          .in("key", ["usdt_rate", "min_withdraw_usdt", "withdraw_channel_id", "usdt_jetton_address", "exchange_rate", "support_bot_url"]);
        const s: Record<string, string> = {};
        (sRows || []).forEach((r: any) => (s[r.key] = r.value));
        const usdtRate = Number(s.usdt_rate ?? "0.02") || 0.02;
        const minUsdt = Number(s.min_withdraw_usdt ?? "1") || 1;
        const exchangeRate = Number(s.exchange_rate ?? "1") || 1;
        const jetton = s.usdt_jetton_address || "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
        const channelId = s.withdraw_channel_id || "";

        if (amt < minUsdt) return jsonResponse({ error: "below_min", min: minUsdt });

        const amountPt = Math.round((amt / usdtRate) * 100) / 100;
        const currentBalance = Number(user.balance_pt);
        if (amountPt > currentBalance + 0.001) return jsonResponse({ error: "insufficient" }, 400);

        // IP
        const { data: ips } = await supabase.from("user_ips")
          .select("ip_address").eq("user_id", user.id)
          .order("last_seen_at", { ascending: false }).limit(1);
        const userIp = ips?.[0]?.ip_address || ip;

        // Deduct balance
        const newBalance = Math.round((currentBalance - amountPt) * 100) / 100;
        const upd = await supabase.from("users").update({ balance_pt: newBalance }).eq("id", user.id);
        if (upd.error) return jsonResponse({ error: upd.error.message }, 500);

        const amountStars = Math.floor(amountPt / exchangeRate);
        const { data: wIns, error: wErr } = await supabase.from("withdrawals").insert({
          user_id: user.id,
          amount_pt: amountPt,
          amount_stars: amountStars,
          amount_usdt: amt,
          wallet_address: user.ton_wallet_address,
          method: "usdt",
          ip_address: userIp,
          status: "pending",
        }).select("id, request_number").single();
        if (wErr) {
          await supabase.from("users").update({ balance_pt: currentBalance }).eq("id", user.id);
          return jsonResponse({ error: wErr.message }, 500);
        }

        // Log to mini app history
        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "withdrawal_request",
          ip_address: userIp,
          metadata: { amount_pt: amountPt, amount_usdt: amt, method: "usdt", request_number: wIns.request_number, wallet: user.ton_wallet_address },
        });


        // Gather violation context for admin report
        const { count: alertsCount } = await supabase
          .from("admin_alerts").select("id", { count: "exact", head: true }).eq("user_id", user.id);

        // Farm / shared IPs (>=2 other users on same IPs)
        let sharedIpCount = 0;
        let farmUsers = 0;
        const myIps = (await supabase.from("user_ips").select("ip_address").eq("user_id", user.id)).data || [];
        const ipArr = myIps.map((r: any) => r.ip_address);
        if (ipArr.length) {
          const { data: shared } = await supabase.from("user_ips")
            .select("ip_address, user_id").in("ip_address", ipArr as any).neq("user_id", user.id);
          const others = new Set((shared || []).map((r: any) => r.user_id));
          farmUsers = others.size;
          const ipsWithOthers = new Set((shared || []).map((r: any) => r.ip_address));
          sharedIpCount = ipsWithOthers.size;
        }

        const vCount = Number(user.violation_count || 0);
        const hasViolations = vCount > 0 || user.is_suspicious || farmUsers > 0 || (alertsCount || 0) > 0;
        const accAgeDays = Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000);

        // Send channel message
        const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_V2");
        if (botToken && channelId) {
          const nanotons = Math.round(amt * 1_000_000);
          const tonkeeperUrl = `https://app.tonkeeper.com/transfer/${user.ton_wallet_address}?jetton=${jetton}&amount=${nanotons}&text=Starment%20withdrawal%20%23${wIns.request_number}`;

          const flagLines: string[] = [];
          if (user.is_suspicious) flagLines.push("🚨 подозрительный аккаунт");
          if (vCount > 0) flagLines.push(`⚠️ нарушений: *${vCount}*`);
          if ((alertsCount || 0) > 0) flagLines.push(`🔔 алертов: *${alertsCount}*`);
          if (farmUsers > 0) flagLines.push(`👥 ферма: *${farmUsers}* аккаунт(ов) на ${sharedIpCount} общих IP`);

          const flagsBlock = hasViolations
            ? `\n🛑 *ВНИМАНИЕ — НАРУШЕНИЯ*\n${flagLines.map(l => `• ${l}`).join("\n")}\n`
            : `\n✅ Нарушений не обнаружено\n`;

          const report =
            `📤 *Запрос №${wIns.request_number}*\n` +
            `👤 @${user.username || user.telegram_id} \`${user.telegram_id}\`\n` +
            `📅 Аккаунт: ${accAgeDays}д\n` +
            `💵 Сумма: *${amt.toFixed(2)} USDT* (${amountPt} PT)\n` +
            `🕒 ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}\n` +
            `📬 Кошелёк:\n\`${user.ton_wallet_address}\`` +
            flagsBlock;

          try {
            const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: Number(channelId),
                text: report,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [
                  [{ text: "💳 Оплатить в Tonkeeper", url: tonkeeperUrl }],
                  [{ text: "✅ Готово", callback_data: `wd_pay_${wIns.id}` },
                   { text: "❌ Отменить", callback_data: `wd_cancel_${wIns.id}` }],
                ]},
              }),
            });
            const tgJson = await tgRes.json();
            if (tgJson?.ok && tgJson.result?.message_id) {
              await supabase.from("withdrawals").update({ channel_message_id: tgJson.result.message_id }).eq("id", wIns.id);
            }
          } catch (e) { console.log("channel send fail", String(e)); }
        }

        return jsonResponse({ data: { ok: true, id: wIns.id, amount_usdt: amt, amount_pt: amountPt, new_balance: newBalance } });
      }


      case "presence_ping": {
        const { telegram_id } = params;
        if (!telegram_id) return jsonResponse({ data: { ok: false } });
        await supabase.from("users")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("telegram_id", telegram_id);
        return jsonResponse({ data: { ok: true } });
      }

      case "set_wallet": {
        const { telegram_id, wallet_address } = params;
        if (!telegram_id) return jsonResponse({ error: "telegram_id required" }, 400);
        const addr = wallet_address == null ? null : String(wallet_address).trim().slice(0, 128) || null;
        // Simple sanity check for TON friendly/raw address (base64url or hex); reject empty-ish garbage.
        if (addr !== null && !/^[A-Za-z0-9_\-:]{20,128}$/.test(addr)) {
          return jsonResponse({ error: "invalid wallet address" }, 400);
        }
        const res = await supabase.from("users")
          .update({ ton_wallet_address: addr })
          .eq("telegram_id", telegram_id);
        if (res.error) return jsonResponse({ error: res.error.message }, 500);
        return jsonResponse({ data: { ok: true, wallet_address: addr } });
      }

      case "get_wallet": {
        const { telegram_id } = params;
        if (!telegram_id) return jsonResponse({ data: { wallet_address: null } });
        const { data: u } = await supabase.from("users")
          .select("ton_wallet_address").eq("telegram_id", telegram_id).maybeSingle();
        return jsonResponse({ data: { wallet_address: u?.ton_wallet_address ?? null } });
      }

      case "get_referral": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");
        const { data: user } = await supabase
          .from("users")
          .select("id, referral_earnings_pt")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");
        const { data: refs } = await supabase
          .from("users")
          .select("id, telegram_id, username, created_at")
          .eq("referrer_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        const { data: cfgRows } = await supabase
          .from("settings").select("key,value").in("key", ["bot_username"]);
        let bot_username = ((cfgRows || []).find((r: any) => r.key === "bot_username")?.value || "").replace(/^@/, "");
        if (!bot_username) {
          const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_V2");
          if (botToken) {
            try {
              const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
              const j = await r.json();
              if (j?.ok && j.result?.username) {
                bot_username = j.result.username;
                await supabase.from("settings").upsert({ key: "bot_username", value: bot_username });
              }
            } catch {}
          }
        }
        return jsonResponse({
          data: {
            user_id: user.id,
            bot_username,
            total_earnings_pt: Number(user.referral_earnings_pt || 0),
            referrals: (refs || []).map((r: any) => ({
              id: r.id,
              telegram_id: Number(r.telegram_id),
              username: r.username,
              joined_at: r.created_at,
            })),
            count: (refs || []).length,
          },
        });
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
        const { telegram_id } = params;
        let completedIds = new Set<string>();
        let redoIds = new Set<string>();
        if (telegram_id) {
          const { data: user } = await supabase
            .from("users").select("id").eq("telegram_id", telegram_id).single();
          if (user) {
            const { data: done } = await supabase
              .from("task_completions").select("task_id").eq("user_id", user.id);
            completedIds = new Set((done || []).map((d: any) => d.task_id));
            const { data: unsubs } = await supabase
              .from("subscription_checks")
              .select("task_id").eq("user_id", user.id).eq("status", "unsub");
            redoIds = new Set((unsubs || []).map((d: any) => d.task_id));
          }
        }
        const { data: tasks } = await supabase
          .from("tasks")
          .select("id, type, title, channel_username, channel_id, post_url, reward_pt, max_completions, current_completions, min_seconds_away")
          .eq("is_active", true)
          .neq("type", "video")
          .order("created_at", { ascending: false });
        const filtered = (tasks || [])
          .filter((t: any) => !completedIds.has(t.id))
          .map((t: any) => ({ ...t, requires_redo: redoIds.has(t.id) }));
        return jsonResponse({ data: { tasks: filtered } });
      }

      case "get_pending_unsubs": {
        const { telegram_id } = params;
        if (!telegram_id) return jsonResponse({ data: { tasks: [] } });
        const { data: user } = await supabase.from("users")
          .select("id").eq("telegram_id", telegram_id).maybeSingle();
        if (!user) return jsonResponse({ data: { tasks: [] } });
        const { data: unsubs } = await supabase
          .from("subscription_checks")
          .select("task_id, reward_pt, channel_username")
          .eq("user_id", user.id).eq("status", "unsub");
        const ids = (unsubs || []).map((u: any) => u.task_id);
        if (ids.length === 0) return jsonResponse({ data: { tasks: [] } });
        const { data: tasks } = await supabase.from("tasks")
          .select("id, title, channel_username, reward_pt, is_active, max_completions, current_completions")
          .in("id", ids);
        // Skip ones the admin already deactivated / exhausted — clean up silently.
        const stale: string[] = [];
        const active = (tasks || []).filter((t: any) => {
          const dead = !t.is_active || (t.max_completions && t.current_completions >= t.max_completions);
          if (dead) stale.push(t.id);
          return !dead;
        });
        if (stale.length) {
          await supabase.from("subscription_checks")
            .update({ status: "skipped", processed_at: new Date().toISOString() })
            .eq("user_id", user.id).in("task_id", stale).eq("status", "unsub");
        }
        return jsonResponse({ data: { tasks: active } });
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
          .select("id, type, channel_username, channel_id, post_url, reward_pt, is_active, max_completions, current_completions, min_seconds_away, recheck_minutes")
          .eq("id", task_id).single();
        if (!task || !task.is_active) throw new Error("Task unavailable");
        if (task.max_completions && task.current_completions >= task.max_completions) {
          return jsonResponse({ data: { completed: false, subscribed: false, reason: "limit_reached" } });
        }

        let completed = false;
        let failReason = "";

        if (task.type === "subscribe") {
          const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_V2");
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
                break;
              } else {
                failReason = j?.description || "telegram_error";
              }
            } catch (e) {
              console.log("verify_task getChatMember fetch error", String(e));
              failReason = "network_error";
            }
          }
        } else if (task.type === "view_post" || task.type === "view_story" || task.type === "survey") {
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

        await supabase.from("task_completions").insert({ user_id: user.id, task_id });
        await supabase.from("tasks").update({
          current_completions: (task.current_completions || 0) + 1,
        }).eq("id", task_id);

        let newBalance = Number(user.balance_pt);
        if (!user.balance_frozen) {
          newBalance = Number(user.balance_pt) + Number(task.reward_pt);
          await supabase.from("users").update({ balance_pt: newBalance }).eq("id", user.id);
          await creditReferral(supabase, user.id, Number(task.reward_pt), "task", { task_id, type: task.type });
        }


        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "task_reward",
          ip_address: ip,
          metadata: { task_id, reward_pt: task.reward_pt, type: task.type },
        });

        // Snapshot: extended activity log (survives entity deletion)
        try {
          const [{ data: t2 }, { data: u2 }] = await Promise.all([
            supabase.from("tasks")
              .select("id, title, type, public_id, advertiser_id, advertisers(name, public_id)")
              .eq("id", task_id).maybeSingle(),
            supabase.from("users").select("username, telegram_id").eq("id", user.id).maybeSingle(),
          ]);
          const adv: any = (t2 as any)?.advertisers || null;
          await supabase.from("activity_logs").insert({
            user_id: user.id,
            user_username: u2?.username || null,
            user_telegram_id: u2?.telegram_id ?? null,
            action_type: (t2?.type as string) || (task.type as string),
            task_id,
            task_title: t2?.title || null,
            task_public_id: t2?.public_id || null,
            advertiser_id: t2?.advertiser_id || null,
            advertiser_name: adv?.name || null,
            advertiser_public_id: adv?.public_id || null,
            reward_pt: Number(task.reward_pt),
            finished_at: new Date().toISOString(),
          });
        } catch (_) { /* logging must never break reward flow */ }

        // Schedule a background re-check for subscribe tasks, using the PER-TASK interval.
        // Also clears any prior "unsub" row for this task (user re-subscribed).
        if (task.type === "subscribe") {
          await supabase.from("subscription_checks")
            .update({ status: "resolved", processed_at: new Date().toISOString() })
            .eq("user_id", user.id).eq("task_id", task_id).in("status", ["unsub", "pending"]);

          const minutes = Math.max(0, Math.floor(Number((task as any).recheck_minutes ?? 0)));
          if (minutes > 0) {
            await supabase.from("subscription_checks").insert({
              user_id: user.id,
              task_id,
              telegram_id: Number(telegram_id),
              channel_id: task.channel_id ? String(task.channel_id) : null,
              channel_username: task.channel_username || null,
              reward_pt: Number(task.reward_pt),
              check_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
              status: "pending",
            });
          }
        }

        return jsonResponse({ data: { completed: true, subscribed: true, new_balance: newBalance, reward: Number(task.reward_pt) } });
      }




      case "get_leaderboard": {
        const { telegram_id } = params;
        const { data: top } = await supabase
          .from("users")
          .select("id, telegram_id, username, balance_pt")
          .eq("is_banned", false)
          .order("balance_pt", { ascending: false })
          .limit(3);
        let me: any = null;
        if (telegram_id) {
          const { data: u } = await supabase
            .from("users")
            .select("id, telegram_id, username, balance_pt")
            .eq("telegram_id", telegram_id)
            .maybeSingle();
          if (u) {
            const { count: higher } = await supabase
              .from("users")
              .select("id", { count: "exact", head: true })
              .eq("is_banned", false)
              .gt("balance_pt", Number(u.balance_pt));
            me = {
              id: u.id,
              telegram_id: Number(u.telegram_id),
              username: u.username,
              balance_pt: Number(u.balance_pt),
              rank: (higher || 0) + 1,
            };
          }
        }
        return jsonResponse({
          data: {
            top: (top || []).map((t: any) => ({
              id: t.id,
              telegram_id: Number(t.telegram_id),
              username: t.username,
              balance_pt: Number(t.balance_pt),
            })),
            me,
          },
        });
      }

      case "get_transactions": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");
        const { data: user } = await supabase
          .from("users").select("id").eq("telegram_id", telegram_id).single();
        if (!user) throw new Error("User not found");
        const { data: rows } = await supabase
          .from("logs_activity")
          .select("id, action, created_at, metadata")
          .eq("user_id", user.id)
          .in("action", ["task_reward", "video_reward", "promo_reward", "balance_reset", "referral_reward"])
          .order("created_at", { ascending: false })
          .limit(80);
        const items = (rows || []).map((r: any) => {
          const meta = r.metadata || {};
          let kind = "task";
          let sub = "task";
          let label = "Задание";
          let amount = Number(meta.reward_pt || 0);
          if (r.action === "video_reward") { kind = "video"; sub = "video"; label = "Видеореклама"; }
          else if (r.action === "promo_reward") { kind = "promo"; sub = "promo"; label = "Промокод"; amount = Number(meta.reward_pt || 0); }
          else if (r.action === "referral_reward") { kind = "referral"; sub = "referral"; label = "Реферальный бонус"; amount = Number(meta.bonus || 0); }
          else if (r.action === "balance_reset") { kind = "reset"; sub = "reset"; label = "Обнуление баланса"; amount = Number(meta.amount || 0); }
          else if (meta.type === "subscribe") { sub = "subscribe"; label = "Подписка на канал"; }
          else if (meta.type === "view_post") { sub = "view_post"; label = "Просмотр поста"; }
          else if (meta.type === "view_story") { sub = "view_story"; label = "Просмотр истории"; }
          else if (meta.type === "reaction") { sub = "reaction"; label = "Реакция"; }
          return {
            id: r.id,
            kind,
            sub,
            label,
            reward_pt: amount,
            reason: meta.reason || null,
            at: r.created_at,
          };
        }).filter((x: any) => x.reward_pt !== 0);
        return jsonResponse({ data: { items } });
      }

      case "redeem_promo": {
        const { telegram_id, code } = params;
        if (!telegram_id) throw new Error("telegram_id required");
        const raw = String(code || "").trim();
        if (!raw) return jsonResponse({ data: { ok: false, reason: "invalid" } });

        const { data: user } = await supabase
          .from("users")
          .select("id, is_banned, captcha_pending, balance_pt")
          .eq("telegram_id", telegram_id)
          .maybeSingle();
        if (!user) return jsonResponse({ data: { ok: false, reason: "invalid" } });
        if (user.is_banned) return jsonResponse({ data: { ok: false, reason: "invalid" } });
        if (user.captcha_pending) return jsonResponse({ data: { locked: true } });

        // Case-insensitive lookup.
        const { data: promo } = await supabase
          .from("promo_codes")
          .select("*")
          .ilike("code", raw)
          .maybeSingle();

        // Uniform "invalid" for anything unusable — matches the spec.
        const nowMs = Date.now();
        const isExhausted = (p: any) => p.max_uses != null && p.used_count >= p.max_uses;
        const isExpired = (p: any) => p.expires_at && new Date(p.expires_at).getTime() <= nowMs;

        if (!promo || !promo.is_active || promo.is_paused || isExpired(promo) || isExhausted(promo)) {
          // Auto-deactivate exhausted/expired so admin panel reflects it.
          if (promo && promo.is_active && (isExhausted(promo) || isExpired(promo))) {
            await supabase.from("promo_codes").update({ is_active: false }).eq("id", promo.id);
          }
          return jsonResponse({ data: { ok: false, reason: "invalid" } });
        }

        // Already redeemed by this user?
        const { data: existing } = await supabase
          .from("promo_redemptions")
          .select("id")
          .eq("promo_id", promo.id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (existing) return jsonResponse({ data: { ok: false, reason: "already" } });

        // Insert redemption first (unique constraint prevents double).
        const { error: redErr } = await supabase.from("promo_redemptions").insert({
          promo_id: promo.id,
          user_id: user.id,
          reward_pt: promo.reward_pt,
        });
        if (redErr) {
          if (String(redErr.message).toLowerCase().includes("duplicate")) {
            return jsonResponse({ data: { ok: false, reason: "already" } });
          }
          throw redErr;
        }

        const newBalance = Number(user.balance_pt) + Number(promo.reward_pt);
        await supabase.from("users").update({ balance_pt: newBalance }).eq("id", user.id);

        const newUsed = (promo.used_count || 0) + 1;
        const nowExhausted = promo.max_uses != null && newUsed >= promo.max_uses;
        await supabase.from("promo_codes").update({
          used_count: newUsed,
          is_active: nowExhausted ? false : promo.is_active,
        }).eq("id", promo.id);

        // Log to activity history (miniapp transactions)
        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "promo_reward",
          metadata: { promo_id: promo.id, code: promo.code, reward_pt: Number(promo.reward_pt) },
        });

        return jsonResponse({ data: { ok: true, amount: Number(promo.reward_pt), new_balance: newBalance } });
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

async function creditReferral(supabase: any, userId: string, reward: number, source: "task" | "video", meta: Record<string, any>) {
  try {
    if (!reward || reward <= 0) return;
    const { data: u } = await supabase
      .from("users")
      .select("referrer_id")
      .eq("id", userId)
      .single();
    if (!u?.referrer_id) return;
    const { data: ref } = await supabase
      .from("users")
      .select("id, balance_pt, referral_earnings_pt, balance_frozen, is_banned")
      .eq("id", u.referrer_id)
      .single();
    if (!ref || ref.is_banned || ref.balance_frozen) return;
    // 5%, обрезаем до 2 знаков (0.5 → 0.5, 0.13 → 0.13, 0.155 → 0.16)
    const bonus = Math.round(reward * 0.05 * 100) / 100;
    if (bonus <= 0) return;
    const newBalance = Math.round((Number(ref.balance_pt) + bonus) * 100) / 100;
    const newEarnings = Math.round((Number(ref.referral_earnings_pt || 0) + bonus) * 100) / 100;
    await supabase.from("users").update({
      balance_pt: newBalance,
      referral_earnings_pt: newEarnings,
    }).eq("id", ref.id);
    await supabase.from("logs_activity").insert({
      user_id: ref.id,
      action: "referral_reward",
      metadata: { from_user_id: userId, source, bonus, base_reward: reward, ...meta },
    });
  } catch (e) {
    console.log("creditReferral error", String(e));
  }
}

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

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_V2");
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
