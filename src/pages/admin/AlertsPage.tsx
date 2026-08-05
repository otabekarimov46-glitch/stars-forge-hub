import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Check, AlertTriangle, Bell, Info, ShieldAlert, MessageSquare, Ticket, Search, Clock, Trash2,
  ScrollText, Film, Users as UsersIcon, Newspaper, Camera, Heart, ArrowUpRight, Download, RotateCcw, Gift, ArrowUp,
  Share2, CornerLeftUp, ArrowDown, Trophy, Percent, TrendingUp, UserPlus, Calendar, ExternalLink,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import * as XLSX from "xlsx";


const TYPE_ICONS: Record<string, any> = {
  suspicious_ip: ShieldAlert,
  force_captcha: ShieldAlert,
  balance_reset: AlertTriangle,
  admin_message: MessageSquare,
  subscription_check_fail: AlertTriangle,
  fraud: ShieldAlert,
  flood: AlertTriangle,
};

const TYPE_COLORS: Record<string, string> = {
  suspicious_ip: "bg-destructive/10 text-destructive",
  force_captcha: "bg-yellow-500/10 text-yellow-600",
  balance_reset: "bg-orange-500/10 text-orange-600",
  admin_message: "bg-brand-blue/10 text-brand-blue",
  subscription_check_fail: "bg-destructive/10 text-destructive",
  fraud: "bg-destructive/15 text-destructive",
  flood: "bg-orange-500/10 text-orange-600",
};

const RETENTION_OPTIONS = [
  { value: "0", label: "Не удалять" },
  { value: "1", label: "1 день" },
  { value: "3", label: "3 дня" },
  { value: "7", label: "7 дней" },
  { value: "14", label: "14 дней" },
  { value: "30", label: "30 дней" },
];

const COUNT_OPTIONS = [
  { value: "0", label: "Не ограничивать" },
  { value: "100", label: "Последние 100" },
  { value: "500", label: "Последние 500" },
  { value: "1000", label: "Последние 1000" },
  { value: "5000", label: "Последние 5 000" },
  { value: "10000", label: "Последние 10 000" },
];

type ActionType = "video" | "subscribe" | "view_post" | "view_story" | "reaction" | "survey" | "balance_reset" | "promo_reward" | "withdrawal_paid" | "withdrawal_rejected" | "referral_reward";


