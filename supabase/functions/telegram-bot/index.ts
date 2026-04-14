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

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();

    if (body.update_id !== undefined) {
      return await handleUpdate(body, supabase, BOT_TOKEN, GROUP_ID, SUPABASE_URL);
    }

    if (body.action === "set_webhook") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
      });
      return jsonResponse({ data: await res.json() });
    }

    if (body.action === "delete_webhook") {
      const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/deleteWebhook`);
      return jsonResponse({ data: await res.json() });
    }

    return jsonResponse({ error: "Unknown request" }, 400);
  } catch (err) {
    console.error("Bot error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});

async function handleUpdate(update: any, supabase: any, botToken: string, groupId: string, supabaseUrl: string) {
  const message = update.message;
  const callback = update.callback_query;

  if (message) {
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    const text = message.text || "";
    const username = message.from.username || null;

    // Get or create user
    let { data: user } = await supabase.from("users").select("*").eq("telegram_id", telegramId).single();

    if (!user) {
      let referrerId = null;
      if (text.startsWith("/start ")) {
        const refCode = text.split(" ")[1];
        if (refCode) {
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

    // Captcha block
    if (user.captcha_pending) {
      const userAnswer = parseInt(text.trim(), 10);
      if (!isNaN(userAnswer) && userAnswer === user.captcha_answer) {
        await supabase.from("users").update({ captcha_pending: null, captcha_answer: null }).eq("id", user.id);
        await sendText(chatId, botToken, "✅ Капча пройдена! Доступ восстановлен.");
        await sendMainInline(chatId, botToken, { ...user, captcha_pending: null }, supabaseUrl);
        return jsonResponse({ ok: true });
      } else {
        const parts = user.captcha_pending.split("+");
        await sendText(chatId, botToken, `🔒 *Сначала решите капчу!*\n\n*${parts[0]} + ${parts[1]} = ?*\n\nОтправьте ответ числом.`);
        return jsonResponse({ ok: true });
      }
    }

    if (text === "/start" || text.startsWith("/start ")) {
      await sendMainInline(chatId, botToken, user, supabaseUrl);
      return jsonResponse({ ok: true });
    }

    // Any other text — show main menu
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
    const cbData = callback.data;

    const { data: user } = await supabase.from("users").select("*").eq("telegram_id", telegramId).single();
    if (!user) return jsonResponse({ ok: true });

    if (user.captcha_pending) {
      await sendText(chatId, botToken, "🔒 Сначала решите капчу!");
      return jsonResponse({ ok: true });
    }

    if (cbData === "menu_daily") {
      await handleDailyBonus(chatId, botToken, user, supabase);
    } else if (cbData === "menu_tasks") {
      await handleTasks(chatId, botToken, user, supabase);
    } else if (cbData === "menu_profile") {
      await handleProfile(chatId, botToken, user, supabase);
    } else if (cbData === "menu_withdraw") {
      await handleWithdraw(chatId, botToken, user, supabase, groupId);
    } else if (cbData?.startsWith("task_")) {
      const taskId = cbData.replace("task_", "");
      await handleTaskComplete(chatId, botToken, user, taskId, supabase);
    } else if (cbData?.startsWith("withdraw_")) {
      const amount = parseInt(cbData.replace("withdraw_", ""));
      await processWithdraw(chatId, botToken, user, amount, supabase, groupId);
    } else if (cbData === "menu_referrals") {
      await handleReferrals(chatId, botToken, user, supabase);
    }
  }

  return jsonResponse({ ok: true });
}

async function sendMainInline(chatId: number, botToken: string, user: any, supabaseUrl: string) {
  if (user.is_banned) {
    await sendText(chatId, botToken, "⛔ Ваш аккаунт заблокирован.");
    return;
  }

  const webAppUrl = `https://id-preview--13572394-3347-4564-a651-8996fe1cafa4.lovable.app/app?user_id=${user.telegram_id}`;

  const text = `🎬 *Добро пожаловать в StarBot!*\n\n💎 Ваш баланс: *${user.balance_pt} PT*\n\nВыберите действие:`;

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

  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

async function handleDailyBonus(chatId: number, botToken: string, user: any, supabase: any) {
  const now = new Date();
  if (user.daily_bonus_at) {
    const last = new Date(user.daily_bonus_at);
    const diff = now.getTime() - last.getTime();
    if (diff < 24 * 60 * 60 * 1000) {
      const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - diff) / (60 * 60 * 1000));
      await sendText(chatId, botToken, `⏰ Ежедневный бонус уже получен.\n\nСледующий через *${hoursLeft} ч.*`);
      return;
    }
  }

  // Random 1.5 - 3.0 PT
  const bonus = Math.round((1.5 + Math.random() * 1.5) * 10) / 10;
  const newBalance = Number(user.balance_pt) + bonus;

  await supabase.from("users").update({ balance_pt: newBalance, daily_bonus_at: now.toISOString() }).eq("id", user.id);

  await sendText(chatId, botToken, `🎁 *Ежедневный бонус!*\n\nВам начислено *${bonus} PT*\n💎 Баланс: *${newBalance.toFixed(1)} PT*`);
}

