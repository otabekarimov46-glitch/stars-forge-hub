import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_API = "https://api.telegram.org/bot";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const BOT_TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN_V2"))!;
    const { action, ...params } = await req.json();

    let data: any;
    let error: any;

    switch (action) {
      // ===== USERS =====
      case "get_users": {
        const res = await supabase
          .from("users")
          .select("*, user_ips(ip_address)")
          .order("created_at", { ascending: false })
          .limit(params.limit || 200);
        data = res.data;
        error = res.error;
        break;
      }
      case "ban_user": {
        const res = await supabase
          .from("users")
          .update({ is_banned: params.is_banned ?? true })
          .eq("id", params.user_id);
        data = res.data;
        error = res.error;
        break;
      }
      case "bulk_ban": {
        // Ban multiple users by IDs
        const { user_ids } = params;
        if (!user_ids || !Array.isArray(user_ids)) throw new Error("user_ids array required");
        const res = await supabase
          .from("users")
          .update({ is_banned: true })
          .in("id", user_ids);
        data = { banned: user_ids.length };
        error = res.error;
        break;
      }
      case "freeze_balance": {
        const res = await supabase
          .from("users")
          .update({ balance_frozen: params.frozen ?? true })
          .eq("id", params.user_id);
        data = res.data;
        error = res.error;
        break;
      }
      case "send_captcha": {
        const a = Math.floor(Math.random() * 20) + 1;
        const b = Math.floor(Math.random() * 20) + 1;
        const answer = a + b;
        const captchaText = `${a}+${b}`;

        const res = await supabase
          .from("users")
          .update({ captcha_pending: captchaText, captcha_answer: answer, captcha_count: params.captcha_count || 1 })
          .eq("id", params.user_id)
          .select("telegram_id")
          .single();
        if (res.error) { error = res.error; break; }

        await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: res.data.telegram_id,
            text: `🔒 *Проверка безопасности*\n\nРешите пример: *${a} + ${b} = ?*\n\nОтправьте ответ числом. До верного ответа все функции заблокированы.`,
            parse_mode: "Markdown",
          }),
        });

        await supabase.from("admin_alerts").insert({
          type: "force_captcha",
          user_id: params.user_id,
          message: `Админ назначил капчу пользователю (${captchaText}=${answer})`,
        });
        data = { ok: true };
        break;
      }
      case "reset_balance": {
        const reason = String(params.reason || "").trim().slice(0, 500) || null;
        const { data: u0 } = await supabase
          .from("users")
          .select("id, telegram_id, username, balance_pt")
          .eq("id", params.user_id)
          .single();
        const oldBalance = Number(u0?.balance_pt || 0);
        const res = await supabase
          .from("users")
          .update({ balance_pt: 0 })
          .eq("id", params.user_id);
        error = res.error;
        data = { old_balance: oldBalance };
        const humanTag = u0?.username ? `@${u0.username}` : `ID ${u0?.telegram_id ?? params.user_id}`;
        const alertMsg = `Баланс пользователя ${humanTag} сброшен админом (было ${oldBalance.toFixed(2)} PT → 0)${reason ? `. Причина: ${reason}` : " — без указания причины"}`;
        await supabase.from("admin_alerts").insert({
          type: "balance_reset",
          user_id: params.user_id,
          message: alertMsg,
        });
        // Extended activity log — appears in "Все логи" and export
        await supabase.from("activity_logs").insert({
          user_id: params.user_id,
          user_username: u0?.username || null,
          user_telegram_id: u0?.telegram_id || null,
          action_type: "balance_reset",
          reward_pt: -oldBalance,
          task_title: reason ? `Причина: ${reason}` : "Без указания причины",
        });
        // Miniapp transaction history entry
        await supabase.from("logs_activity").insert({
          user_id: params.user_id,
          action: "balance_reset",
          metadata: { amount: -oldBalance, old_balance: oldBalance, reason },
        });
        break;
      }
      case "send_message": {
        const { data: user, error: userErr } = await supabase
          .from("users")
          .select("telegram_id")
          .eq("id", params.user_id)
          .single();
        if (userErr || !user) { error = userErr || { message: "User not found" }; break; }

        await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: user.telegram_id,
            text: `📩 *Сообщение от администрации:*\n\n${params.message}`,
            parse_mode: "Markdown",
          }),
        });

        await supabase.from("admin_alerts").insert({
          type: "admin_message",
          user_id: params.user_id,
          message: `Админ отправил сообщение: ${params.message}`,
        });
        data = { ok: true };
        break;
      }

      // ===== FARMS (IP grouping) =====
      case "get_farms": {
        // Get IPs shared by multiple users
        const { data: ips, error: ipErr } = await supabase
          .from("user_ips")
          .select("ip_address, user_id, users(id, telegram_id, username, is_banned, balance_pt)")
          .order("last_seen_at", { ascending: false });
        if (ipErr) { error = ipErr; break; }

        // Group by IP
        const ipMap: Record<string, any[]> = {};
        (ips || []).forEach((row: any) => {
          const ip = row.ip_address;
          if (!ipMap[ip]) ipMap[ip] = [];
          if (row.users) ipMap[ip].push(row.users);
        });

        // Only return IPs with 2+ users
        const farms = Object.entries(ipMap)
          .filter(([_, users]) => users.length >= 2)
          .map(([ip, users]) => ({ ip, users, count: users.length }))
          .sort((a, b) => b.count - a.count);

        data = farms;
        break;
      }

      // ===== ADVERTISERS =====
      case "get_advertisers": {
        const [advs, tks, vds] = await Promise.all([
          supabase.from("advertisers").select("*").order("created_at", { ascending: false }),
          supabase.from("tasks").select("id, advertiser_id, is_active").neq("type", "video"),
          supabase.from("video_ads").select("id, advertiser_id, is_active"),
        ]);
        if (advs.error) { error = advs.error; break; }
        const counts: Record<string, { total: number; active: number; tasks: number; videos: number }> = {};
        const bump = (k: string, active: boolean, kind: "tasks" | "videos") => {
          if (!counts[k]) counts[k] = { total: 0, active: 0, tasks: 0, videos: 0 };
          counts[k].total++;
          counts[k][kind]++;
          if (active) counts[k].active++;
        };
        (tks.data || []).forEach((t: any) => bump(t.advertiser_id || "_none", t.is_active, "tasks"));
        (vds.data || []).forEach((v: any) => bump(v.advertiser_id || "_none", v.is_active, "videos"));
        data = (advs.data || []).map((a: any) => ({
          ...a,
          tasks_count: counts[a.id]?.total || 0,
          active_count: counts[a.id]?.active || 0,
          bot_tasks_count: counts[a.id]?.tasks || 0,
          video_count: counts[a.id]?.videos || 0,
        }));
        break;
      }
      case "create_advertiser": {
        const res = await supabase.from("advertisers").insert({ name: params.name }).select().single();
        data = res.data; error = res.error;
        break;
      }
      case "update_advertiser": {
        const res = await supabase.from("advertisers")
          .update({ name: params.name, updated_at: new Date().toISOString() })
          .eq("id", params.advertiser_id);
        data = res.data; error = res.error;
        break;
      }
      case "delete_advertiser": {
        // Cascade: delete advertiser's tasks AND video ads
        await supabase.from("tasks").delete().eq("advertiser_id", params.advertiser_id);
        await supabase.from("video_ads").delete().eq("advertiser_id", params.advertiser_id);
        const res = await supabase.from("advertisers").delete().eq("id", params.advertiser_id);
        data = res.data; error = res.error;
        break;
      }
      case "bulk_toggle_advertiser_tasks": {
        await supabase.from("tasks")
          .update({ is_active: params.is_active })
          .eq("advertiser_id", params.advertiser_id);
        const res = await supabase.from("video_ads")
          .update({ is_active: params.is_active })
          .eq("advertiser_id", params.advertiser_id);
        data = res.data; error = res.error;
        break;
      }
      case "bulk_delete_advertiser_tasks": {
        await supabase.from("tasks").delete().eq("advertiser_id", params.advertiser_id);
        const res = await supabase.from("video_ads").delete().eq("advertiser_id", params.advertiser_id);
        data = res.data; error = res.error;
        break;
      }


      // ===== CONTENT: TASKS =====
      case "get_tasks": {
        const q = supabase.from("tasks").select("*").order("created_at", { ascending: false });
        const res = params.advertiser_id
          ? await supabase.from("tasks").select("*").eq("advertiser_id", params.advertiser_id).order("created_at", { ascending: false })
          : await q;
        data = res.data;
        error = res.error;
        break;
      }
      case "create_task": {
        const res = await supabase.from("tasks").insert({
          type: params.type,
          title: params.title || null,
          advertiser_id: params.advertiser_id || null,
          channel_username: params.channel_username || null,
          channel_id: params.channel_id ? Number(params.channel_id) : null,
          reward_pt: params.reward_pt,
          post_url: params.post_url || null,
          reaction_emoji: null,
          is_active: true,
          max_completions: params.max_completions || 0,
          min_seconds_away: params.min_seconds_away ?? 2,
          recheck_minutes: params.type === "subscribe"
            ? (Number.isFinite(Number(params.recheck_minutes)) ? Math.max(0, Math.floor(Number(params.recheck_minutes))) : null)
            : null,
        }).select();
        data = res.data;
        error = res.error;
        break;
      }
      case "update_task": {
        const patch: Record<string, any> = {};
        ["title", "channel_username", "post_url", "reward_pt", "max_completions", "type", "min_seconds_away", "recheck_minutes"].forEach((k) => {
          if (params[k] !== undefined) patch[k] = params[k];
        });
        if (params.channel_id !== undefined) patch.channel_id = params.channel_id ? Number(params.channel_id) : null;
        const res = await supabase.from("tasks").update(patch).eq("id", params.task_id);
        data = res.data; error = res.error;
        break;
      }

      case "toggle_task": {
        const res = await supabase
          .from("tasks")
          .update({ is_active: params.is_active })
          .eq("id", params.task_id);
        data = res.data;
        error = res.error;
        break;
      }
      case "delete_task": {
        const res = await supabase
          .from("tasks")
          .delete()
          .eq("id", params.task_id);
        data = res.data;
        error = res.error;
        break;
      }

      // ===== CONTENT: VIDEO ADS =====
      case "get_video_ads": {
        const res = await supabase
          .from("video_ads")
          .select("*")
          .order("created_at", { ascending: false });
        data = res.data;
        error = res.error;
        break;
      }
      case "create_video_ad": {
        const res = await supabase.from("video_ads").insert({
          title: params.title,
          video_url: params.video_url,
          duration_seconds: params.duration_seconds,
          reward_pt: params.reward_pt,
          external_link_url: params.external_link_url || null,
          external_link_label: params.external_link_label || "Перейти",
          media_type: params.media_type === "image" ? "image" : "video",
          advertiser_id: params.advertiser_id || null,
          is_active: true,
        }).select();
        data = res.data;
        error = res.error;
        break;
      }

      case "toggle_video_ad": {
        const res = await supabase
          .from("video_ads")
          .update({ is_active: params.is_active })
          .eq("id", params.video_ad_id);
        data = res.data;
        error = res.error;
        break;
      }
      case "delete_video_ad": {
        const res = await supabase
          .from("video_ads")
          .delete()
          .eq("id", params.video_ad_id);
        data = res.data;
        error = res.error;
        break;
      }

      // ===== PROMO CODES ===== (v2)
      case "get_promos": {
        const res = await supabase
          .from("promo_codes")
          .select("*")
          .order("created_at", { ascending: false });
        if (res.error) { error = res.error; break; }
        // Auto-mark exhausted/expired inactive on read so the panel stays accurate.
        const now = Date.now();
        const promos = res.data || [];
        const toDeactivate: string[] = [];
        for (const p of promos) {
          const exhausted = p.max_uses != null && p.used_count >= p.max_uses;
          const expired = p.expires_at && new Date(p.expires_at).getTime() <= now;
          if (p.is_active && (exhausted || expired)) toDeactivate.push(p.id);
        }
        if (toDeactivate.length) {
          await supabase.from("promo_codes").update({ is_active: false }).in("id", toDeactivate);
          for (const p of promos) if (toDeactivate.includes(p.id)) p.is_active = false;
        }
        data = promos;
        break;
      }
      case "create_promo": {
        const code = String(params.code || "").trim();
        if (!code) { error = { message: "Код обязателен" }; break; }
        const reward_pt = Number(params.reward_pt);
        if (!(reward_pt > 0)) { error = { message: "Некорректная награда" }; break; }
        const max_uses = params.max_uses ? Number(params.max_uses) : null;
        const expires_at = params.expires_at || null;
        // If neither limit is set — treat as infinite (1 activation per account is enforced on redeem).
        // Check for duplicates (case-insensitive) across all promo codes, active or not.
        const { data: existing } = await supabase
          .from("promo_codes")
          .select("id, code, is_active")
          .ilike("code", code)
          .limit(1);
        if (existing && existing.length > 0) {
          error = { message: `Промокод «${existing[0].code}» уже существует${existing[0].is_active ? "" : " (неактивный)"} — используйте другой код или перезапустите существующий` };
          break;
        }
        const res = await supabase.from("promo_codes").insert({
          code, reward_pt, max_uses, expires_at,
          is_active: true, is_paused: false, used_count: 0,
        }).select().single();
        data = res.data; error = res.error;
        break;
      }
      case "pause_promo": {
        const res = await supabase.from("promo_codes")
          .update({ is_paused: !!params.is_paused })
          .eq("id", params.promo_id);
        data = res.data; error = res.error;
        break;
      }
      case "restart_promo": {
        // Reset counter and re-activate. Extend expiry only if provided.
        const patch: Record<string, any> = { used_count: 0, is_active: true, is_paused: false };
        if (params.expires_at !== undefined) patch.expires_at = params.expires_at || null;
        if (params.max_uses !== undefined) patch.max_uses = params.max_uses ? Number(params.max_uses) : null;
        // Also clear old redemptions so users can use again after restart.
        await supabase.from("promo_redemptions").delete().eq("promo_id", params.promo_id);
        const res = await supabase.from("promo_codes").update(patch).eq("id", params.promo_id);
        data = res.data; error = res.error;
        break;
      }
      case "delete_promo": {
        const res = await supabase.from("promo_codes").delete().eq("id", params.promo_id);
        data = res.data; error = res.error;
        break;
      }

      // ===== PROMO STATS / LOGS =====
      case "get_top_promo_users": {
        const { data: reds, error: rErr } = await supabase
          .from("promo_redemptions")
          .select("user_id, reward_pt");
        if (rErr) { error = rErr; break; }
        const agg = new Map<string, { count: number; total: number }>();
        (reds || []).forEach((r: any) => {
          const cur = agg.get(r.user_id) || { count: 0, total: 0 };
          cur.count += 1;
          cur.total += Number(r.reward_pt || 0);
          agg.set(r.user_id, cur);
        });
        const topIds = Array.from(agg.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10)
          .map(([id]) => id);
        if (topIds.length === 0) { data = []; break; }
        const [usersRes, activityRes] = await Promise.all([
          supabase.from("users").select("id, telegram_id, username").in("id", topIds),
          supabase.from("logs_activity").select("user_id, created_at").in("user_id", topIds).order("created_at", { ascending: false }),
        ]);
        const lastSeen = new Map<string, string>();
        (activityRes.data || []).forEach((l: any) => {
          if (!lastSeen.has(l.user_id)) lastSeen.set(l.user_id, l.created_at);
        });
        const usersMap = new Map<string, any>();
        (usersRes.data || []).forEach((u: any) => usersMap.set(u.id, u));
        data = topIds.map((id) => {
          const u = usersMap.get(id) || {};
          const a = agg.get(id)!;
          return {
            user_id: id,
            telegram_id: u.telegram_id,
            username: u.username,
            promo_count: a.count,
            total_pt: a.total,
            last_seen_at: lastSeen.get(id) || null,
          };
        });
        break;
      }
      case "get_promo_logs": {
        const { data: setting } = await supabase.from("settings").select("value").eq("key", "promo_log_retention_days").maybeSingle();
        const days = setting ? Number(setting.value) : 3;
        if (days > 0) {
          const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from("promo_redemptions").delete().lt("redeemed_at", cutoff);
        }
        const codeFilter = String(params.code_search || "").trim();
        const userFilter = String(params.user_search || "").trim().replace(/^@/, "");
        let promoIds: string[] | null = null;
        if (codeFilter) {
          const { data: pc } = await supabase.from("promo_codes").select("id").ilike("code", `%${codeFilter}%`);
          promoIds = (pc || []).map((p: any) => p.id);
          if (promoIds.length === 0) { data = { logs: [], retention_days: days }; break; }
        }
        let userIds: string[] | null = null;
        if (userFilter) {
          const { data: us } = await supabase.from("users").select("id").ilike("username", `%${userFilter}%`);
          userIds = (us || []).map((u: any) => u.id);
          if (userIds.length === 0) { data = { logs: [], retention_days: days }; break; }
        }
        let q = supabase
          .from("promo_redemptions")
          .select("id, redeemed_at, reward_pt, promo_id, user_id, promo_codes(code), users(username, telegram_id)")
          .order("redeemed_at", { ascending: false })
          .limit(500);
        if (promoIds) q = q.in("promo_id", promoIds);
        if (userIds) q = q.in("user_id", userIds);
        const res = await q;
        if (res.error) { error = res.error; break; }
        data = { logs: res.data || [], retention_days: days };
        break;
      }
      case "set_promo_retention": {
        const days = Math.max(0, Math.floor(Number(params.days) || 0));
        const res = await supabase.from("settings").upsert({
          key: "promo_log_retention_days",
          value: String(days),
          updated_at: new Date().toISOString(),
        });
        data = { days }; error = res.error;
        break;
      }

      // ===== SETTINGS =====
      case "get_settings": {
        const res = await supabase.from("settings").select("*");
        data = res.data;
        error = res.error;
        break;
      }
      case "update_setting": {
        const res = await supabase
          .from("settings")
          .upsert({ key: params.key, value: params.value, updated_at: new Date().toISOString() });
        data = res.data;
        error = res.error;
        break;
      }

      // ===== STATISTICS =====
      case "get_stats": {
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
        const onlineCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const [users, withdrawals, videoViewsCount, alerts, activeCompletions, online] = await Promise.all([
          supabase.from("users").select("id, telegram_id, username, balance_pt, is_banned, is_suspicious, created_at, referrer_id, referral_earnings_pt"),
          supabase.from("withdrawals").select("id, status, amount_pt, amount_stars, created_at"),
          supabase.from("video_views").select("id", { count: "exact", head: true }).eq("rewarded", true),
          supabase.from("admin_alerts").select("*").eq("is_read", false).order("created_at", { ascending: false }).limit(20),
          supabase.from("task_completions").select("user_id").gte("completed_at", fiveDaysAgo),
          supabase.from("users").select("id", { count: "exact", head: true }).gte("last_seen_at", onlineCutoff),
        ]);
        const activeUserIds = Array.from(new Set((activeCompletions.data || []).map((c: any) => c.user_id)));
        data = {
          users: users.data,
          withdrawals: withdrawals.data,
          rewardedVideoViews: videoViewsCount.count || 0,
          alerts: alerts.data,
          activeUserIds,
          onlineNow: online.count || 0,
        };
        break;
      }
      case "get_online_now": {
        const onlineCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const res = await supabase.from("users").select("id", { count: "exact", head: true }).gte("last_seen_at", onlineCutoff);
        data = { count: res.count || 0 };
        error = res.error;
        break;
      }

      // ===== ALERTS =====
      case "get_alerts": {
        const res = await supabase
          .from("admin_alerts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        data = res.data;
        error = res.error;
        break;
      }
      case "mark_alert_read": {
        const res = await supabase
          .from("admin_alerts")
          .update({ is_read: true })
          .eq("id", params.alert_id);
        data = res.data;
        error = res.error;
        break;
      }

      // ===== ACTIVITY LOGS (extended) =====
      case "get_activity_logs": {
        // Auto-cleanup based on settings
        const [retDaysRow, retCountRow] = await Promise.all([
          supabase.from("settings").select("value").eq("key", "activity_log_retention_days").maybeSingle(),
          supabase.from("settings").select("value").eq("key", "activity_log_retention_count").maybeSingle(),
        ]);
        const retDays = Math.max(0, Math.floor(Number(retDaysRow.data?.value ?? 0)));
        const retCount = Math.max(0, Math.floor(Number(retCountRow.data?.value ?? 0)));
        if (retDays > 0) {
          const cutoff = new Date(Date.now() - retDays * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from("activity_logs").delete().lt("created_at", cutoff);
        }
        if (retCount > 0) {
          const { data: kept } = await supabase
            .from("activity_logs")
            .select("created_at")
            .order("created_at", { ascending: false })
            .range(retCount - 1, retCount - 1);
          const threshold = kept?.[0]?.created_at;
          if (threshold) await supabase.from("activity_logs").delete().lt("created_at", threshold);
        }

        const rawTypes = Array.isArray(params.types) ? params.types : [];
        const types = rawTypes.filter((t: any) => typeof t === "string");
        const q = String(params.q || "").trim();
        const userQ = String(params.user || "").trim().replace(/^@/, "");

        let query = supabase
          .from("activity_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(Math.min(1000, Math.max(1, Number(params.limit) || 300)));

        if (types.length > 0) query = query.in("action_type", types);
        if (q) query = query.or(`task_public_id.ilike.%${q}%,advertiser_public_id.ilike.%${q}%`);
        if (userQ) {
          if (/^\d+$/.test(userQ)) query = query.eq("user_telegram_id", Number(userQ));
          else query = query.ilike("user_username", `%${userQ}%`);
        }

        const res = await query;
        if (res.error) { error = res.error; break; }
        const rows = res.data || [];

        // Existence check for deletion badges
        const taskIds = Array.from(new Set(rows.map((r: any) => r.task_id).filter(Boolean)));
        const videoIds = Array.from(new Set(rows.map((r: any) => r.video_ad_id).filter(Boolean)));
        const advIds = Array.from(new Set(rows.map((r: any) => r.advertiser_id).filter(Boolean)));

        const [tRes, vRes, aRes] = await Promise.all([
          taskIds.length ? supabase.from("tasks").select("id").in("id", taskIds) : Promise.resolve({ data: [] as any[] }),
          videoIds.length ? supabase.from("video_ads").select("id").in("id", videoIds) : Promise.resolve({ data: [] as any[] }),
          advIds.length ? supabase.from("advertisers").select("id").in("id", advIds) : Promise.resolve({ data: [] as any[] }),
        ]);
        const aliveTasks = new Set((tRes.data || []).map((x: any) => x.id));
        const aliveVideos = new Set((vRes.data || []).map((x: any) => x.id));
        const aliveAdvs = new Set((aRes.data || []).map((x: any) => x.id));

        const logs = rows.map((r: any) => ({
          ...r,
          task_deleted: !!r.task_id && !aliveTasks.has(r.task_id),
          video_deleted: !!r.video_ad_id && !aliveVideos.has(r.video_ad_id),
          advertiser_deleted: !!r.advertiser_id && !aliveAdvs.has(r.advertiser_id),
        }));

        data = { logs, retention_days: retDays, retention_count: retCount };
        break;
      }
      case "set_activity_retention": {
        const days = Math.max(0, Math.floor(Number(params.days) || 0));
        const count = Math.max(0, Math.floor(Number(params.count) || 0));
        const now = new Date().toISOString();
        const [r1, r2] = await Promise.all([
          supabase.from("settings").upsert({ key: "activity_log_retention_days", value: String(days), updated_at: now }),
          supabase.from("settings").upsert({ key: "activity_log_retention_count", value: String(count), updated_at: now }),
        ]);
        data = { days, count };
        error = r1.error || r2.error;
        break;
      }

      // ===== USER ROOM (full CRM per user) =====
      case "get_user_room": {
        const uid = params.user_id;
        if (!uid) { error = { message: "user_id required" }; break; }
        const onlineCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

        const [uRes, ipsRes, activityRes, promoRes, alertsRes, refsRes, statsRes, pendRes] = await Promise.all([
          supabase.from("users").select("*").eq("id", uid).single(),
          supabase.from("user_ips").select("ip_address, first_seen_at, last_seen_at").eq("user_id", uid).order("last_seen_at", { ascending: false }),
          supabase.from("activity_logs").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(500),
          supabase.from("promo_redemptions").select("id, redeemed_at, reward_pt, promo_codes(code)").eq("user_id", uid).order("redeemed_at", { ascending: false }),
          supabase.from("admin_alerts").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(200),
          supabase.from("users").select("id, telegram_id, username, created_at, balance_pt, is_banned").eq("referrer_id", uid).order("created_at", { ascending: false }),
          supabase.from("users").select("id, balance_pt, referral_earnings_pt"),
          supabase.from("withdrawals").select("id, amount_usdt, amount_pt, status, method, wallet_address, request_number, created_at, cancel_reason").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
        ]);
        if (uRes.error) { error = uRes.error; break; }
        const user = uRes.data;

        // ranks
        const all = statsRes.data || [];
        const byBalance = [...all].sort((a: any, b: any) => Number(b.balance_pt) - Number(a.balance_pt));
        const byRefEarn = [...all].sort((a: any, b: any) => Number(b.referral_earnings_pt || 0) - Number(a.referral_earnings_pt || 0));
        const balanceRank = byBalance.findIndex((x: any) => x.id === uid) + 1;
        const refRank = byRefEarn.findIndex((x: any) => x.id === uid) + 1;

        // promo rank
        const { data: allProm } = await supabase.from("promo_redemptions").select("user_id");
        const promoCounts = new Map<string, number>();
        (allProm || []).forEach((r: any) => promoCounts.set(r.user_id, (promoCounts.get(r.user_id) || 0) + 1));
        const promoRanked = Array.from(promoCounts.entries()).sort((a, b) => b[1] - a[1]);
        const promoRank = promoRanked.findIndex(([id]) => id === uid) + 1;
        const myPromoCount = promoCounts.get(uid) || 0;

        // referrals earnings per referral
        const refIds = (refsRes.data || []).map((r: any) => r.id);
        const refEarnMap = new Map<string, number>();
        let totalRefEarn = 0;
        if (refIds.length) {
          const { data: refLogs } = await supabase
            .from("logs_activity").select("metadata")
            .eq("user_id", uid).eq("action", "referral_reward");
          (refLogs || []).forEach((l: any) => {
            const m = l.metadata || {};
            const bonus = Number(m.bonus || 0);
            totalRefEarn += bonus;
            if (m.from_user_id) refEarnMap.set(m.from_user_id, (refEarnMap.get(m.from_user_id) || 0) + bonus);
          });
        }
        const referrals = (refsRes.data || []).map((r: any) => ({
          ...r,
          earned_from: Math.round((refEarnMap.get(r.id) || 0) * 100) / 100,
        }));

        // farm ips
        let farmIps: any[] = [];
        const ipList = (ipsRes.data || []).map((r: any) => r.ip_address);
        if (ipList.length) {
          const { data: shared } = await supabase
            .from("user_ips")
            .select("ip_address, user_id, users(id, telegram_id, username, is_banned)")
            .in("ip_address", ipList as any);
          const byIp: Record<string, any[]> = {};
          (shared || []).forEach((r: any) => {
            if (!byIp[r.ip_address]) byIp[r.ip_address] = [];
            if (r.users && r.user_id !== uid) byIp[r.ip_address].push(r.users);
          });
          farmIps = Object.entries(byIp)
            .filter(([_, arr]) => arr.length > 0)
            .map(([ip, others]) => ({ ip, others }));
        }

        const pendingWithdrawal = (pendRes.data || []).find((w: any) => w.status === "pending") || null;

        data = {
          user,
          online: user.last_seen_at && user.last_seen_at >= onlineCutoff,
          ips: ipsRes.data || [],
          activity: activityRes.data || [],
          promos: promoRes.data || [],
          alerts: alertsRes.data || [],
          referrals,
          referrals_total: referrals.length,
          referrals_earnings_total: Math.round(totalRefEarn * 100) / 100,
          rank_balance: balanceRank || null,
          rank_referrals: refRank || null,
          rank_promo: promoRank || null,
          promo_count: myPromoCount,
          total_users: all.length,
          farm_ips: farmIps,
          ton_wallet_address: user.ton_wallet_address || null,
          withdrawals: pendRes.data || [],
          pending_withdrawal: pendingWithdrawal,
        };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
