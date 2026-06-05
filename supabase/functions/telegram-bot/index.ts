import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

const TELEGRAM_API = "https://api.telegram.org/bot";
const VARIATION_EMOJI = ["✨", "💫", "⭐", "🌟", "💎", "🎯"];



function vary(text: string) {
  const e = VARIATION_EMOJI[Math.floor(Math.random() * VARIATION_EMOJI.length)];
  // Append invisible variation so identical templates don't repeat verbatim
  return text + `\n${e}`;
}

// Per-invocation chat throttle
const lastSentByChat = new Map<number, number>();
async function sendTg(
  botToken: string,
  payload: any,
  endpoint = "sendMessage",
): Promise<any> {
  const chatId: number | undefined = payload.chat_id;
  if (chatId !== undefined) {
    const last = lastSentByChat.get(chatId) || 0;
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSentByChat.set(chatId, Date.now());
  } else {
    await new Promise((r) => setTimeout(r, 40));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${TELEGRAM_API}${botToken}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const retry = (json?.parameters?.retry_after || 1) * 1000;
      await new Promise((r) => setTimeout(r, retry + 100));
      continue;
    }
    if (res.status === 403) {
      // user blocked bot — silent
      return json;
    }
    return json;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const GROUP_ID = Deno.env.get("TELEGRAM_GROUP_ID")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json();

    if (body.update_id !== undefined) {
      // Webhook без secret_token — принимаем любые апдейты от Telegram
      return await handleUpdate(body, supabase, BOT_TOKEN, GROUP_ID, SUPABASE_URL);
    }

    if (body.action === "set_webhook") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: true,
          max_connections: 40,
        }),
      });
      return jsonResponse({ data: await res.json() });
    }

    if (body.action === "delete_webhook") {
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`);
      return jsonResponse({ data: await res.json() });
    }

    if (body.action === "get_webhook_info") {
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getWebhookInfo`);
      return jsonResponse({ data: await res.json() });
    }

    return jsonResponse({ error: "Unknown request" }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// Flood protection: count actions in last 60s from this telegram_id via logs_activity
async function isFlooding(supabase: any, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("logs_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "bot_msg")
    .gte("created_at", since);
  return (count || 0) > 25;
}

async function handleUpdate(update: any, supabase: any, botToken: string, groupId: string, supabaseUrl: string) {
  const message = update.message;
  const callback = update.callback_query;

  if (message) {
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    const text = (message.text || "").slice(0, 500);
    const username = message.from.username || null;

    let { data: user } = await supabase.from("users").select("*").eq("telegram_id", telegramId).single();

    if (!user) {
      let referrerId = null;
      if (text.startsWith("/start ")) {
        const refCode = text.split(" ")[1];
        if (refCode && /^[a-f0-9-]{36}$/i.test(refCode)) {
          const { data: referrer } = await supabase.from("users").select("id").eq("id", refCode).single();
          if (referrer) referrerId = referrer.id;
        }
      }
      const { data: newUser } = await supabase.from("users")
        .insert({ telegram_id: telegramId, username, referrer_id: referrerId })
        .select("*").single();
      user = newUser;
    } else if (username && username !== user.username) {
      await supabase.from("users").update({ username }).eq("id", user.id);
      user.username = username;
    }

    // Log + flood check
    await supabase.from("logs_activity").insert({ user_id: user.id, action: "bot_msg" });
    if (await isFlooding(supabase, user.id)) {
      await supabase.from("admin_alerts").insert({
        type: "flood",
        user_id: user.id,
        message: `Флуд: @${user.username || user.telegram_id} > 25 сообщений/мин — игнорируем`,
      });
      // silently drop
      return jsonResponse({ ok: true });
    }

    if (user.is_banned) {
      // Don't respond to banned users — saves Telegram from "spam" pattern
      return jsonResponse({ ok: true });
    }

    // Captcha block
    if (user.captcha_pending) {
      const userAnswer = parseInt(text.trim(), 10);
      if (!isNaN(userAnswer) && userAnswer === user.captcha_answer) {
        await supabase.from("users").update({ captcha_pending: null, captcha_answer: null }).eq("id", user.id);
        await sendTg(botToken, { chat_id: chatId, text: vary("✅ Капча пройдена. Доступ восстановлен.") });
        await sendMainInline(chatId, botToken, { ...user, captcha_pending: null }, supabaseUrl);
        return jsonResponse({ ok: true });
      } else {
        const parts = user.captcha_pending.split("+");
        const newCount = (user.captcha_count || 0) + 1;
        await supabase.from("users").update({ captcha_count: newCount }).eq("id", user.id);
        if (newCount >= 3) {
          await supabase.from("admin_alerts").insert({
            type: "fraud",
            user_id: user.id,
            message: `❗ Юзер @${user.username || user.telegram_id} провалил капчу ${newCount} раз`,
          });
          await sendTg(botToken, { chat_id: parseInt(groupId), text: `🚨 Подозрительный юзер @${user.username || user.telegram_id} — провал капчи ${newCount}×` });
        }
        await sendTg(botToken, { chat_id: chatId, text: `🔒 Решите пример: *${parts[0]} + ${parts[1]} = ?*\nОтправьте число.`, parse_mode: "Markdown" });
        return jsonResponse({ ok: true });
      }
    }

    if (text === "/start" || text.startsWith("/start ")) {
      await sendMainInline(chatId, botToken, user, supabaseUrl);
      return jsonResponse({ ok: true });
    }

    await sendMainInline(chatId, botToken, user, supabaseUrl);
  }

  if (callback) {
    await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callback.id }),
    });

    const chatId = callback.message.chat.id;
    const telegramId = callback.from.id;
    const cbData = (callback.data || "").slice(0, 120);

    const { data: user } = await supabase.from("users").select("*").eq("telegram_id", telegramId).single();
    if (!user || user.is_banned) return jsonResponse({ ok: true });
    if (user.captcha_pending) {
      await sendTg(botToken, { chat_id: chatId, text: "🔒 Сначала решите капчу!" });
      return jsonResponse({ ok: true });
    }

    if (cbData === "menu_daily") await handleDailyBonus(chatId, botToken, user, supabase);
    else if (cbData === "menu_tasks") await handleTasks(chatId, botToken, user, supabase);
    else if (cbData === "menu_profile") await handleProfile(chatId, botToken, user, supabase);
    else if (cbData === "menu_withdraw") await handleWithdraw(chatId, botToken, user, supabase);
    else if (cbData === "menu_referrals") await handleReferrals(chatId, botToken, user);
    else if (cbData.startsWith("task_")) await handleTaskComplete(chatId, botToken, user, cbData.slice(5), supabase, botToken);
    else if (cbData.startsWith("withdraw_")) await processWithdraw(chatId, botToken, user, parseInt(cbData.slice(9)), supabase, groupId);
  }

  return jsonResponse({ ok: true });
}

