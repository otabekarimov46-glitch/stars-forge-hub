import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Users, DollarSign, Eye, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { format, subDays, parseISO } from "date-fns";

export default function StatisticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi("get_stats")
      .then(setStats)
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted-foreground">Загрузка...</div>;
  if (!stats) return <div className="text-destructive">Ошибка загрузки</div>;

  const totalUsers = stats.users?.length || 0;
  const suspiciousUsers = stats.users?.filter((u: any) => u.is_suspicious).length || 0;
  const totalBalance = stats.users?.reduce((s: number, u: any) => s + Number(u.balance_pt), 0) || 0;
  const totalViews = stats.videoViews?.length || 0;
  const pendingWithdrawals = stats.withdrawals?.filter((w: any) => w.status === "pending").length || 0;

  // Build daily registrations chart (last 14 days)
  const regChart: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const day = format(subDays(new Date(), i), "MM-dd");
    regChart[day] = 0;
  }
  stats.users?.forEach((u: any) => {
    const day = format(parseISO(u.created_at), "MM-dd");
    if (regChart[day] !== undefined) regChart[day]++;
  });
  const regData = Object.entries(regChart).map(([date, count]) => ({ date, count }));

  // Withdrawals by status
  const wdPending = stats.withdrawals?.filter((w: any) => w.status === "pending").length || 0;
  const wdApproved = stats.withdrawals?.filter((w: any) => w.status === "approved").length || 0;
  const wdRejected = stats.withdrawals?.filter((w: any) => w.status === "rejected").length || 0;
  const wdData = [
    { status: "Ожидают", count: wdPending },
    { status: "Одобрены", count: wdApproved },
    { status: "Отклонены", count: wdRejected },
  ];

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Пользователей</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /><span className="text-2xl font-bold">{totalUsers}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Подозрительных</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /><span className="text-2xl font-bold">{suspiciousUsers}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Суммарный баланс</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-primary" /><span className="text-2xl font-bold">{totalBalance.toFixed(0)} PT</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Просмотров видео</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /><span className="text-2xl font-bold">{totalViews}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Выводов в ожидании</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-destructive" /><span className="text-2xl font-bold">{pendingWithdrawals}</span></CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Регистрации (14 дней)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={regData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Выводы по статусу</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={wdData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" fontSize={12} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Unread alerts */}
      {stats.alerts && stats.alerts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Непрочитанные алерты</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {stats.alerts.map((a: any) => (
              <div key={a.id} className="flex items-start gap-2 p-2 rounded bg-muted/50">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm">{a.message}</p>
                  <p className="text-xs text-muted-foreground">{format(parseISO(a.created_at), "dd.MM.yyyy HH:mm")}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
