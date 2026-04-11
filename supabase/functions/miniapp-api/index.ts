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

    // Get user's IP from headers
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "0.0.0.0";

    switch (action) {
      case "get_next_video": {
        const { telegram_id } = params;
        if (!telegram_id) throw new Error("telegram_id required");

        // Get or create user
        let { data: user } = await supabase
          .from("users")
          .select("id, is_banned, balance_frozen")
          .eq("telegram_id", telegram_id)
          .single();

        if (!user) {
          const { data: newUser, error } = await supabase
            .from("users")
            .insert({ telegram_id })
            .select("id, is_banned, balance_frozen")
            .single();
          if (error) throw error;
          user = newUser;
        }

        if (user.is_banned) throw new Error("Аккаунт заблокирован");

        // Record IP
        const { data: existingIp } = await supabase
          .from("user_ips")
          .select("id")
          .eq("user_id", user.id)
          .eq("ip_address", ip)
          .single();

        if (existingIp) {
          await supabase
            .from("user_ips")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", existingIp.id);
        } else {
          await supabase
            .from("user_ips")
            .insert({ user_id: user.id, ip_address: ip });
        }

        // Log activity
        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "miniapp_open",
          ip_address: ip,
        });

        // Get watched video IDs
        const { data: watched } = await supabase
          .from("video_views")
          .select("video_ad_id")
          .eq("user_id", user.id)
          .eq("rewarded", true);

        const watchedIds = (watched || []).map((v: any) => v.video_ad_id);

        // Get next active video not yet watched
        let query = supabase
          .from("video_ads")
          .select("id, title, video_url, duration_seconds, reward_pt")
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1);

        if (watchedIds.length > 0) {
          query = query.not("id", "in", `(${watchedIds.join(",")})`);
        }

        const { data: videos } = await query;
        const video = videos && videos.length > 0 ? videos[0] : null;

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
          .insert({
            user_id: user.id,
            video_ad_id,
            ip_address: ip,
          })
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
          .select("id, balance_pt, balance_frozen")
          .eq("telegram_id", telegram_id)
          .single();
        if (!user) throw new Error("User not found");

        // Get view and video info
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

        // Check minimum time elapsed
        const startedAt = new Date(view.started_at).getTime();
        const now = Date.now();
        const elapsedSec = (now - startedAt) / 1000;

        if (elapsedSec < video.duration_seconds * 0.8) {
          throw new Error("Видео не досмотрено");
        }

        // Mark finished and reward
        await supabase
          .from("video_views")
          .update({ finished_at: new Date().toISOString(), rewarded: true })
          .eq("id", view_id);

        if (!user.balance_frozen) {
          await supabase
            .from("users")
            .update({ balance_pt: user.balance_pt + video.reward_pt })
            .eq("id", user.id);
        }

        // Log
        await supabase.from("logs_activity").insert({
          user_id: user.id,
          action: "video_reward",
          ip_address: ip,
          metadata: { video_ad_id: view.video_ad_id, reward_pt: video.reward_pt },
        });

        return jsonResponse({ data: { rewarded: true, amount: video.reward_pt } });
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

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
