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

    const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
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
        const res = await supabase
          .from("users")
          .update({ balance_pt: 0 })
          .eq("id", params.user_id);
        data = res.data;
        error = res.error;
        await supabase.from("admin_alerts").insert({
          type: "balance_reset",
          user_id: params.user_id,
          message: `Баланс пользователя сброшен админом`,
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
          hold_days: params.hold_days || 5,
          min_seconds_away: params.min_seconds_away ?? 2,
          recheck_delay_minutes: params.recheck_delay_minutes ?? 60,
        }).select();
        data = res.data;
        error = res.error;
        break;
      }
      case "update_task": {
        const patch: Record<string, any> = {};
        ["title", "channel_username", "post_url", "reward_pt", "max_completions", "hold_days", "type", "min_seconds_away", "recheck_delay_minutes"].forEach((k) => {
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
        const [users, withdrawals, videoViewsCount, alerts] = await Promise.all([
          supabase.from("users").select("id, balance_pt, is_banned, is_suspicious, created_at"),
          supabase.from("withdrawals").select("id, status, amount_pt, amount_stars, created_at"),
          supabase.from("video_views").select("id", { count: "exact", head: true }).eq("rewarded", true),
          supabase.from("admin_alerts").select("*").eq("is_read", false).order("created_at", { ascending: false }).limit(20),
        ]);
        data = {
          users: users.data,
          withdrawals: withdrawals.data,
          rewardedVideoViews: videoViewsCount.count || 0,
          alerts: alerts.data,
        };
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
