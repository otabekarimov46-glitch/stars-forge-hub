import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, AlertTriangle, Bell, Info, ShieldAlert, MessageSquare } from "lucide-react";
import { format, parseISO } from "date-fns";

const TYPE_ICONS: Record<string, any> = {
  suspicious_ip: ShieldAlert,
  force_captcha: ShieldAlert,
  balance_reset: AlertTriangle,
  balance_adjust: AlertTriangle,
  admin_message: MessageSquare,
  subscription_check_fail: AlertTriangle,
};

const TYPE_COLORS: Record<string, string> = {
  suspicious_ip: "bg-destructive/10 text-destructive",
  force_captcha: "bg-yellow-500/10 text-yellow-600",
  balance_reset: "bg-orange-500/10 text-orange-600",
  balance_adjust: "bg-brand-blue/10 text-brand-blue",
  admin_message: "bg-brand-blue/10 text-brand-blue",
  subscription_check_fail: "bg-destructive/10 text-destructive",
};

export default function AlertsPage() {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { fetchAlerts(); }, []);

  const markRead = async (id: string) => {
    await adminApi("mark_alert_read", { alert_id: id });
    fetchAlerts();
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  const unreadCount = alerts.filter(a => !a.is_read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{t("alerts.title")}</h2>
        {unreadCount > 0 && (
          <Badge className="rounded-xl bg-destructive/10 text-destructive border-destructive/20">
            {unreadCount} {t("alerts.unread")}
          </Badge>
        )}
      </div>

      {alerts.length === 0 && (
        <div className="glass-card p-12 text-center text-muted-foreground">
          <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>{t("alerts.noAlerts")}</p>
        </div>
      )}

      <div className="space-y-3">
        {alerts.map((a) => {
          const Icon = TYPE_ICONS[a.type] || Info;
          const colorClass = TYPE_COLORS[a.type] || "bg-muted text-muted-foreground";
          return (
            <div key={a.id} className={`glass-card p-4 flex items-start gap-4 transition-all ${a.is_read ? "bg-muted/20" : ""}`}>
              <div className={`p-2.5 rounded-xl shrink-0 ${a.is_read ? "bg-muted text-muted-foreground" : colorClass}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="rounded-lg text-xs">{a.type}</Badge>
                  <span className="text-xs text-muted-foreground">{format(parseISO(a.created_at), "dd.MM.yyyy HH:mm")}</span>
                </div>
                <p className={`text-sm ${a.is_read ? "text-muted-foreground" : ""}`}>{a.message}</p>
              </div>
              {!a.is_read && (
                <Button variant="ghost" size="sm" className="rounded-xl shrink-0" onClick={() => markRead(a.id)}>
                  <Check className="h-4 w-4 mr-1" /> {t("common.read")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