const ACTION_META: Record<ActionType, { label: string; short: string; icon: any; bar: string; badge: string; row: string; }> = {
  video:         { label: "Видеореклама",   short: "Видео",     icon: Film,       bar: "bg-brand-purple",       badge: "bg-brand-purple/10 text-brand-purple border-brand-purple/20", row: "bg-brand-purple/[0.04] hover:bg-brand-purple/[0.08]" },
  subscribe:     { label: "Подписка",       short: "Подписка",  icon: UsersIcon,  bar: "bg-brand-blue",         badge: "bg-brand-blue/10 text-brand-blue border-brand-blue/20",       row: "bg-brand-blue/[0.04] hover:bg-brand-blue/[0.08]" },
  view_post:     { label: "Просмотр поста", short: "Пост",      icon: Newspaper,  bar: "bg-brand-green",        badge: "bg-brand-green/10 text-brand-green border-brand-green/20",     row: "bg-brand-green/[0.04] hover:bg-brand-green/[0.08]" },
  view_story:    { label: "Просмотр истории", short: "История", icon: Camera,     bar: "bg-brand-gold",         badge: "bg-brand-gold/10 text-brand-gold border-brand-gold/20",       row: "bg-brand-gold/[0.04] hover:bg-brand-gold/[0.08]" },
  reaction:      { label: "Реакция",        short: "Реакция",   icon: Heart,      bar: "bg-pink-500",           badge: "bg-pink-500/10 text-pink-500 border-pink-500/20",             row: "bg-pink-500/[0.04] hover:bg-pink-500/[0.08]" },
  survey:        { label: "Опрос",          short: "Опрос",     icon: Heart,      bar: "bg-teal-500",           badge: "bg-teal-500/10 text-teal-500 border-teal-500/20",             row: "bg-teal-500/[0.04] hover:bg-teal-500/[0.08]" },
  balance_reset: { label: "Обнуление баланса", short: "Обнуление", icon: RotateCcw, bar: "bg-orange-500",       badge: "bg-orange-500/10 text-orange-500 border-orange-500/20",       row: "bg-orange-500/[0.05] hover:bg-orange-500/[0.10]" },
  promo_reward:  { label: "Промокод",       short: "Промо",     icon: Gift,       bar: "bg-yellow-400",         badge: "bg-yellow-400/15 text-yellow-500 border-yellow-400/30",       row: "bg-yellow-400/[0.06] hover:bg-yellow-400/[0.12]" },
  withdrawal_paid:     { label: "Вывод выполнен",  short: "Вывод", icon: ArrowUp, bar: "bg-emerald-500",        badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",    row: "bg-emerald-500/[0.05] hover:bg-emerald-500/[0.10]" },
  withdrawal_rejected: { label: "Вывод отменён",   short: "Вывод", icon: ArrowUp, bar: "bg-emerald-600",        badge: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20",    row: "bg-emerald-600/[0.05] hover:bg-emerald-600/[0.10]" },
  referral_reward:     { label: "Рефералка",       short: "Рефералка", icon: Share2, bar: "bg-indigo-500",      badge: "bg-indigo-500/10 text-indigo-500 border-indigo-500/25",       row: "bg-indigo-500/[0.05] hover:bg-indigo-500/[0.10]" },
};

const FILTERABLE: ActionType[] = ["video", "subscribe", "view_post", "view_story", "promo_reward", "referral_reward", "balance_reset", "withdrawal_paid", "withdrawal_rejected"];


export default function AlertsPage() {
  const { t, tr } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState("alerts");
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Promo logs
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [retention, setRetention] = useState<string>("3");

  // Activity logs
  const [aLogs, setALogs] = useState<any[]>([]);
  const [aLoading, setALoading] = useState(false);
  const [aIdSearch, setAIdSearch] = useState("");
  const [aUserSearch, setAUserSearch] = useState("");
  const [aTypes, setATypes] = useState<Set<ActionType>>(new Set());
  const [aRetDays, setARetDays] = useState<string>("0");
  const [aRetCount, setARetCount] = useState<string>("0");
  const logRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Referral logs
  const [refData, setRefData] = useState<any>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [refSearch, setRefSearch] = useState("");
  const [refOpen, setRefOpen] = useState<any>(null);

  const flashPair = (log: any) => {
    const ids = [log.id, log.ref_source_log_id].filter(Boolean) as string[];
    const target = logRowRefs.current[log.ref_source_log_id] || logRowRefs.current[log.id];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    ids.forEach((id) => {
      const el = logRowRefs.current[id];
      if (!el) return;
      el.classList.remove("anchor-pulse");
      // force reflow so the animation restarts on repeated clicks
      void el.offsetWidth;
      el.classList.add("anchor-pulse");
      setTimeout(() => el.classList.remove("anchor-pulse"), 2600);
    });
  };


  const fetchAlerts = async () => {
    try {
      const data = await adminApi("get_alerts");
      setAlerts(data || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const data = await adminApi("get_promo_logs", { code_search: codeSearch, user_search: userSearch });
      setLogs(data?.logs || []);
      if (data?.retention_days != null) setRetention(String(data.retention_days));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchActivityLogs = async () => {
    setALoading(true);
    try {
      const data = await adminApi("get_activity_logs", {
        q: aIdSearch.trim(),
        user: aUserSearch.trim(),
        types: Array.from(aTypes),
        limit: 300,
      });
      setALogs(data?.logs || []);
      if (data?.retention_days != null) setARetDays(String(data.retention_days));
      if (data?.retention_count != null) setARetCount(String(data.retention_count));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setALoading(false);
    }
  };

  const fetchReferralLogs = async () => {
    setRefLoading(true);
    try {
      const data = await adminApi("get_referral_logs", { user_search: refSearch.trim() });
      setRefData(data || { referrers: [] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefLoading(false);
    }
  };



  const exportActivityLogsXlsx = () => {
    if (!aLogs.length) return;
    const rows = aLogs.map((l) => {
      const meta = ACTION_META[(l.action_type as ActionType)] || ACTION_META.subscribe;
      const isVideo = l.action_type === "video";
      const isReset = l.action_type === "balance_reset";
      const isPromoRow = l.action_type === "promo_reward";
      const started = l.started_at ? parseISO(l.started_at) : null;
      const finished = l.finished_at ? parseISO(l.finished_at) : (l.created_at ? parseISO(l.created_at) : null);
      const reward = Number(l.reward_pt || 0);
      return {
        [tr("Пользователь")]: l.user_username ? `@${l.user_username}` : (l.user_telegram_id ? `ID ${l.user_telegram_id}` : "—"),
        "Telegram ID": l.user_telegram_id ?? "",
        [tr("Тип")]: tr(meta.label),
        [tr("ID задания")]: l.task_public_id ?? "",
        [tr("Название / Причина")]: l.task_title ?? "",
        [tr("Задание удалено")]: (l.task_deleted || l.video_deleted) ? tr("да") : tr("нет"),
        [tr("Промокод")]: isPromoRow ? (l.task_public_id ?? "") : "",
        [tr("Промо удалено")]: isPromoRow ? (l.promo_deleted ? tr("да") : tr("нет")) : "",
        [tr("Приглашённый")]: l.action_type === "referral_reward" ? (l.ref_from_username ? `@${l.ref_from_username}` : (l.ref_from_telegram_id ? `ID ${l.ref_from_telegram_id}` : "")) : "",
        [tr("Процент")]: l.action_type === "referral_reward" && l.ref_percent != null ? `${l.ref_percent}%` : "",

        [tr("Рекламодатель")]: l.advertiser_deleted ? tr("Удалён") : (l.advertiser_name ?? "—"),
        [tr("ID рекламодателя")]: l.advertiser_public_id ?? "",
        [tr("Начало просмотра")]: isVideo && started ? format(started, "yyyy-MM-dd HH:mm:ss") : "",
        [tr("Окончание просмотра")]: isVideo && finished ? format(finished, "yyyy-MM-dd HH:mm:ss") : "",
        [tr("Время")]: finished ? format(finished, "yyyy-MM-dd HH:mm:ss") : "",
        [isReset ? tr("Списание (PT)") : tr("Награда (PT)")]: reward,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 34 }, { wch: 14 },
      { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 10 },
      { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tr("Все логи"));
    XLSX.writeFile(wb, `activity-logs-${format(new Date(), "yyyy-MM-dd-HHmm")}.xlsx`);
  };

  useEffect(() => { fetchAlerts(); }, []);
  useEffect(() => {
    if (tab === "promo_logs") fetchLogs();
    if (tab === "activity") fetchActivityLogs();
    if (tab === "referral_logs") fetchReferralLogs();
  }, [tab]);
  useEffect(() => {
    if (tab !== "referral_logs") return;
    const h = setTimeout(() => fetchReferralLogs(), 300);
    return () => clearTimeout(h);
  }, [refSearch]);

  useEffect(() => {
    if (tab !== "promo_logs") return;
    const h = setTimeout(() => fetchLogs(), 300);
    return () => clearTimeout(h);
  }, [codeSearch, userSearch]);
  useEffect(() => {
    if (tab !== "activity") return;
    const h = setTimeout(() => fetchActivityLogs(), 300);
    return () => clearTimeout(h);
  }, [aIdSearch, aUserSearch, aTypes]);

  const markRead = async (id: string) => {
    await adminApi("mark_alert_read", { alert_id: id });
    fetchAlerts();
  };

  const changeRetention = async (v: string) => {
    setRetention(v);
    try {
      await adminApi("set_promo_retention", { days: Number(v) });
      toast.success(v === "0" ? tr("Автоочистка отключена") : `${tr("Хранить последние")} ${v} ${tr("дн.")}`);
      fetchLogs();
    } catch (e: any) { toast.error(e.message); }
  };

  const changeARetDays = async (v: string) => {
    setARetDays(v);
    try {
      await adminApi("set_activity_retention", { days: Number(v), count: Number(aRetCount) });
      toast.success(v === "0" ? tr("Автоочистка по дням отключена") : `${tr("Хранить последние")} ${v} ${tr("дн.")}`);
      fetchActivityLogs();
    } catch (e: any) { toast.error(e.message); }
  };
  const changeARetCount = async (v: string) => {
    setARetCount(v);
    try {
      await adminApi("set_activity_retention", { days: Number(aRetDays), count: Number(v) });
      toast.success(v === "0" ? tr("Лимит по количеству снят") : `${tr("Хранить последние")} ${v} ${tr("записей")}`);
      fetchActivityLogs();
    } catch (e: any) { toast.error(e.message); }
  };

  const toggleType = (t: ActionType) => {
    setATypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const openInContent = (publicId: string) => {
    if (!publicId) return;
    navigate(`/admin/content?focus=${encodeURIComponent(publicId)}`);
  };

  const openWithdrawalInUser = (log: any) => {
    if (!log?.user_id) return;
    const m = String(log.task_title || "").match(/№\s*(\d+)/);
    const wd = m ? m[1] : "";
    const params = new URLSearchParams({ focus: log.user_id, tab: "withdrawals" });
    if (wd) params.set("wd", wd);
    navigate(`/admin/users?${params.toString()}`);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  const unreadCount = alerts.filter(a => !a.is_read).length;

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="rounded-xl">
          <TabsTrigger value="alerts" className="rounded-lg gap-2">
            <Bell className="h-4 w-4" />
            {t("alerts.title")}
            {unreadCount > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-destructive/10 text-destructive border-destructive/20 rounded-md">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded-lg gap-2">
            <ScrollText className="h-4 w-4" />
            {tr("Все логи")}
          </TabsTrigger>
          <TabsTrigger value="promo_logs" className="rounded-lg gap-2">
            <Ticket className="h-4 w-4" />
            {tr("Логи промокодов")}
          </TabsTrigger>
          <TabsTrigger value="referral_logs" className="rounded-lg gap-2">
            <Share2 className="h-4 w-4" />
            {tr("Логи рефералов")}
          </TabsTrigger>
        </TabsList>


        <TabsContent value="alerts" className="mt-4 space-y-3">
          {alerts.length === 0 && (
            <div className="glass-card p-12 text-center text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>{t("alerts.noAlerts")}</p>
            </div>
          )}
          {alerts.map((a) => {
            const Icon = TYPE_ICONS[a.type] || Info;
            const colorClass = TYPE_COLORS[a.type] || "bg-muted text-muted-foreground";
            return (
              <div key={a.id} className={`glass-card p-4 flex items-start gap-4 transition-all ${a.is_read ? "bg-slate-500/5" : ""}`}>
                <div className={`p-2.5 rounded-xl shrink-0 ${a.is_read ? "bg-slate-500/15 text-slate-500 dark:text-slate-400" : colorClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`rounded-lg text-xs ${a.is_read ? "text-slate-500 dark:text-slate-400" : ""}`}>{a.type}</Badge>
                    <span className={`text-xs ${a.is_read ? "text-slate-500 dark:text-slate-400" : "text-muted-foreground"}`}>{format(parseISO(a.created_at), "dd.MM.yyyy HH:mm")}</span>
                  </div>
                  <p className={`text-sm ${a.is_read ? "text-slate-600 dark:text-slate-400" : ""}`}>{a.message}</p>
                </div>
                {!a.is_read && (
                  <Button variant="ghost" size="sm" className="rounded-xl shrink-0" onClick={() => markRead(a.id)}>
                    <Check className="h-4 w-4 mr-1" /> {t("common.read")}
                  </Button>
                )}
              </div>
            );
          })}
        </TabsContent>

        {/* ==================== ACTIVITY LOGS ==================== */}
        <TabsContent value="activity" className="mt-4 space-y-4">
          <div className="glass-card p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tr("Поиск по ID (v100000000, r100000000…)")}
                  value={aIdSearch}
                  onChange={(e) => setAIdSearch(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tr("Поиск по @username или telegram_id")}
                  value={aUserSearch}
                  onChange={(e) => setAUserSearch(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => setATypes(new Set())}
                className={`px-3 py-1.5 rounded-xl text-xs border transition-all press-soft ${aTypes.size === 0 ? "bg-primary/15 text-primary border-primary/30" : "bg-muted/40 border-transparent text-muted-foreground hover:bg-muted"}`}
              >
                {tr("Все")}
              </button>
              {FILTERABLE.map((k) => {
                const meta = ACTION_META[k];
                const Icon = meta.icon;
                const active = aTypes.has(k);
                return (
                  <button
                    key={k}
                    onClick={() => toggleType(k)}
                    className={`px-3 py-1.5 rounded-xl text-xs border flex items-center gap-1.5 transition-all press-soft ${active ? meta.badge : "bg-muted/40 border-transparent text-muted-foreground hover:bg-muted"}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {tr(meta.label)}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-border/50">
              <div className="flex items-center gap-2 flex-1">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select value={aRetDays} onValueChange={changeARetDays}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RETENTION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{tr("По дням")}: {tr(o.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 flex-1">
                <ScrollText className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select value={aRetCount} onValueChange={changeARetCount}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{tr("По кол-ву")}: {tr(o.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
              <p className="text-sm text-foreground/80 flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-muted-foreground shrink-0" />
                {aRetDays === "0" && aRetCount === "0"
                  ? <span><span className="font-semibold">{tr("Автоочистка отключена.")}</span> {tr("Логи хранятся без ограничений — ничего не удаляется автоматически.")}</span>
                  : <span><span className="font-semibold">{tr("Автоочистка включена:")}</span>{" "}
                      {aRetDays !== "0" && <>{tr("удаляются записи старше")} <span className="font-semibold text-foreground">{aRetDays} {tr("дн.")}</span></>}
                      {aRetDays !== "0" && aRetCount !== "0" && " · "}
                      {aRetCount !== "0" && <>{tr("хранятся только последние")} <span className="font-semibold text-foreground">{aRetCount}</span> {tr("записей")}</>}
                    </span>}
              </p>
              <Button
                onClick={exportActivityLogsXlsx}
                disabled={aLogs.length === 0}
                variant="outline"
                size="sm"
                className="rounded-xl gap-2 shrink-0"
              >
                <Download className="h-4 w-4" />
                {tr("Экспорт в CSV")} ({aLogs.length})
              </Button>
            </div>
          </div>

          {aLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : aLogs.length === 0 ? (
            <div className="glass-card p-12 text-center text-muted-foreground">
              <ScrollText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>{tr("Пока нет записей")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {aLogs.map((l) => {
                const meta = ACTION_META[(l.action_type as ActionType)] || ACTION_META.subscribe;
                const Icon = meta.icon;
                const name = l.user_username ? `@${l.user_username}` : `ID ${l.user_telegram_id ?? "?"}`;
                const isVideo = l.action_type === "video";
                const started = l.started_at ? parseISO(l.started_at) : null;
                const finished = l.finished_at ? parseISO(l.finished_at) : parseISO(l.created_at);
                const timeStr = isVideo && started
                  ? `${format(started, "HH:mm:ss")} — ${format(finished, "HH:mm:ss")} · ${format(finished, "dd.MM.yy")}`
                  : format(finished, "HH:mm:ss · dd.MM.yy");
                const isWithdrawal = l.action_type === "withdrawal_paid" || l.action_type === "withdrawal_rejected";
                const isPromo = l.action_type === "promo_reward";
                const isRef = l.action_type === "referral_reward";
                const invited = l.ref_from_username ? `@${l.ref_from_username}` : (l.ref_from_telegram_id ? `ID ${l.ref_from_telegram_id}` : "—");
                return (
                  <div
                    key={l.id}
                    ref={(el) => { logRowRefs.current[l.id] = el; }}
                    onClick={isWithdrawal ? () => openWithdrawalInUser(l) : undefined}
                    className={`glass-card p-3 flex items-stretch gap-3 relative overflow-hidden rounded-2xl ${meta.row} ${isWithdrawal ? "cursor-pointer" : ""} ${isRef ? "ring-1 ring-indigo-500/20 ml-0 md:ml-6" : ""}`}
                  >
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.bar}`} />
                    <div className={`p-2 rounded-xl ${meta.badge} shrink-0 self-center ml-1`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_auto] gap-2 md:items-center">
                      {/* user */}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{name}</div>
                        {l.user_telegram_id && (
                          <div className="text-[11px] text-muted-foreground font-mono">ID: {l.user_telegram_id}</div>
                        )}
                      </div>
                      {/* task / promo */}
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={`rounded-lg text-[10px] px-1.5 py-0 ${meta.badge}`}>{tr(meta.short)}</Badge>
                          {isRef && l.ref_percent != null && (
                            <Badge variant="outline" className="rounded-lg text-[10px] px-1.5 py-0 bg-indigo-500/10 text-indigo-500 border-indigo-500/25">
                              {l.ref_percent}%
                            </Badge>
                          )}

                          {isPromo ? (
                            <span
                              className={
                                "font-mono text-xs px-1.5 py-0.5 rounded-lg border " +
                                (l.promo_deleted
                                  ? "border-destructive/60 text-destructive bg-destructive/5"
                                  : "border-yellow-400/50 text-yellow-500 bg-yellow-400/10")
                              }
                            >
                              {l.task_public_id || "—"}
                            </span>
                          ) : l.task_public_id ? (
                            (l.video_deleted || l.task_deleted) ? (
                              <span
                                className="font-mono text-xs text-muted-foreground underline decoration-destructive decoration-2 underline-offset-2 cursor-help"
                                title={tr("Задание удалено")}
                              >
                                {l.task_public_id}
                              </span>
                            ) : (
                              <button
                                onClick={() => openInContent(l.task_public_id)}
                                className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                              >
                                {l.task_public_id}<ArrowUpRight className="h-3 w-3" />
                              </button>
                            )
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                        {isPromo && l.promo_deleted && (
                          <div className="text-[10px] uppercase tracking-wider text-destructive/80">{tr("Промо удалено")}</div>
                        )}
                        {isRef && (
                          <div className="text-xs text-muted-foreground truncate">
                            {tr("Приглашённый")}: <span className="text-foreground font-medium">{invited}</span>
                          </div>
                        )}
                        {l.task_title && (
                          <div className="text-xs text-muted-foreground truncate">{l.task_title}</div>
                        )}

                      </div>
                      {/* advertiser */}
                      <div className="min-w-0 flex flex-col gap-0.5">
                        {l.advertiser_deleted ? (
                          <>
                            <div className="text-xs text-muted-foreground">{tr("Рекламодатель удалён")}</div>
                            {l.advertiser_public_id && (
                              <span className="font-mono text-xs text-muted-foreground underline decoration-destructive decoration-2 underline-offset-2">
                                {l.advertiser_public_id}
                              </span>
                            )}
                          </>
                        ) : l.advertiser_public_id ? (
                          <>
                            <div className="text-xs truncate">
                              <span className="text-muted-foreground">advertiser: </span>
                              <span className="font-medium">{l.advertiser_name || "—"}</span>
                            </div>
                            <button
                              onClick={() => openInContent(l.advertiser_public_id)}
                              className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-0.5 w-fit"
                            >
                              {l.advertiser_public_id}<ArrowUpRight className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                      {/* time */}
                      <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">{timeStr}</div>
                      {/* reward */}
                      <div className={`text-sm font-semibold whitespace-nowrap ${isWithdrawal ? "text-emerald-500" : Number(l.reward_pt) < 0 ? "text-orange-500" : "text-brand-gold"}`}>
                        {Number(l.reward_pt) < 0 ? "" : "+"}{Number(l.reward_pt).toFixed(2).replace(/\.?0+$/, "")} PT
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="promo_logs" className="mt-4 space-y-4">
          <div className="glass-card p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tr("Поиск по промокоду...")}
                  value={codeSearch}
                  onChange={(e) => setCodeSearch(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tr("Поиск по @username...")}
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select value={retention} onValueChange={changeRetention}>
                  <SelectTrigger className="w-[160px] rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{tr("Хранить")}: {tr(o.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Trash2 className="h-3 w-3" />
              {retention === "0"
                ? tr("Логи не удаляются автоматически")
                : `${tr("Логи старше")} ${retention} ${tr("дн. удаляются автоматически")}`}
            </p>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : logs.length === 0 ? (
            <div className="glass-card p-12 text-center text-muted-foreground">
              <Ticket className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>{tr("Активаций промокодов не найдено")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => {
                const name = l.users?.username ? `@${l.users.username}` : `ID ${l.users?.telegram_id ?? "?"}`;
                const code = l.code || l.promo_codes?.code || l.promo_code || "—";
                const deleted = !!l.promo_deleted || (!l.promo_id || !l.promo_codes);
                return (
                  <div key={l.id} className={"glass-card p-3 flex items-center gap-3 " + (deleted ? "ring-1 ring-destructive/25" : "")}>
                    <div className={"p-2 rounded-xl shrink-0 " + (deleted ? "bg-destructive/10 text-destructive" : "bg-brand-gold/10 text-brand-gold")}>
                      <Ticket className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                      <span className="text-sm font-medium truncate">{name}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className={"rounded-lg font-mono text-xs w-fit " + (deleted ? "border-destructive/60 text-destructive bg-destructive/5" : "")}
                        >
                          {code}
                        </Badge>
                        {deleted && (
                          <span className="text-[10px] uppercase tracking-wider text-destructive/80">{tr("промокод удалён")}</span>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-brand-gold">
                        +{Number(l.reward_pt).toFixed(2).replace(/\.?0+$/, "")} PT
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(l.redeemed_at), "dd.MM.yyyy HH:mm:ss")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