async function handleTasks(chatId: number, botToken: string, user: any, supabase: any) {
  // Get active tasks (non-video, since video is in Mini App)
  const { data: tasks } = await supabase.from("tasks").select("*").eq("is_active", true).neq("type", "video");
  const { data: completions } = await supabase.from("task_completions").select("task_id").eq("user_id", user.id);
  const completedIds = new Set((completions || []).map((c: any) => c.task_id));

  // Filter: remove completed, remove tasks at max completions
  const available = (tasks || []).filter((t: any) => {
    if (completedIds.has(t.id)) return false;
    if (t.max_completions > 0 && t.current_completions >= t.max_completions) return false;
    return true;
  });

  if (available.length === 0) {
    await sendText(chatId, botToken, "📋 *Задания*\n\nНет доступных заданий. Попробуйте позже!");
    return;
  }

  const buttons: any[][] = [];
  available.forEach((t: any) => {
    let label = "";
    if (t.type === "subscribe") label = `📢 Подписка: ${t.channel_username || "канал"} — ${t.reward_pt} PT`;
    else if (t.type === "view_post") label = `👁 Просмотр поста — ${t.reward_pt} PT`;
    else if (t.type === "reaction") label = `❤️ Реакция — ${t.reward_pt} PT`;
    if (label) buttons.push([{ text: label, callback_data: `task_${t.id}` }]);
  });

  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `📋 *Доступные задания (${available.length}):*`,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    }),
  });
}

async function handleProfile(chatId: number, botToken: string, user: any, supabase: any) {
  const { count: tasksCount } = await supabase.from("task_completions").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  const { count: videosCount } = await supabase.from("video_views").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("rewarded", true);
  const { count: referralsCount } = await supabase.from("users").select("id", { count: "exact", head: true }).eq("referrer_id", user.id);

  const statusEmoji = user.is_banned ? "⛔" : user.is_suspicious ? "⚠️" : "✅";
  const frozenText = user.balance_frozen ? " (🧊 заморожен)" : "";

  const text = `👤 *Ваш профиль*\n\n` +
    `🆔 ID: \`${user.telegram_id}\`\n` +
    `👤 Username: @${user.username || "нет"}\n` +
    `💎 Баланс: *${user.balance_pt} PT*${frozenText}\n` +
    `📋 Заданий: ${tasksCount || 0}\n` +
    `🎬 Видео: ${videosCount || 0}\n` +
    `👥 Рефералов: ${referralsCount || 0}\n` +
    `${statusEmoji} Статус: ${user.is_banned ? "Заблокирован" : user.is_suspicious ? "Под наблюдением" : "Активен"}\n` +
    `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString("ru-RU")}`;

  await sendText(chatId, botToken, text);
}

async function handleReferrals(chatId: number, botToken: string, user: any, supabase: any) {
  const { data: referrals, count } = await supabase
    .from("users")
    .select("username, telegram_id, created_at", { count: "exact" })
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const refLink = `https://t.me/YOUR_BOT_USERNAME?start=${user.id}`;

  let text = `👥 *Реферальная программа*\n\n🔗 Ваша ссылка:\n\`${refLink}\`\n\nВсего рефералов: *${count || 0}*\n`;

  if (referrals && referrals.length > 0) {
    text += `\nПоследние:\n`;
    referrals.forEach((r: any) => {
      text += `• @${r.username || r.telegram_id} (${new Date(r.created_at).toLocaleDateString("ru-RU")})\n`;
    });
  }

  await sendText(chatId, botToken, text);
}

async function handleWithdraw(chatId: number, botToken: string, user: any, supabase: any, groupId: string) {
  if (user.is_banned) { await sendText(chatId, botToken, "⛔ Ваш аккаунт заблокирован."); return; }
  if (user.balance_frozen) { await sendText(chatId, botToken, "🧊 Ваш баланс заморожен."); return; }

  const { data: settings } = await supabase.from("settings").select("value").eq("key", "exchange_rate").single();
  const rate = parseFloat(settings?.value || "1");
  const balance = Number(user.balance_pt);
  const minWithdraw = 100;

  if (balance < minWithdraw) {
    await sendText(chatId, botToken, `⭐ *Вывод Stars*\n\n💎 Баланс: *${balance} PT*\n⭐ Курс: 1 Star = ${rate} PT\n\n❌ Минимум: ${minWithdraw} PT`);
    return;
  }

  const starsAmount = Math.floor(balance / rate);
  const text = `⭐ *Вывод Stars*\n\n💎 Баланс: *${balance} PT*\n⭐ Курс: 1 Star = ${rate} PT\n⭐ Получите: *${starsAmount} Stars*\n\nВыберите сумму:`;

  const buttons: any[][] = [];
  if (balance >= 100) buttons.push([{ text: `100 PT → ${Math.floor(100/rate)} ⭐`, callback_data: "withdraw_100" }]);
  if (balance >= 500) buttons.push([{ text: `500 PT → ${Math.floor(500/rate)} ⭐`, callback_data: "withdraw_500" }]);
  if (balance >= 1000) buttons.push([{ text: `1000 PT → ${Math.floor(1000/rate)} ⭐`, callback_data: "withdraw_1000" }]);
  buttons.push([{ text: `Всё (${balance} PT → ${starsAmount} ⭐)`, callback_data: `withdraw_${balance}` }]);

  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }),
  });
}

