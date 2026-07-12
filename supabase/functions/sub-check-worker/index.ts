// Background worker that verifies channel subscriptions after tasks were completed.
// Called by pg_cron every minute. Processes a small batch with per-call spacing
// to stay well below Telegram's ~30 req/s per-bot limit and handles 429 backoff.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;          // max checks per invocation
const SPACING_MS = 120;         // ~8 req/s to Telegram — safe
const MAX_ATTEMPTS = 5;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN_V2");

  if (!botToken) {
    return new Response(JSON.stringify({ error: "bot token not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pick due pending rows (FIFO)
  const { data: rows, error } = await supabase
    .from("subscription_checks")
    .select("id, user_id, task_id, telegram_id, channel_id, channel_username, reward_pt, attempts")
    .eq("status", "pending")
    .lte("check_at", new Date().toISOString())
    .order("check_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const processed: any[] = [];

  for (const row of rows || []) {
    // Cheap "should we still check?" — task inactive / limit reached / already unlinked
    const { data: task } = await supabase
      .from("tasks")
      .select("id, is_active, max_completions, current_completions, type")
      .eq("id", row.task_id).maybeSingle();

    if (!task || !task.is_active || task.type !== "subscribe"
        || (task.max_completions && task.current_completions >= task.max_completions)) {
      await supabase.from("subscription_checks").update({
        status: "skipped", processed_at: new Date().toISOString(),
      }).eq("id", row.id);
      processed.push({ id: row.id, status: "skipped" });
      continue;
    }

    // If the completion row was already removed, nothing to punish
    const { data: comp } = await supabase.from("task_completions")
      .select("id").eq("user_id", row.user_id).eq("task_id", row.task_id).maybeSingle();
    if (!comp) {
      await supabase.from("subscription_checks").update({
        status: "skipped", processed_at: new Date().toISOString(),
      }).eq("id", row.id);
      processed.push({ id: row.id, status: "skipped_no_completion" });
      continue;
    }

    const candidates: (string | number)[] = [];
    if (row.channel_id) candidates.push(Number(row.channel_id));
    if (row.channel_username) candidates.push(`@${String(row.channel_username).replace(/^@/, "")}`);

    let outcome: "member" | "not_member" | "retry" | "error" = "error";
    let lastErr = "no_candidates";

    for (const chatId of candidates) {
      await sleep(SPACING_MS);
      let resp: Response;
      try {
        resp = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, user_id: Number(row.telegram_id) }),
        });
      } catch (e) {
        lastErr = `network:${String(e).slice(0, 100)}`;
        outcome = "retry";
        break;
      }

      if (resp.status === 429) {
        const j: any = await resp.json().catch(() => ({}));
        const retry = Number(j?.parameters?.retry_after || 5);
        // Push this row into the future; do NOT mark other rows.
        await supabase.from("subscription_checks").update({
          check_at: new Date(Date.now() + (retry + 1) * 1000).toISOString(),
          attempts: (row.attempts || 0) + 1,
          last_error: `429 retry_after=${retry}`,
        }).eq("id", row.id);
        outcome = "retry";
        lastErr = `429_${retry}`;
        // Stop the whole batch — Telegram is throttling us globally.
        processed.push({ id: row.id, status: "throttled" });
        return new Response(JSON.stringify({ processed }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const json: any = await resp.json().catch(() => ({}));
      if (json?.ok) {
        const st = json.result?.status;
        if (st === "member" || st === "administrator" || st === "creator") {
          outcome = "member";
        } else {
          outcome = "not_member";
        }
        break;
      }
      lastErr = json?.description || `status_${resp.status}`;
      outcome = "retry";
    }

    if (outcome === "member") {
      await supabase.from("subscription_checks").update({
        status: "ok", processed_at: new Date().toISOString(),
      }).eq("id", row.id);
      processed.push({ id: row.id, status: "ok" });
      continue;
    }

    if (outcome === "not_member") {
      // Revoke: remove task_completion, decrement task counter, decrement balance (floor at 0)
      await supabase.from("task_completions")
        .delete().eq("user_id", row.user_id).eq("task_id", row.task_id);

      const { data: t2 } = await supabase.from("tasks")
        .select("current_completions").eq("id", row.task_id).maybeSingle();
      const nextCount = Math.max(0, Number(t2?.current_completions || 0) - 1);
      await supabase.from("tasks").update({ current_completions: nextCount }).eq("id", row.task_id);

      const { data: u } = await supabase.from("users")
        .select("balance_pt, username").eq("id", row.user_id).maybeSingle();
      const cur = Number(u?.balance_pt || 0);
      const reward = Number(row.reward_pt || 0);
      const nextBal = Math.max(0, cur - reward);
      await supabase.from("users").update({ balance_pt: nextBal }).eq("id", row.user_id);

      await supabase.from("logs_activity").insert({
        user_id: row.user_id,
        action: "sub_revoked",
        metadata: {
          task_id: row.task_id,
          revoked_pt: Math.min(reward, cur),
          channel_username: row.channel_username,
        },
      });

      await supabase.from("subscription_checks").update({
        status: "unsub", processed_at: new Date().toISOString(),
      }).eq("id", row.id);
      processed.push({ id: row.id, status: "unsub" });
      continue;
    }

    // retry / error — bump attempts, reschedule in 5 minutes
    const nextAttempts = (row.attempts || 0) + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      await supabase.from("subscription_checks").update({
        status: "error",
        attempts: nextAttempts,
        last_error: lastErr,
        processed_at: new Date().toISOString(),
      }).eq("id", row.id);
      processed.push({ id: row.id, status: "error", error: lastErr });
    } else {
      await supabase.from("subscription_checks").update({
        attempts: nextAttempts,
        last_error: lastErr,
        check_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }).eq("id", row.id);
      processed.push({ id: row.id, status: "requeued", error: lastErr });
    }
  }

  return new Response(JSON.stringify({ processed, count: processed.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
