import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Check, AlertTriangle, Bell, Info, ShieldAlert, MessageSquare, Ticket, Search, Clock, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";

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

export default function AlertsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("alerts");
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Promo logs
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [retention, setRetention] = useState<string>("3");

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

  useEffect(() => { fetchAlerts(); }, []);
  useEffect(() => {
    if (tab === "promo_logs") fetchLogs();
  }, [tab]);
  useEffect(() => {
    if (tab !== "promo_logs") return;
    const t = setTimeout(() => fetchLogs(), 300);
    return () => clearTimeout(t);
  }, [codeSearch, userSearch]);

  const markRead = async (id: string) => {
    await adminApi("mark_alert_read", { alert_id: id });
    fetchAlerts();
  };

  const changeRetention = async (v: string) => {
    setRetention(v);
    try {
      await adminApi("set_promo_retention", { days: Number(v) });
      toast.success(v === "0" ? "Автоочистка отключена" : `Хранить последние ${v} дн.`);
      fetchLogs();
    } catch (e: any) {
      toast.error(e.message);
    }
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
          <TabsTrigger value="promo_logs" className="rounded-lg gap-2">
            <Ticket className="h-4 w-4" />
            Логи промокодов
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

        <TabsContent value="promo_logs" className="mt-4 space-y-4">
          <div className="glass-card p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по промокоду..."
                  value={codeSearch}
                  onChange={(e) => setCodeSearch(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по @username..."
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
                      <SelectItem key={o.value} value={o.value}>Хранить: {o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Trash2 className="h-3 w-3" />
              {retention === "0"
                ? "Логи не удаляются автоматически"
                : `Логи старше ${retention} дн. удаляются автоматически`}
            </p>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : logs.length === 0 ? (
            <div className="glass-card p-12 text-center text-muted-foreground">
              <Ticket className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Активаций промокодов не найдено</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => {
                const name = l.users?.username ? `@${l.users.username}` : `ID ${l.users?.telegram_id ?? "?"}`;
                const code = l.promo_codes?.code || "—";
                return (
                  <div key={l.id} className="glass-card p-3 flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-brand-gold/10 text-brand-gold shrink-0">
                      <Ticket className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                      <span className="text-sm font-medium truncate">{name}</span>
                      <Badge variant="outline" className="rounded-lg font-mono text-xs w-fit">{code}</Badge>
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
