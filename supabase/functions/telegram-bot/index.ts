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

  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const GROUP_ID = Deno.env.get("TELEGRAM_GROUP_ID")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const PROJECT_ID = SUPABASE_URL.replace("https://", "").split(".")[0];

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();

    // Handle webhook update from Telegram
    if (body.update_id !== undefined) {
      return await handleUpdate(body, supabase, BOT_TOKEN, GROUP_ID, PROJECT_ID);
    }

    // Handle manual action: set_webhook
    if (body.action === "set_webhook") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["message", "callback_query"],
        }),
      });
      const data = await res.json();
      return jsonResponse({ data });
    }

    // Handle manual action: delete_webhook
    if (body.action === "delete_webhook") {
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/deleteWebhook`);
      const data = await res.json();
      return jsonResponse({ data });
    }

    return jsonResponse({ error: "Unknown request" }, 400);
  } catch (err) {
    console.error("Bot error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});

async function handleUpdate(update: any, supabase: any, botToken: string, groupId: string, projectId: string) {
  const message = update.message;
  const callback = update.callback_query;

  if (message) {
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    const text = message.text || "";
    const username = message.from.username || null;

    // Get or create user
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (!user) {
      // Check for referral
      let referrerId = null;
      if (text.startsWith("/start ")) {
        const refCode = text.split(" ")[1];
        if (refCode) {
          const { data: referrer } = await supabase
            .from("users")
            .select("id")
            .eq("id", refCode)
            .single();
          if (referrer) referrerId = referrer.id;
        }
      }

      const { data: newUser } = await supabase
        .from("users")
        .insert({ telegram_id: telegramId, username, referrer_id: referrerId })
        .select("*")
        .single();
      user = newUser;
    } else {
      // Update username if changed
      if (username && username !== user.username) {
        await supabase.from("users").update({ username }).eq("id", user.id);
        user.username = username;
      }
    }

    if (text === "/start" || text.startsWith("/start ")) {
      await sendMainMenu(chatId, botToken, user);
      return jsonResponse({ ok: true });
    }

    if (text === "💰 Заработать") {
      await handleEarn(chatId, botToken, user, projectId);
      return jsonResponse({ ok: true });
    }

    if (text === "👤 Профиль") {
      await handleProfile(chatId, botToken, user, supabase);
      return jsonResponse({ ok: true });
    }

    if (text === "👥 Рефералы") {
      await handleReferrals(chatId, botToken, user, supabase);
      return jsonResponse({ ok: true });
    }

    if (text === "⭐ Вывод") {
      await handleWithdraw(chatId, botToken, user, supabase, groupId);
      return jsonResponse({ ok: true });
    }

    // Default: show main menu
    await sendMainMenu(chatId, botToken, user);
  }

  if (callback) {
    // Acknowledge callback
    await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callback.id }),
    });

    const chatId = callback.message.chat.id;
    const telegramId = callback.from.id;
    const data = callback.data;

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (!user) return jsonResponse({ ok: true });

    if (data?.startsWith("subscribe_")) {
      const taskId = data.replace("subscribe_", "");
      await handleTaskComplete(chatId, botToken, user, taskId, supabase);
    }

    if (data?.startsWith("withdraw_")) {
      const amount = parseInt(data.replace("withdraw_", ""));
      await processWithdraw(chatId, botToken, user, amount, supabase, groupId);
    }
  }

  return jsonResponse({ ok: true });
}

async function sendMainMenu(chatId: number, botToken: string, user: any) {
  const text = user.is_banned
    ? "⛔ Ваш аккаунт заблокирован."
    : `🎬 *Добро пожаловать!*\n\n💎 Ваш баланс: *${user.balance_pt} PT*\n\nВыберите действие:`;

  await sendMessage(chatId, botToken, text, {
    resize_keyboard: true,
    keyboard: [
      [{ text: "💰 Заработать" }, { text: "👤 Профиль" }],
      [{ text: "👥 Рефералы" }, { text: "⭐ Вывод" }],
    ],
  });
}

async function handleEarn(chatId: number, botToken: string, user: any, projectId: string) {
  if (user.is_banned) {
    await sendMessage(chatId, botToken, "⛔ Ваш аккаунт заблокирован.");
    return;
  }

  const miniAppUrl = `https://${projectId}.supabase.co/functions/v1/miniapp-api`;
  const webAppUrl = `https://id-preview--13572394-3347-4564-a651-8996fe1cafa4.lovable.app/app?user_id=${user.telegram_id}`;

  const text = `💰 *Способы заработка:*\n\n🎬 *Смотри видео* — открой Mini App и смотри рекламные ролики\n📢 *Подписки* — подпишись на каналы за PT`;

  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎬 Смотреть видео", web_app: { url: webAppUrl } }],
        ],
      },
    }),
  });
}

