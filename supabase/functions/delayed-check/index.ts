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

    // Get all unchecked delayed_checks where check_at <= now
    const { data: checks, error } = await supabase
      .from("delayed_checks")
      .select("*, tasks(*), users(*)")
      .eq("checked", false)
      .lte("check_at", new Date().toISOString())
      .limit(50);

    if (error) throw error;
    if (!checks || checks.length === 0) {
      return jsonResponse({ data: { processed: 0 } });
    }

    let processed = 0;
    let deducted = 0;

    for (const check of checks) {
      const task = check.tasks;
      const user = check.users;
      if (!task || !user) continue;

      let shouldDeduct = false;

      if (task.type === "subscribe" && task.channel_id) {
        try {
          const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: task.channel_id, user_id: user.telegram_id }),
          });
          const memberData = await res.json();
          const status = memberData?.result?.status;
          if (!status || status === "left" || status === "kicked") {
            shouldDeduct = true;
          }
        } catch (e) {
          console.error("getChatMember error:", e);
        }
      }

      // For reaction tasks, we can't easily verify via API, so skip deduction
      // (Telegram doesn't expose reaction checks for channels easily)

      if (shouldDeduct) {
        // Deduct reward
        const newBalance = Math.max(0, user.balance_pt - task.reward_pt);
        await supabase.from("users").update({ balance_pt: newBalance }).eq("id", user.id);

        await supabase.from("delayed_checks")
          .update({ checked: true, reward_deducted: true })
          .eq("id", check.id);

        // Notify user
        await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: user.telegram_id,
            text: `⚠️ Вы отписались от ${task.channel_username || "канала"}. С вашего баланса списано *${task.reward_pt} PT*.`,
            parse_mode: "Markdown",
          }),
        });

        // Create alert
        await supabase.from("admin_alerts").insert({
          type: "subscription_check_fail",
          user_id: user.id,
          message: `Пользователь отписался от ${task.channel_username}. Списано ${task.reward_pt} PT.`,
        });

        deducted++;
      } else {
        await supabase.from("delayed_checks")
          .update({ checked: true, reward_deducted: false })
          .eq("id", check.id);
      }

      processed++;
    }

    return jsonResponse({ data: { processed, deducted } });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
