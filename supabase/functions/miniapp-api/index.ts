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

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "0.0.0.0";

    switch (action) {
      case "get_next_video": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        let { data: user } = await supabase
          .from("users")
          .select("id, is_banned, balance_frozen, captcha_pending")
          .eq("telegram_id", telegram_id)
          .single();

        if (!user) {
          const { data: newUser, error } = await supabase
            .from("users")
            .insert({ telegram_id })
            .select("id, is_banned, balance_frozen, captcha_pending")
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
        if (list.length === 0) return jsonResponse({ data: null });

        const unwatched = list.filter((v: any) => !watchedIds.has(v.id));
        const watchedAgain = list.filter((v: any) => watchedIds.has(v.id));
        // shuffle helper
        const shuffle = <T,>(arr: T[]) => arr.map(a => [Math.random(), a] as const).sort((a, b) => a[0] - b[0]).map(([, a]) => a);
        // Queue: random unwatched first, then random watched at the end
        const queue = [...shuffle(unwatched), ...shuffle(watchedAgain)];
        const video = queue[0] || null;

        return jsonResponse({ data: video });
      }

      case "start_view": {
        const { telegram_id, video_ad_id } = params;
        if (!telegram_id || !video_ad_id) throw new Error("telegram_id and video_ad_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");

        const { data: view, error } = await supabase
          .from("video_views")
          .insert({ user_id: user.id, video_ad_id, ip_address: ip })
          .select("id")
          .single();
        if (error) throw error;

        return jsonResponse({ data: { view_id: view.id } });
      }

      case "finish_view": {
        const { telegram_id, view_id } = params;
        if (!telegram_id || !view_id) throw new Error("telegram_id and view_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, balance_pt, balance_frozen, violation_count, is_suspicious, username, telegram_id")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");

        const { data: view } = await supabase
          .from("video_views")
          .select("id, video_ad_id, started_at, rewarded")
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

        // Antifraud: finished faster than minimum allowed
        if (elapsedSec < video.duration_seconds * 0.8) {
          const newViolations = (user.violation_count || 0) + 1;
          await supabase.from("users").update({
            violation_count: newViolations,
            is_suspicious: newViolations >= 3 ? true : user.is_suspicious,
            is_banned: newViolations >= 6,
          }).eq("id", user.id);
          await supabase.from("admin_alerts").insert({
            type: "fraud",
            user_id: user.id,
            message: `🚨 Накрутка просмотра: @${user.username || user.telegram_id} досмотрел ${elapsedSec.toFixed(1)}с / ${video.duration_seconds}с (нарушений: ${newViolations})`,
          });
          throw new Error("Видео не досмотрено");
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

        return jsonResponse({ data: { rewarded: true, amount: video.reward_pt, new_balance: newBalance } });
      }


      case "claim_daily_bonus": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        const { data: user } = await supabase
          .from("users")
          .select("id, balance_pt, daily_bonus_at, is_banned, balance_frozen")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");
        if (user.is_banned) throw new Error("Аккаунт заблокирован");

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
