import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function AlertsPage() {
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

  if (loading) return <div className="text-muted-foreground">Загрузка...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Алерты ({alerts.filter(a => !a.is_read).length} непрочитанных)</h2>
      {alerts.length === 0 && <p className="text-muted-foreground">Нет алертов</p>}
      {alerts.map((a) => (
        <Card key={a.id} className={a.is_read ? "opacity-60" : ""}>
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${a.is_read ? "text-muted-foreground" : "text-destructive"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline">{a.type}</Badge>
                <span className="text-xs text-muted-foreground">{format(parseISO(a.created_at), "dd.MM.yyyy HH:mm")}</span>
              </div>
              <p className="text-sm">{a.message}</p>
            </div>
            {!a.is_read && (
              <Button variant="ghost" size="sm" onClick={() => markRead(a.id)}>
                <Check className="h-4 w-4 mr-1" /> Прочитано
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
