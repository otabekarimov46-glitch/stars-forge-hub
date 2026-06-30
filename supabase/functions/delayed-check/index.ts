import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_API = "https://api.telegram.org/bot";

// Telegram rate-limit guard: ~30 req/s globally for bots, getChatMember is
// per-chat. Keep a conservative pace + small batch to avoid 429 / soft-bans.
const BATCH_SIZE = 25;
const SLEEP_BETWEEN_CALLS_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN_NEW") || Deno.env.get("TELEGRAM_BOT_TOKEN")!;

    const { data: checks, error } = await supabase
      .from("delayed_checks")
      .select("*, tasks(*), users(*)")
      .eq("checked", false)
      .lte("check_at", new Date().toISOString())
      .order("check_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!checks || checks.length === 0) {
      return jsonResponse({ data: { processed: 0 } });
    }

    let processed = 0;
    let deducted = 0;
    let skipped = 0;

    for (const check of checks) {
      const task = check.tasks;
      const user = check.users;
      if (!task || !user) {
        await supabase.from("delayed_checks").update({ checked: true }).eq("id", check.id);
        continue;
      }

      // Forget the check if conditions no longer apply:
      // - task disabled
      // - hold period ended (created_at + hold_days)
      // - limit reached
      const holdDays = Number(task.hold_days || 0);
      const holdEnded = holdDays > 0 &&
        Date.now() - new Date(task.created_at).getTime() > holdDays * 24 * 60 * 60 * 1000;
      const limitReached = task.max_completions > 0 && task.current_completions >= task.max_completions;
      if (!task.is_active || holdEnded || limitReached) {
        await supabase.from("delayed_checks").delete().eq("id", check.id);
        skipped++;
        processed++;
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
          if (res.status === 429) {
            // Hit Telegram rate limit — back off and try this check next run.
            const retryAfter = Number(memberData?.parameters?.retry_after || 1);
            await sleep(Math.min(5000, retryAfter * 1000));
            continue;
          }
          if (memberData?.ok) {
            const status = memberData?.result?.status;
            if (!status || status === "left" || status === "kicked") shouldDeduct = true;
          } else {
            // Uncertainty (network / channel unreachable / bot removed) — do NOT deduct.
            console.log("delayed-check getChatMember not ok:", memberData?.description);
          }
        } catch (e) {
          console.error("getChatMember error:", e);
        }
        // Pace requests to stay well under Telegram's global limit.
        await sleep(SLEEP_BETWEEN_CALLS_MS);
      }

      if (shouldDeduct) {
        const balance = Number(user.balance_pt);
        const reward = Number(task.reward_pt);
        const canDeduct = balance >= reward;
        if (canDeduct) {
          await supabase.from("users")
            .update({ balance_pt: balance - reward })
            .eq("id", user.id);
        }

        // Free up the slot so the user can re-do the task.
        await supabase.from("task_completions")
          .delete()
          .eq("user_id", user.id)
          .eq("task_id", task.id);
        await supabase.from("tasks").update({
          current_completions: Math.max(0, (task.current_completions || 1) - 1),
        }).eq("id", task.id);

        // Mark the check as done; reward_deducted=true + acknowledged=false
        // signals the Mini App to show the popup on next entry.
        await supabase.from("delayed_checks")
          .update({ checked: true, reward_deducted: true, acknowledged: false })
          .eq("id", check.id);

        await supabase.from("admin_alerts").insert({
          type: "subscription_check_fail",
          user_id: user.id,
          message: canDeduct
            ? `Пользователь отписался от ${task.channel_username || "канала"}. Списано ${reward} PT.`
            : `Пользователь отписался от ${task.channel_username || "канала"}, но баланс уже выведен — списание пропущено.`,
        });

        deducted++;
      } else {
        // Still subscribed → forget the check entirely (per user request).
        await supabase.from("delayed_checks").delete().eq("id", check.id);
      }

      processed++;
    }

    return jsonResponse({ data: { processed, deducted, skipped, batch_size: BATCH_SIZE } });
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