async function processWithdraw(chatId: number, botToken: string, user: any, amountPt: number, supabase: any, groupId: string) {
  if (user.balance_pt < amountPt) { await sendText(chatId, botToken, "❌ Недостаточно средств."); return; }

  const { data: settings } = await supabase.from("settings").select("value").eq("key", "exchange_rate").single();
  const rate = parseFloat(settings?.value || "1");
  const amountStars = Math.floor(amountPt / rate);

  const { data: ips } = await supabase.from("user_ips").select("ip_address").eq("user_id", user.id).order("last_seen_at", { ascending: false }).limit(1);
  const userIp = ips?.[0]?.ip_address || "unknown";

  await supabase.from("withdrawals").insert({ user_id: user.id, amount_pt: amountPt, amount_stars: amountStars, ip_address: userIp, status: "pending" });
  await supabase.from("users").update({ balance_pt: user.balance_pt - amountPt }).eq("id", user.id);
  await supabase.from("logs_activity").insert({ user_id: user.id, action: "withdrawal_request", ip_address: userIp, metadata: { amount_pt: amountPt, amount_stars: amountStars } });

  await sendText(chatId, botToken, `✅ Заявка создана!\n\n💎 ${amountPt} PT → ⭐ ${amountStars} Stars\n\nОжидайте обработки.`);

  const report = `📤 *Новая заявка на вывод*\n\n👤 @${user.username || user.telegram_id}\n🌐 IP: ${userIp}\n💎 ${amountPt} PT → ⭐ ${amountStars} Stars\n⚠️ Нарушений: ${user.violation_count}\n${user.is_suspicious ? "🚨 ПОДОЗРИТЕЛЬНЫЙ" : ""}`;
  await sendText(parseInt(groupId), botToken, report);
}

async function handleTaskComplete(chatId: number, botToken: string, user: any, taskId: string, supabase: any) {
  const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).eq("is_active", true).single();
  if (!task) { await sendText(chatId, botToken, "❌ Задание не найдено или уже неактивно."); return; }

  // Check max completions
  if (task.max_completions > 0 && task.current_completions >= task.max_completions) {
    await sendText(chatId, botToken, "❌ Лимит выполнений задания исчерпан.");
    return;
  }

  const { data: existing } = await supabase.from("task_completions").select("id").eq("user_id", user.id).eq("task_id", taskId).single();
  if (existing) { await sendText(chatId, botToken, "✅ Уже выполнено."); return; }

  // For subscribe tasks, verify membership
  if (task.type === "subscribe" && task.channel_id) {
    try {
      const res = await fetch(`${TELEGRAM_API}${supabase.supabaseKey ? botToken : Deno.env.get("TELEGRAM_BOT_TOKEN")}/getChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: task.channel_id, user_id: user.telegram_id }),
      });
      const memberData = await res.json();
      const status = memberData?.result?.status;
      if (!status || status === "left" || status === "kicked") {
        const channelLink = task.channel_username ? `https://t.me/${task.channel_username.replace("@", "")}` : "";
        await sendText(chatId, botToken, `❌ Сначала подпишитесь на ${task.channel_username || "канал"}!\n\n${channelLink ? `👉 ${channelLink}` : ""}`);
        return;
      }
    } catch (e) {
      console.error("getChatMember error:", e);
    }
  }

  // For view_post — open post URL
  if (task.type === "view_post" && task.post_url) {
    // We trust click — user pressed the button
  }

  // Reward immediately
  await supabase.from("task_completions").insert({ user_id: user.id, task_id: taskId });
  await supabase.from("users").update({ balance_pt: Number(user.balance_pt) + Number(task.reward_pt) }).eq("id", user.id);

  // Increment completion counter
  await supabase.from("tasks").update({ current_completions: (task.current_completions || 0) + 1 }).eq("id", task.id);

  // Schedule hold check for subscribe/reaction (configurable days)
  if (task.type === "subscribe" || task.type === "reaction") {
    const holdDays = task.hold_days || 5;
    const checkAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("delayed_checks").insert({ user_id: user.id, task_id: taskId, check_at: checkAt });
  }

  await sendText(chatId, botToken, `✅ Задание выполнено! Начислено *${task.reward_pt} PT*`);
}

async function sendText(chatId: number, botToken: string, text: string) {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