async function handleProfile(chatId: number, botToken: string, user: any, supabase: any) {
  const { count: tasksCount } = await supabase
    .from("task_completions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const { count: videosCount } = await supabase
    .from("video_views")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("rewarded", true);

  const { count: referralsCount } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", user.id);

  const statusEmoji = user.is_banned ? "⛔" : user.is_suspicious ? "⚠️" : "✅";
  const frozenText = user.balance_frozen ? " (🧊 заморожен)" : "";

  const text = `👤 *Ваш профиль*\n\n` +
    `🆔 ID: \`${user.telegram_id}\`\n` +
    `👤 Username: @${user.username || "нет"}\n` +
    `💎 Баланс: *${user.balance_pt} PT*${frozenText}\n` +
    `📋 Заданий выполнено: ${tasksCount || 0}\n` +
    `🎬 Видео просмотрено: ${videosCount || 0}\n` +
    `👥 Рефералов: ${referralsCount || 0}\n` +
    `${statusEmoji} Статус: ${user.is_banned ? "Заблокирован" : user.is_suspicious ? "Под наблюдением" : "Активен"}\n` +
    `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString("ru-RU")}`;

  await sendMessage(chatId, botToken, text);
}

async function handleReferrals(chatId: number, botToken: string, user: any, supabase: any) {
  const { data: referrals, count } = await supabase
    .from("users")
    .select("username, telegram_id, created_at", { count: "exact" })
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const refLink = `https://t.me/YOUR_BOT_USERNAME?start=${user.id}`;

  let text = `👥 *Реферальная программа*\n\n` +
    `🔗 Ваша ссылка:\n\`${refLink}\`\n\n` +
    `Всего рефералов: *${count || 0}*\n`;

  if (referrals && referrals.length > 0) {
    text += `\nПоследние:\n`;
    referrals.forEach((r: any) => {
      text += `• @${r.username || r.telegram_id} (${new Date(r.created_at).toLocaleDateString("ru-RU")})\n`;
    });
  }

  await sendMessage(chatId, botToken, text);
}

async function handleWithdraw(chatId: number, botToken: string, user: any, supabase: any, groupId: string) {
  if (user.is_banned) {
    await sendMessage(chatId, botToken, "⛔ Ваш аккаунт заблокирован.");
    return;
  }
  if (user.balance_frozen) {
    await sendMessage(chatId, botToken, "🧊 Ваш баланс заморожен. Вывод невозможен.");
    return;
  }

  // Get exchange rate
  const { data: settings } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "exchange_rate")
    .single();

  const rate = parseFloat(settings?.value || "1");
  const balance = user.balance_pt;
  const minWithdraw = 100;

  if (balance < minWithdraw) {
    await sendMessage(chatId, botToken, `⭐ *Вывод Stars*\n\n💎 Баланс: *${balance} PT*\n⭐ Курс: 1 Star = ${rate} PT\n\n❌ Минимум для вывода: ${minWithdraw} PT`);
    return;
  }

  const starsAmount = Math.floor(balance / rate);

  const text = `⭐ *Вывод Stars*\n\n💎 Баланс: *${balance} PT*\n⭐ Курс: 1 Star = ${rate} PT\n⭐ Вы получите: *${starsAmount} Stars*\n\nВыберите сумму:`;

  const buttons = [];
  if (balance >= 100) buttons.push([{ text: `100 PT → ${Math.floor(100/rate)} ⭐`, callback_data: "withdraw_100" }]);
  if (balance >= 500) buttons.push([{ text: `500 PT → ${Math.floor(500/rate)} ⭐`, callback_data: "withdraw_500" }]);
  if (balance >= 1000) buttons.push([{ text: `1000 PT → ${Math.floor(1000/rate)} ⭐`, callback_data: "withdraw_1000" }]);
  buttons.push([{ text: `Всё (${balance} PT → ${starsAmount} ⭐)`, callback_data: `withdraw_${balance}` }]);

  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    }),
  });
}

