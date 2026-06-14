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
      if (!task || !user) {
        await supabase.from("delayed_checks").update({ checked: true }).eq("id", check.id);
        continue;
      }

      let shouldDeduct = false;

      if (task.type === "subscribe" && (task.channel_id || task.channel_username)) {
        try {
          const chatId = task.channel_id
            ? Number(task.channel_id)
            : `@${String(task.channel_username).replace(/^@/, "")}`;
          const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, user_id: user.telegram_id }),
          });
          const memberData = await res.json();
          if (memberData?.ok) {
            const status = memberData?.result?.status;
            if (!status || status === "left" || status === "kicked") {
              shouldDeduct = true;
            }
          } else {
            // Telegram API call failed (rate limit / network / channel unreachable) —
            // do NOT deduct on uncertainty. Just mark checked to avoid retry storms.
            console.log("delayed-check getChatMember not ok:", memberData?.description);
          }
        } catch (e) {
          console.error("getChatMember error:", e);
        }
      }

      if (shouldDeduct) {
        const balance = Number(user.balance_pt);
        const reward = Number(task.reward_pt);
        // If user already withdrew (balance < reward) — do NOT deduct, per spec.
        const canDeduct = balance >= reward;
        if (canDeduct) {
          await supabase.from("users")
            .update({ balance_pt: balance - reward })
            .eq("id", user.id);
        }

        // Make task available again: remove completion + free up slot.
        await supabase.from("task_completions")
          .delete()
          .eq("user_id", user.id)
          .eq("task_id", task.id);
        await supabase.from("tasks").update({
          current_completions: Math.max(0, (task.current_completions || 1) - 1),
        }).eq("id", task.id);

        await supabase.from("delayed_checks")
          .update({ checked: true, reward_deducted: canDeduct })
          .eq("id", check.id);

        // Notify user only if we actually deducted, to keep Telegram traffic low.
        if (canDeduct) {
          try {
            await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: user.telegram_id,
                text: `⚠️ Вы отписались от ${task.channel_username || "канала"}. С вашего баланса списано *${reward} PT*.`,
                parse_mode: "Markdown",
              }),
            });
          } catch {}
        }

        await supabase.from("admin_alerts").insert({
          type: "subscription_check_fail",
          user_id: user.id,
          message: canDeduct
            ? `Пользователь отписался от ${task.channel_username || "канала"}. Списано ${reward} PT.`
            : `Пользователь отписался от ${task.channel_username || "канала"}, но баланс уже выведен — списание пропущено.`,
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
