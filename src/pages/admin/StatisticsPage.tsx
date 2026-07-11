import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";
import { Users, DollarSign, Eye, AlertTriangle, TrendingUp, UserPlus, Share2, Trophy, Ticket } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { format, subDays, parseISO, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

export default function StatisticsPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<any>(null);
  const [topPromo, setTopPromo] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminApi("get_stats").then(setStats),
      adminApi("get_top_promo_users").then((d) => setTopPromo(d || [])).catch(() => {}),
    ])
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);


  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );
  if (!stats) return <div className="text-destructive">{t("common.error")}</div>;

  const totalUsers = stats.users?.length || 0;
  const suspiciousUsers = stats.users?.filter((u: any) => u.is_suspicious).length || 0;
  const totalBalance = stats.users?.reduce((s: number, u: any) => s + Number(u.balance_pt), 0) || 0;
  // Real video views count from DB
  const totalViews = stats.rewardedVideoViews || 0;
  // Real pending withdrawals from DB
  const pendingWithdrawals = stats.withdrawals?.filter((w: any) => w.status === "pending").length || 0;

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

  const wdPending = stats.withdrawals?.filter((w: any) => w.status === "pending").length || 0;
  const wdApproved = stats.withdrawals?.filter((w: any) => w.status === "approved").length || 0;
  const wdRejected = stats.withdrawals?.filter((w: any) => w.status === "rejected").length || 0;
  const wdData = [
    { status: t("stats.pending"), count: wdPending },
    { status: t("stats.approved"), count: wdApproved },
    { status: t("stats.rejected"), count: wdRejected },
  ];

  const kpis = [
    { label: t("stats.totalUsers"), value: totalUsers, icon: Users, color: "from-brand-purple to-brand-blue" },
    { label: t("stats.suspicious"), value: suspiciousUsers, icon: AlertTriangle, color: "from-destructive to-orange-500" },
    { label: t("stats.totalBalance"), value: `${totalBalance.toFixed(0)} PT`, icon: DollarSign, color: "from-brand-gold to-yellow-500" },
    { label: t("stats.videoViews"), value: totalViews, icon: Eye, color: "from-brand-blue to-brand-green" },
    { label: t("stats.pendingWithdrawals"), value: pendingWithdrawals, icon: TrendingUp, color: "from-brand-green to-emerald-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="glass-card p-4 relative overflow-hidden group hover:scale-[1.02] transition-transform">
            <div className={`absolute inset-0 bg-gradient-to-br ${kpi.color} opacity-5 group-hover:opacity-10 transition-opacity`} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-2 rounded-xl bg-gradient-to-br ${kpi.color}`}>
                  <kpi.icon className="h-4 w-4 text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{kpi.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="text-base font-semibold mb-4">{t("stats.registrations")}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={regData}>
              <defs>
                <linearGradient id="colorReg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
              <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorReg)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="glass-card p-6">
          <h3 className="text-base font-semibold mb-4">{t("stats.withdrawalsByStatus")}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={wdData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="status" fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Referral stats */}
      {(() => {
        const users = stats.users || [];
        const activeSet = new Set<string>(stats.activeUserIds || []);
        const invited = users.filter((u: any) => u.referrer_id).length;
        const totalRefEarn = users.reduce((s: number, u: any) => s + Number(u.referral_earnings_pt || 0), 0);
        const refCountByUser = new Map<string, number>();
        const activeRefCountByUser = new Map<string, number>();
        users.forEach((u: any) => {
          if (u.referrer_id) {
            refCountByUser.set(u.referrer_id, (refCountByUser.get(u.referrer_id) || 0) + 1);
            if (activeSet.has(u.id)) {
              activeRefCountByUser.set(u.referrer_id, (activeRefCountByUser.get(u.referrer_id) || 0) + 1);
            }
          }
        });
        const activeRefsTotal = users.filter((u: any) => u.referrer_id && activeSet.has(u.id)).length;
        const fmtPt = (n: number) => {
          const r = Math.round(n * 100) / 100;
          return `${(r % 1 === 0 ? r.toFixed(0) : r.toFixed(2).replace(/\.?0+$/, ""))} PT`;
        };
        const top = users
          .filter((u: any) => refCountByUser.get(u.id))
          .map((u: any) => ({
            id: u.id,
            name: u.username ? `@${u.username}` : `ID ${u.telegram_id}`,
            count: refCountByUser.get(u.id) || 0,
            earned: Number(u.referral_earnings_pt || 0),
          }))
          .sort((a: any, b: any) => b.count - a.count)
          .slice(0, 5);
        const refKpis = [
          { label: "Приглашено всего", value: invited, icon: UserPlus, color: "from-brand-purple to-brand-blue" },
          { label: "Активных рефералов", value: activeRefsTotal, icon: Share2, color: "from-brand-blue to-brand-green" },
          { label: "Выплачено рефералам", value: fmtPt(totalRefEarn), icon: DollarSign, color: "from-brand-gold to-yellow-500" },
        ];
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-brand-purple to-brand-blue">
                <Share2 className="h-4 w-4 text-white" />
              </div>
              <h3 className="text-base font-semibold">Реферальная программа</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {refKpis.map((k) => (
                <div key={k.label} className="glass-card p-4 relative overflow-hidden group hover:scale-[1.02] transition-transform">
                  <div className={`absolute inset-0 bg-gradient-to-br ${k.color} opacity-5 group-hover:opacity-10 transition-opacity`} />
                  <div className="relative">
                    <div className={`inline-flex p-2 rounded-xl bg-gradient-to-br ${k.color} mb-2`}>
                      <k.icon className="h-4 w-4 text-white" />
                    </div>
                    <p className="text-2xl font-bold">{k.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{k.label}</p>
                  </div>
                </div>
              ))}
            </div>
            {top.length > 0 && (
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="h-4 w-4 text-brand-gold" />
                  <h4 className="text-sm font-semibold">Топ рефереров</h4>
                </div>
                <div className="space-y-2">
                  {top.map((u: any, i: number) => (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br ${
                        i === 0 ? "from-yellow-400 to-orange-500" :
                        i === 1 ? "from-slate-300 to-slate-500" :
                        i === 2 ? "from-amber-600 to-amber-800" :
                        "from-brand-purple to-brand-blue"
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{u.count} 👥</p>
                        <p className="text-xs text-muted-foreground">{u.earned.toFixed(2).replace(/\.?0+$/, "")} PT</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Топ 10 промокодеров */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-gradient-to-br from-brand-gold to-yellow-500">
            <Ticket className="h-4 w-4 text-white" />
          </div>
          <h3 className="text-base font-semibold">Топ 10 промокодеров</h3>
        </div>
        <div className="glass-card p-6">
          {topPromo.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Никто ещё не активировал промокоды</p>
          ) : (
            <div className="space-y-2">
              {topPromo.map((u: any, i: number) => {
                const name = u.username ? `@${u.username}` : `ID ${u.telegram_id}`;
                const lastSeen = u.last_seen_at
                  ? formatDistanceToNow(parseISO(u.last_seen_at), { addSuffix: true, locale: ru })
                  : "нет данных";
                return (
                  <div key={u.user_id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br ${
                      i === 0 ? "from-yellow-400 to-orange-500" :
                      i === 1 ? "from-slate-300 to-slate-500" :
                      i === 2 ? "from-amber-600 to-amber-800" :
                      "from-brand-purple to-brand-blue"
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground truncate">Заходил {lastSeen}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{u.promo_count} 🎟️</p>
                      <p className="text-xs text-muted-foreground">{Number(u.total_pt).toFixed(2).replace(/\.?0+$/, "")} PT</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>


      {stats.alerts && stats.alerts.length > 0 && (
        <div className="glass-card p-6">

          <h3 className="text-base font-semibold mb-4">{t("stats.unreadAlerts")}</h3>
          <div className="space-y-2">
            {stats.alerts.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl bg-destructive/5 border border-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm">{a.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{format(parseISO(a.created_at), "dd.MM.yyyy HH:mm")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