async function processWithdraw(chatId: number, botToken: string, user: any, amountPt: number, supabase: any, groupId: string) {
  if (user.balance_pt < amountPt) {
    await sendMessage(chatId, botToken, "❌ Недостаточно средств.");
    return;
  }

  const { data: settings } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "exchange_rate")
    .single();
  const rate = parseFloat(settings?.value || "1");
  const amountStars = Math.floor(amountPt / rate);

  // Get user IP
  const { data: ips } = await supabase
    .from("user_ips")
    .select("ip_address")
    .eq("user_id", user.id)
    .order("last_seen_at", { ascending: false })
    .limit(1);
  const userIp = ips?.[0]?.ip_address || "unknown";

  // Create withdrawal
  const { error } = await supabase.from("withdrawals").insert({
    user_id: user.id,
    amount_pt: amountPt,
    amount_stars: amountStars,
    ip_address: userIp,
    status: "pending",
  });
  if (error) throw error;

  // Deduct balance
  await supabase
    .from("users")
    .update({ balance_pt: user.balance_pt - amountPt })
    .eq("id", user.id);

  // Log
  await supabase.from("logs_activity").insert({
    user_id: user.id,
    action: "withdrawal_request",
    ip_address: userIp,
    metadata: { amount_pt: amountPt, amount_stars: amountStars },
  });

  // Notify user
  await sendMessage(chatId, botToken, `✅ Заявка на вывод создана!\n\n💎 ${amountPt} PT → ⭐ ${amountStars} Stars\n\nОжидайте обработки.`);

  // Send report to monitoring group
  const report = `📤 *Новая заявка на вывод*\n\n` +
    `👤 @${user.username || user.telegram_id} (ID: ${user.telegram_id})\n` +
    `🌐 IP: ${userIp}\n` +
    `💎 Сумма: ${amountPt} PT → ⭐ ${amountStars} Stars\n` +
    `⚠️ Нарушений: ${user.violation_count}\n` +
    `🔒 Капч: ${user.captcha_count}\n` +
    `${user.is_suspicious ? "🚨 ПОДОЗРИТЕЛЬНЫЙ АККАУНТ" : ""}`;

  await sendMessage(parseInt(groupId), botToken, report);
}

async function handleTaskComplete(chatId: number, botToken: string, user: any, taskId: string, supabase: any) {
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("is_active", true)
    .single();

  if (!task) {
    await sendMessage(chatId, botToken, "❌ Задание не найдено или неактивно.");
    return;
  }

  // Check if already completed
  const { data: existing } = await supabase
    .from("task_completions")
    .select("id")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .single();

  if (existing) {
    await sendMessage(chatId, botToken, "✅ Вы уже выполнили это задание.");
    return;
  }

  // TODO: verify subscription via Bot API getChatMember
  // For now, mark as complete and reward

  await supabase.from("task_completions").insert({
    user_id: user.id,
    task_id: taskId,
  });

  await supabase
    .from("users")
    .update({ balance_pt: user.balance_pt + task.reward_pt })
    .eq("id", user.id);

  await sendMessage(chatId, botToken, `✅ Задание выполнено! Начислено *${task.reward_pt} PT*`);
}

async function sendMessage(chatId: number, botToken: string, text: string, replyMarkup?: any) {
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