async function sendMainInline(chatId: number, botToken: string, user: any, supabaseUrl: string) {
  const webAppUrl = `https://id-preview--13572394-3347-4564-a651-8996fe1cafa4.lovable.app/app?user_id=${user.telegram_id}`;
  const text = vary(`💎 Баланс: *${Number(user.balance_pt).toFixed(1)} PT*\n\nВыберите действие:`);
  const keyboard = [
    [{ text: "🎁 Ежедневный бонус", callback_data: "menu_daily" }],
    [{ text: "🎬 Смотреть видео", web_app: { url: webAppUrl } }],
    [{ text: "📋 Задания", callback_data: "menu_tasks" }],
    [
      { text: "👤 Профиль", callback_data: "menu_profile" },
      { text: "👥 Рефералы", callback_data: "menu_referrals" },
    ],
    [{ text: "⭐ Вывод", callback_data: "menu_withdraw" }],
  ];
  await sendTg(botToken, { chat_id: chatId, text, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } });
}

async function handleDailyBonus(chatId: number, botToken: string, user: any, supabase: any) {
  const now = new Date();
  if (user.daily_bonus_at) {
    const diff = now.getTime() - new Date(user.daily_bonus_at).getTime();
    if (diff < 86_400_000) {
      const h = Math.ceil((86_400_000 - diff) / 3_600_000);
      await sendTg(botToken, { chat_id: chatId, text: `⏰ Уже получено. Следующий через *${h} ч.*`, parse_mode: "Markdown" });
      return;
    }
  }
  const bonus = Math.round((1.5 + Math.random() * 1.5) * 10) / 10;
  const newBalance = Number(user.balance_pt) + bonus;
  await supabase.from("users").update({ balance_pt: newBalance, daily_bonus_at: now.toISOString() }).eq("id", user.id);
  await sendTg(botToken, { chat_id: chatId, text: `🎁 Бонус: *+${bonus} PT*\n💎 Баланс: *${newBalance.toFixed(1)} PT*`, parse_mode: "Markdown" });
}

