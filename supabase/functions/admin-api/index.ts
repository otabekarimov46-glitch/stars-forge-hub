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

    let data: any;
    let error: any;

    switch (action) {
      // ===== USERS =====
      case "get_users": {
        const res = await supabase
          .from("users")
          .select("*, user_ips(ip_address)")
          .order("created_at", { ascending: false })
          .limit(params.limit || 100);
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
      case "freeze_balance": {
        const res = await supabase
          .from("users")
          .update({ balance_frozen: params.frozen ?? true })
          .eq("id", params.user_id);
        data = res.data;
        error = res.error;
        break;
      }
      case "force_captcha": {
        const res = await supabase
          .from("users")
          .update({ captcha_count: params.captcha_count || 1 })
          .eq("id", params.user_id);
        data = res.data;
        error = res.error;
        // Also create an alert
        await supabase.from("admin_alerts").insert({
          type: "force_captcha",
          user_id: params.user_id,
          message: `Админ принудительно назначил капчу пользователю`,
        });
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
      case "message_user": {
        // Store the message as an alert; the bot will pick it up and send
        const res = await supabase.from("admin_alerts").insert({
          type: "admin_message",
          user_id: params.user_id,
          message: params.message,
        });
        data = res.data;
        error = res.error;
        break;
      }

      // ===== CONTENT: TASKS =====
      case "get_tasks": {
        const res = await supabase
          .from("tasks")
          .select("*")
          .order("created_at", { ascending: false });
        data = res.data;
        error = res.error;
        break;
      }
      case "create_task": {
        const res = await supabase.from("tasks").insert({
          type: params.type,
          channel_username: params.channel_username,
          channel_id: params.channel_id,
          reward_pt: params.reward_pt,
          is_active: true,
        }).select();
        data = res.data;
        error = res.error;
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
        const [users, withdrawals, videoViews, alerts] = await Promise.all([
          supabase.from("users").select("id, balance_pt, is_banned, is_suspicious, created_at"),
          supabase.from("withdrawals").select("*").order("created_at", { ascending: false }),
          supabase.from("video_views").select("id, rewarded, started_at"),
          supabase.from("admin_alerts").select("*").eq("is_read", false).order("created_at", { ascending: false }).limit(20),
        ]);
        data = {
          users: users.data,
          withdrawals: withdrawals.data,
          videoViews: videoViews.data,
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
