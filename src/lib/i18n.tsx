import { createContext, useContext, useState, ReactNode } from "react";

export type Lang = "ru" | "en";

const translations = {
  // Sidebar
  "nav.content": { ru: "Контент", en: "Content" },
  "nav.statistics": { ru: "Статистика", en: "Statistics" },
  "nav.users": { ru: "Пользователи", en: "Users" },
  "nav.alerts": { ru: "Алерты", en: "Alerts" },
  "nav.settings": { ru: "Настройки", en: "Settings" },
  "nav.title": { ru: "Админ-панель", en: "Admin Panel" },

  // Common
  "common.loading": { ru: "Загрузка...", en: "Loading..." },
  "common.save": { ru: "Сохранить", en: "Save" },
  "common.delete": { ru: "Удалить", en: "Delete" },
  "common.add": { ru: "Добавить", en: "Add" },
  "common.create": { ru: "Создать", en: "Create" },
  "common.cancel": { ru: "Отмена", en: "Cancel" },
  "common.search": { ru: "Поиск...", en: "Search..." },
  "common.active": { ru: "Активно", en: "Active" },
  "common.inactive": { ru: "Неактивно", en: "Inactive" },
  "common.reward": { ru: "Награда", en: "Reward" },
  "common.type": { ru: "Тип", en: "Type" },
  "common.actions": { ru: "Действия", en: "Actions" },
  "common.of": { ru: "из", en: "of" },
  "common.noData": { ru: "Нет данных", en: "No data" },
  "common.error": { ru: "Ошибка", en: "Error" },
  "common.success": { ru: "Успешно", en: "Success" },
  "common.read": { ru: "Прочитано", en: "Read" },
  "common.send": { ru: "Отправить", en: "Send" },
  "common.close": { ru: "Закрыть", en: "Close" },

  // Task types
  "task.subscribe": { ru: "Подписка", en: "Subscribe" },
  "task.video": { ru: "Видео", en: "Video" },
  "task.view_post": { ru: "Просмотр поста", en: "View Post" },
  "task.reaction": { ru: "Реакция", en: "Reaction" },

  // Content page
  "content.tasks": { ru: "Задания", en: "Tasks" },
  "content.videoAds": { ru: "Видеоролики", en: "Video Ads" },
  "content.newTask": { ru: "Новое задание", en: "New Task" },
  "content.newVideo": { ru: "Новое видео", en: "New Video" },
  "content.channelUsername": { ru: "@username канала", en: "Channel @username" },
  "content.channelId": { ru: "Channel ID", en: "Channel ID" },
  "content.postUrl": { ru: "Ссылка на пост", en: "Post URL" },
  "content.reactionEmoji": { ru: "Эмодзи реакции", en: "Reaction emoji" },
  "content.videoTitle": { ru: "Название", en: "Title" },
  "content.videoUrl": { ru: "URL видео", en: "Video URL" },
  "content.uploadVideo": { ru: "Загрузить видео", en: "Upload video" },
  "content.duration": { ru: "Длительность (сек)", en: "Duration (sec)" },
  "content.channel": { ru: "Канал", en: "Channel" },
  "content.noTasks": { ru: "Нет заданий", en: "No tasks" },
  "content.noVideos": { ru: "Нет видео", en: "No videos" },
  "content.taskCreated": { ru: "Задание создано", en: "Task created" },
  "content.videoAdded": { ru: "Видео добавлено", en: "Video added" },
  "content.deleted": { ru: "Удалено", en: "Deleted" },

  // Users page
  "users.title": { ru: "Пользователи", en: "Users" },
  "users.telegramId": { ru: "Telegram ID", en: "Telegram ID" },
  "users.username": { ru: "Username", en: "Username" },
  "users.balance": { ru: "Баланс", en: "Balance" },
  "users.ip": { ru: "IP", en: "IP" },
  "users.status": { ru: "Статус", en: "Status" },
  "users.violations": { ru: "Нарушения", en: "Violations" },
  "users.captchas": { ru: "Капчи", en: "Captchas" },
  "users.ban": { ru: "Забанить", en: "Ban" },
  "users.unban": { ru: "Разбанить", en: "Unban" },
  "users.freeze": { ru: "Заморозить баланс", en: "Freeze balance" },
  "users.unfreeze": { ru: "Разморозить", en: "Unfreeze" },
  "users.captcha": { ru: "Назначить капчу", en: "Assign captcha" },
  "users.resetBalance": { ru: "Сбросить баланс", en: "Reset balance" },
  "users.message": { ru: "Написать", en: "Message" },
  "users.banned": { ru: "Забанен", en: "Banned" },
  "users.unbanned": { ru: "Разбанен", en: "Unbanned" },
  "users.frozen": { ru: "Баланс заморожен", en: "Balance frozen" },
  "users.unfrozen": { ru: "Баланс разморожен", en: "Balance unfrozen" },
  "users.captchaAssigned": { ru: "Капча назначена", en: "Captcha assigned" },
  "users.balanceReset": { ru: "Баланс сброшен", en: "Balance reset" },
  "users.messageSent": { ru: "Сообщение отправлено", en: "Message sent" },
  "users.confirmReset": { ru: "Сбросить баланс пользователя до 0?", en: "Reset user balance to 0?" },
  "users.messageTitle": { ru: "Сообщение пользователю", en: "Message to user" },
  "users.messageText": { ru: "Текст сообщения", en: "Message text" },
  "users.messagePlaceholder": { ru: "Введите сообщение...", en: "Enter message..." },
  "users.notFound": { ru: "Пользователи не найдены", en: "No users found" },
  "users.searchPlaceholder": { ru: "Поиск по ID, Telegram ID, username...", en: "Search by ID, Telegram ID, username..." },

  // Statistics
  "stats.totalUsers": { ru: "Пользователей", en: "Users" },
  "stats.suspicious": { ru: "Подозрительных", en: "Suspicious" },
  "stats.totalBalance": { ru: "Суммарный баланс", en: "Total Balance" },
  "stats.videoViews": { ru: "Просмотров видео", en: "Video Views" },
  "stats.pendingWithdrawals": { ru: "Выводов в ожидании", en: "Pending Withdrawals" },
  "stats.registrations": { ru: "Регистрации (14 дней)", en: "Registrations (14 days)" },
  "stats.withdrawalsByStatus": { ru: "Выводы по статусу", en: "Withdrawals by Status" },
  "stats.pending": { ru: "Ожидают", en: "Pending" },
  "stats.approved": { ru: "Одобрены", en: "Approved" },
  "stats.rejected": { ru: "Отклонены", en: "Rejected" },
  "stats.unreadAlerts": { ru: "Непрочитанные алерты", en: "Unread Alerts" },

  // Alerts
  "alerts.title": { ru: "Алерты", en: "Alerts" },
  "alerts.unread": { ru: "непрочитанных", en: "unread" },
  "alerts.noAlerts": { ru: "Нет алертов", en: "No alerts" },

  // Settings
  "settings.exchangeRate": { ru: "Курс обмена", en: "Exchange Rate" },
  "settings.exchangeLabel": { ru: "EXCHANGE_RATE (1 PT = X ⭐)", en: "EXCHANGE_RATE (1 PT = X ⭐)" },
  "settings.saved": { ru: "сохранён", en: "saved" },
  "settings.theme": { ru: "Тема", en: "Theme" },
  "settings.light": { ru: "Светлая", en: "Light" },
  "settings.dark": { ru: "Тёмная", en: "Dark" },
  "settings.language": { ru: "Язык", en: "Language" },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: "ru",
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem("app-lang");
    return (saved === "en" ? "en" : "ru") as Lang;
  });

  const changeLang = (newLang: Lang) => {
    setLang(newLang);
    localStorage.setItem("app-lang", newLang);
  };

  const t = (key: TranslationKey): string => {
    return translations[key]?.[lang] || key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang: changeLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