async function handleTasks(chatId: number, botToken: string, user: any, supabase: any) {
  const { data: tasks } = await supabase.from("tasks").select("*").eq("is_active", true).neq("type", "video");
  const { data: completions } = await supabase.from("task_completions").select("task_id").eq("user_id", user.id);
  const completedIds = new Set((completions || []).map((c: any) => c.task_id));
  const available = (tasks || []).filter((t: any) => {
    if (completedIds.has(t.id)) return false;
    if (t.max_completions > 0 && t.current_completions >= t.max_completions) return false;
    return true;
  });
  if (available.length === 0) {
    await sendTg(botToken, { chat_id: chatId, text: "📋 Нет доступных заданий. Загляните позже!" });
    return;
  }
  const buttons: any[][] = [];
  available.forEach((t: any) => {
    let label = "";
    if (t.type === "subscribe") label = `📢 Подписка — ${t.reward_pt} PT`;
    else if (t.type === "view_post") label = `👁 Просмотр — ${t.reward_pt} PT`;
    else if (t.type === "reaction") label = `❤️ Реакция — ${t.reward_pt} PT`;
    if (label) buttons.push([{ text: label, callback_data: `task_${t.id}` }]);
  });
  await sendTg(botToken, { chat_id: chatId, text: `📋 Доступно заданий: *${available.length}*`, parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
}

async function handleProfile(chatId: number, botToken: string, user: any, supabase: any) {
  const [{ count: tasksCount }, { count: videosCount }, { count: referralsCount }] = await Promise.all([
    supabase.from("task_completions").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("video_views").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("rewarded", true),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("referrer_id", user.id),
  ]);
  const statusEmoji = user.is_suspicious ? "⚠️" : "✅";
  const frozenText = user.balance_frozen ? " (🧊)" : "";
  const text = `👤 *Профиль*\n\n🆔 \`${user.telegram_id}\`\n💎 Баланс: *${Number(user.balance_pt).toFixed(1)} PT*${frozenText}\n📋 Заданий: ${tasksCount || 0}\n🎬 Видео: ${videosCount || 0}\n👥 Рефералов: ${referralsCount || 0}\n${statusEmoji} ${user.is_suspicious ? "Под наблюдением" : "Активен"}`;
  await sendTg(botToken, { chat_id: chatId, text, parse_mode: "Markdown" });
}

async function handleReferrals(chatId: number, botToken: string, user: any) {
  const text = `👥 *Рефералы*\n\n🔗 Ваша ссылка:\n\`https://t.me/?start=${user.id}\``;
  await sendTg(botToken, { chat_id: chatId, text, parse_mode: "Markdown" });
}

async function handleWithdraw(chatId: number, botToken: string, user: any, supabase: any) {
  if (user.balance_frozen) { await sendTg(botToken, { chat_id: chatId, text: "🧊 Баланс заморожен." }); return; }
  const { data: settings } = await supabase.from("settings").select("value").eq("key", "exchange_rate").single();
  const rate = parseFloat(settings?.value || "1");
  const balance = Number(user.balance_pt);
  const minWithdraw = 100;
  if (balance < minWithdraw) {
    await sendTg(botToken, { chat_id: chatId, text: `⭐ Минимум: ${minWithdraw} PT\n💎 У вас: *${balance.toFixed(1)} PT*`, parse_mode: "Markdown" });
    return;
  }
  const stars = Math.floor(balance / rate);
  const text = `⭐ *Вывод*\n💎 ${balance.toFixed(1)} PT → ⭐ ${stars}\nКурс: 1⭐ = ${rate} PT`;
  const buttons: any[][] = [];
  if (balance >= 100) buttons.push([{ text: `100 PT → ${Math.floor(100/rate)}⭐`, callback_data: "withdraw_100" }]);
  if (balance >= 500) buttons.push([{ text: `500 PT → ${Math.floor(500/rate)}⭐`, callback_data: "withdraw_500" }]);
  if (balance >= 1000) buttons.push([{ text: `1000 PT → ${Math.floor(1000/rate)}⭐`, callback_data: "withdraw_1000" }]);
  buttons.push([{ text: `Всё (${balance.toFixed(0)} → ${stars}⭐)`, callback_data: `withdraw_${Math.floor(balance)}` }]);
  await sendTg(botToken, { chat_id: chatId, text, parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
}

async function processWithdraw(chatId: number, botToken: string, user: any, amountPt: number, supabase: any, groupId: string) {
  if (!Number.isFinite(amountPt) || amountPt <= 0) return;
  if (Number(user.balance_pt) < amountPt) { await sendTg(botToken, { chat_id: chatId, text: "❌ Недостаточно средств." }); return; }
  const { data: settings } = await supabase.from("settings").select("value").eq("key", "exchange_rate").single();
  const rate = parseFloat(settings?.value || "1");
  const amountStars = Math.floor(amountPt / rate);
  const { data: ips } = await supabase.from("user_ips").select("ip_address").eq("user_id", user.id).order("last_seen_at", { ascending: false }).limit(1);
  const userIp = ips?.[0]?.ip_address || "0.0.0.0";

  await supabase.from("withdrawals").insert({ user_id: user.id, amount_pt: amountPt, amount_stars: amountStars, ip_address: userIp, status: "pending" });
  await supabase.from("users").update({ balance_pt: Number(user.balance_pt) - amountPt }).eq("id", user.id);
  await supabase.from("logs_activity").insert({ user_id: user.id, action: "withdrawal_request", ip_address: userIp, metadata: { amount_pt: amountPt, amount_stars: amountStars } });

  await sendTg(botToken, { chat_id: chatId, text: `✅ Заявка: ${amountPt} PT → ${amountStars}⭐\nОжидайте обработки.` });

  // Antifraud alert when suspicious
  if (user.is_suspicious || (user.violation_count || 0) > 3) {
    await supabase.from("admin_alerts").insert({
      type: "fraud",
      user_id: user.id,
      message: `🚨 Вывод от подозрительного: @${user.username || user.telegram_id}, ${amountPt} PT`,
    });
  }

  const report = `📤 *Заявка на вывод*\n👤 @${user.username || user.telegram_id}\n🌐 ${userIp}\n💎 ${amountPt} PT → ⭐ ${amountStars}\n${user.is_suspicious ? "🚨 ПОДОЗРИТЕЛЬНЫЙ" : ""}`;
  await sendTg(botToken, { chat_id: parseInt(groupId), text: report, parse_mode: "Markdown" });
}

async function handleTaskComplete(chatId: number, botToken: string, user: any, taskId: string, supabase: any, _bt: string) {
  if (!/^[a-f0-9-]{36}$/i.test(taskId)) return;
  const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).eq("is_active", true).single();
  if (!task) { await sendTg(botToken, { chat_id: chatId, text: "❌ Задание не найдено." }); return; }
  if (task.max_completions > 0 && task.current_completions >= task.max_completions) {
    await sendTg(botToken, { chat_id: chatId, text: "❌ Лимит исчерпан." });
    return;
  }
  const { data: existing } = await supabase.from("task_completions").select("id").eq("user_id", user.id).eq("task_id", taskId).maybeSingle();
  if (existing) { await sendTg(botToken, { chat_id: chatId, text: "✅ Уже выполнено." }); return; }

  if (task.type === "subscribe" && task.channel_id) {
    const res = await fetch(`${TELEGRAM_API}${Deno.env.get("TELEGRAM_BOT_TOKEN")}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: task.channel_id, user_id: user.telegram_id }),
    });
    const memberData = await res.json().catch(() => ({}));
    const status = memberData?.result?.status;
    if (!status || status === "left" || status === "kicked") {
      const link = task.channel_username ? `https://t.me/${task.channel_username.replace("@", "")}` : "";
      await sendTg(botToken, { chat_id: chatId, text: `❌ Сначала подпишитесь${link ? `\n${link}` : ""}` });
      return;
    }
  }

  await supabase.from("task_completions").insert({ user_id: user.id, task_id: taskId });
  await supabase.from("users").update({ balance_pt: Number(user.balance_pt) + Number(task.reward_pt) }).eq("id", user.id);
  await supabase.from("tasks").update({ current_completions: (task.current_completions || 0) + 1 }).eq("id", task.id);

  if (task.type === "subscribe" || task.type === "reaction") {
    const holdDays = task.hold_days || 5;
    const checkAt = new Date(Date.now() + holdDays * 86_400_000).toISOString();
    await supabase.from("delayed_checks").insert({ user_id: user.id, task_id: taskId, check_at: checkAt });
  }

  await sendTg(botToken, { chat_id: chatId, text: `✅ +${task.reward_pt} PT` });
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
