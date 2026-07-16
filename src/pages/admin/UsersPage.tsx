import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Ban, Snowflake, ShieldAlert, RotateCcw, MessageSquare, Search, Network, Skull,
  X, Trophy, Users as UsersIcon, Ticket, Bell, Wallet, Gift, Clock, ChevronDown, ChevronUp,
  Film, Newspaper, Camera, Send, ListChecks, ArrowUpRight, ArrowUp, Circle, ExternalLink, AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, parseISO } from "date-fns";

const ACTION_META: Record<string, { label: string; icon: any; color: string }> = {
  video:         { label: "Видеореклама",     icon: Film,       color: "text-brand-purple" },
  subscribe:     { label: "Подписка",         icon: Send,       color: "text-brand-blue" },
  view_post:     { label: "Просмотр поста",   icon: Newspaper,  color: "text-brand-green" },
  view_story:    { label: "Просмотр истории", icon: Camera,     color: "text-brand-gold" },
  reaction:      { label: "Реакция",          icon: Gift,       color: "text-pink-500" },
  balance_reset: { label: "Обнуление баланса", icon: RotateCcw, color: "text-orange-500" },
  promo_reward:  { label: "Промокод",          icon: Gift,      color: "text-emerald-500" },
  withdrawal_paid:     { label: "Вывод выполнен", icon: ArrowUp, color: "text-orange-500" },
  withdrawal_rejected: { label: "Вывод отменён (возврат)", icon: ArrowUp, color: "text-emerald-500" },
};

export default function UsersPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<any[]>([]);
  const [farms, setFarms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [messageUser, setMessageUser] = useState<any>(null);
  const [messageText, setMessageText] = useState("");
  const [resetUser, setResetUser] = useState<any>(null);
  const [resetReason, setResetReason] = useState("");
  const [openUser, setOpenUser] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [showIps, setShowIps] = useState(false);
  const focusId = searchParams.get("focus");
  const initialTab = searchParams.get("tab") || "";
  const focusWd = searchParams.get("wd") || "";
  const [roomInitialTab, setRoomInitialTab] = useState<string>("tx");
  const [roomHighlightWd, setRoomHighlightWd] = useState<string>("");
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const fetchData = async () => {
    try {
      const [u, f] = await Promise.all([adminApi("get_users"), adminApi("get_farms")]);
      setUsers(u || []);
      setFarms(f || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Anchor highlight / auto-open when ?focus=<id> is present
  useEffect(() => {
    if (!focusId || loading) return;
    const user = users.find((u) => u.id === focusId);
    // If a tab is requested (e.g. from Все логи → Выводы) auto-open the User Room.
    if (user && initialTab) {
      setRoomInitialTab(initialTab);
      setRoomHighlightWd(focusWd);
      setOpenUser(user);
      setShowIps(false);
      loadRoom(user.id);
      const p = new URLSearchParams(searchParams);
      p.delete("focus"); p.delete("tab"); p.delete("wd");
      setSearchParams(p, { replace: true });
      return;
    }
    const el = rowRefs.current[focusId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "animate-pulse");
      const timer = setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "animate-pulse");
        const p = new URLSearchParams(searchParams); p.delete("focus"); setSearchParams(p, { replace: true });
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [focusId, loading, users]);

  const loadRoom = async (userId: string, silent = false) => {
    if (!silent) {
      setRoomLoading(true);
      setRoom(null);
    }
    try {
      const data = await adminApi("get_user_room", { user_id: userId });
      setRoom(data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      if (!silent) setRoomLoading(false);
    }
  };

  useEffect(() => {
    if (!openUser?.id) return;
    const id = setInterval(() => loadRoom(openUser.id, true), 5_000);
    return () => clearInterval(id);
  }, [openUser?.id]);

  const openRoom = (u: any) => {
    setRoomInitialTab("tx");
    setRoomHighlightWd("");
    setOpenUser(u);
    setShowIps(false);
    loadRoom(u.id);
  };

  const handleBan = async (userId: string, currentBanned: boolean) => {
    await adminApi("ban_user", { user_id: userId, is_banned: !currentBanned });
    toast.success(currentBanned ? t("users.unbanned") : t("users.banned"));
    fetchData();
    if (openUser?.id === userId) loadRoom(userId);
  };

  const handleFreeze = async (userId: string, currentFrozen: boolean) => {
    await adminApi("freeze_balance", { user_id: userId, frozen: !currentFrozen });
    toast.success(currentFrozen ? t("users.unfrozen") : t("users.frozen"));
    fetchData();
    if (openUser?.id === userId) loadRoom(userId);
  };

  const handleCaptcha = async (userId: string) => {
    await adminApi("send_captcha", { user_id: userId });
    toast.success(t("users.captchaAssigned"));
    fetchData();
  };

  const confirmReset = async () => {
    if (!resetUser) return;
    try {
      await adminApi("reset_balance", { user_id: resetUser.id, reason: resetReason.trim() || null });
      toast.success(t("users.balanceReset"));
      setResetUser(null); setResetReason("");
      fetchData();
      if (openUser?.id === resetUser.id) loadRoom(resetUser.id);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleMessage = async () => {
    if (!messageText.trim()) return;
    await adminApi("send_message", { user_id: messageUser.id, message: messageText });
    toast.success(t("users.messageSent"));
    setMessageUser(null);
    setMessageText("");
  };

  const handleBulkBan = async (userIds: string[]) => {
    if (!confirm(t("users.confirmBulkBan"))) return;
    await adminApi("bulk_ban", { user_ids: userIds });
    toast.success(t("users.bulkBanned"));
    fetchData();
  };

  const filtered = users.filter(u => {
    const s = search.toLowerCase();
    return (
      String(u.telegram_id).includes(s) ||
      (u.username || "").toLowerCase().includes(s) ||
      u.id.toLowerCase().includes(s)
    );
  });

  const onlineCutoff = useMemo(() => Date.now() - 2 * 60 * 1000, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="users">
        <TabsList className="rounded-xl">
          <TabsTrigger value="users" className="rounded-lg">{t("users.title")} ({users.length})</TabsTrigger>
          <TabsTrigger value="farms" className="rounded-lg">{t("users.farms")} ({farms.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("users.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 rounded-xl"
              />
            </div>
            <Badge variant="outline" className="rounded-lg">
              {filtered.length} {t("common.of")} {users.length}
            </Badge>
          </div>

          <div className="space-y-3">
            {filtered.map((u) => {
              const isOnline = u.last_seen_at && new Date(u.last_seen_at).getTime() >= onlineCutoff;
              return (
                <div
                  key={u.id}
                  ref={(el) => { rowRefs.current[u.id] = el; }}
                  className={`glass-card p-4 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer hover:bg-primary/5 transition-all ${u.is_banned ? "opacity-60" : ""}`}
                  onClick={() => openRoom(u)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white ${
                        u.is_banned ? "bg-destructive" : u.is_suspicious ? "bg-yellow-500" : "bg-gradient-to-br from-brand-purple to-brand-blue"
                      }`}>
                        {(u.username || "U")[0].toUpperCase()}
                      </div>
                      {isOnline && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-background" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{u.username ? `@${u.username}` : `ID: ${u.telegram_id}`}</span>
                        {u.is_banned && <Badge variant="destructive" className="rounded-lg text-xs">BAN</Badge>}
                        {u.is_suspicious && <Badge className="rounded-lg text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/20">⚠️</Badge>}
                        {u.balance_frozen && <Badge variant="outline" className="rounded-lg text-xs">🧊</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="font-mono">{u.telegram_id}</span>
                        <span className={u.balance_frozen ? "line-through" : "font-medium text-foreground"}>
                          {Number(u.balance_pt).toFixed(1)} PT
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => handleBan(u.id, u.is_banned)}>
                          <Ban className={`h-4 w-4 ${u.is_banned ? "text-destructive" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{u.is_banned ? t("users.unban") : t("users.ban")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => handleFreeze(u.id, u.balance_frozen)}>
                          <Snowflake className={`h-4 w-4 ${u.balance_frozen ? "text-brand-blue" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{u.balance_frozen ? t("users.unfreeze") : t("users.freeze")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => handleCaptcha(u.id)}>
                          <ShieldAlert className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("users.captcha")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => setResetUser(u)}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("users.resetBalance")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => setMessageUser(u)}>
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("users.message")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center text-muted-foreground py-12 glass-card">
                {t("users.notFound")}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="farms" className="space-y-4 mt-4">
          {farms.length === 0 ? (
            <div className="glass-card p-12 text-center text-muted-foreground">
              <Network className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>{t("users.noFarms")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {farms.map((farm: any) => (
                <div key={farm.ip} className="glass-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-destructive/10">
                        <Skull className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <span className="font-mono text-sm font-medium">{farm.ip}</span>
                        <p className="text-xs text-muted-foreground">{farm.count} {t("users.accounts")}</p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="rounded-xl gap-2"
                      onClick={() => handleBulkBan(farm.users.map((u: any) => u.id))}
                    >
                      <Ban className="h-4 w-4" /> {t("users.banAll")}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {farm.users.map((u: any) => (
                      <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{u.username ? `@${u.username}` : u.telegram_id}</span>
                          {u.is_banned && <Badge variant="destructive" className="rounded-lg text-xs">BAN</Badge>}
                        </div>
                        <span className="text-sm font-medium">{Number(u.balance_pt).toFixed(1)} PT</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Message Dialog */}
      <Dialog open={!!messageUser} onOpenChange={(v) => { if (!v) setMessageUser(null); }}>
        <DialogContent className="glass-card border-0">
          <DialogHeader>
            <DialogTitle>{t("users.messageTitle")} {messageUser?.username ? `@${messageUser.username}` : messageUser?.telegram_id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("users.messageText")}</Label>
              <Textarea className="rounded-xl" value={messageText} onChange={e => setMessageText(e.target.value)} placeholder={t("users.messagePlaceholder")} rows={4} />
            </div>
            <Button onClick={handleMessage} className="w-full rounded-xl bg-gradient-to-r from-brand-purple to-brand-blue text-white">{t("common.send")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Balance Dialog with reason */}
      <Dialog open={!!resetUser} onOpenChange={(v) => { if (!v) { setResetUser(null); setResetReason(""); } }}>
        <DialogContent className="glass-card border-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-orange-500" />
              Обнулить баланс
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-orange-500/10 text-sm">
              <div>{resetUser?.username ? `@${resetUser.username}` : `ID ${resetUser?.telegram_id}`}</div>
              <div className="text-xs text-muted-foreground mt-1">Текущий баланс: <span className="font-semibold text-foreground">{Number(resetUser?.balance_pt || 0).toFixed(2)} PT</span></div>
            </div>
            <div>
              <Label>Причина (необязательно)</Label>
              <Textarea
                className="rounded-xl mt-1"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="Например: подозрительная активность / нарушение правил"
                rows={3}
                maxLength={500}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Причина попадёт в «Все логи», Алерты, историю транзакций пользователя и экспорт.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => { setResetUser(null); setResetReason(""); }}>Отмена</Button>
            <Button className="rounded-xl bg-orange-500 hover:bg-orange-600 text-white" onClick={confirmReset}>Обнулить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Room Dialog */}
      <Dialog open={!!openUser} onOpenChange={(v) => { if (!v) { setOpenUser(null); setRoom(null); } }}>
        <DialogContent className="glass-card border-0 max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <UserRoomContent
            user={openUser}
            room={room}
            loading={roomLoading}
            showIps={showIps}
            setShowIps={setShowIps}
            onClose={() => { setOpenUser(null); setRoom(null); }}
            onBan={handleBan}
            onFreeze={handleFreeze}
            onCaptcha={handleCaptcha}
            onReset={(u) => setResetUser(u)}
            onMessage={(u) => setMessageUser(u)}
            onJumpToUser={(userId) => {
              setOpenUser(null); setRoom(null);
              setSearchParams({ focus: userId }, { replace: true });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserRoomContent({ user, room, loading, showIps, setShowIps, onClose, onBan, onFreeze, onCaptcha, onReset, onMessage, onJumpToUser }: any) {
  if (!user) return null;
  const display = user.username ? `@${user.username}` : `ID ${user.telegram_id}`;
  return (
    <>
      <DialogHeader className="p-5 pb-3 border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold text-white ${user.is_banned ? "bg-destructive" : user.is_suspicious ? "bg-yellow-500" : "bg-gradient-to-br from-brand-purple to-brand-blue"}`}>
                {(user.username || "U")[0].toUpperCase()}
              </div>
              {room?.online && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg flex items-center gap-2 flex-wrap">
                {display}
                {user.is_banned && <Badge variant="destructive" className="rounded-md text-[10px]">BAN</Badge>}
                {user.is_suspicious && <Badge className="rounded-md text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/20">⚠️</Badge>}
                {user.balance_frozen && <Badge variant="outline" className="rounded-md text-[10px]">🧊 Frozen</Badge>}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Circle className={`h-2 w-2 fill-current ${room?.online ? "text-emerald-500" : "text-muted-foreground"}`} />
                {room?.online ? "В сети сейчас" : (user.last_seen_at ? `Был(а): ${format(parseISO(user.last_seen_at), "dd.MM.yyyy HH:mm")}` : "Никогда не заходил(а)")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => onBan(user.id, user.is_banned)}>
                  <Ban className={`h-4 w-4 ${user.is_banned ? "text-destructive" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{user.is_banned ? "Разбан" : "Бан"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => onFreeze(user.id, user.balance_frozen)}>
                  <Snowflake className={`h-4 w-4 ${user.balance_frozen ? "text-brand-blue" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{user.balance_frozen ? "Разморозить" : "Заморозить"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => onCaptcha(user.id)}>
                  <ShieldAlert className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Капча</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => onReset(user)}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Обнулить</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => onMessage(user)}>
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Сообщение</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading || !room ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {/* KPI grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatBox icon={Wallet} label="Баланс" value={`${Number(user.balance_pt).toFixed(2)} PT`} sub={user.balance_frozen ? "заморожен" : ""} />
              <StatBox icon={Trophy} label="Топ по балансу" value={room.rank_balance ? `#${room.rank_balance}` : "—"} sub={`из ${room.total_users}`} />
              <StatBox icon={UsersIcon} label="Топ рефералов" value={room.rank_referrals ? `#${room.rank_referrals}` : "—"} sub={`${Number(user.referral_earnings_pt || 0).toFixed(2)} PT`} />
              <StatBox icon={Ticket} label="Топ промокодеров" value={room.rank_promo ? `#${room.rank_promo}` : "—"} sub={`${room.promo_count} шт.`} />
            </div>

            <Tabs defaultValue="tx">
              <TabsList className="rounded-xl w-full flex-wrap h-auto">
                <TabsTrigger value="tx" className="rounded-lg gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Транзакции ({room.activity.length})</TabsTrigger>
                <TabsTrigger value="withdrawals" className="rounded-lg gap-1.5"><ArrowUp className="h-3.5 w-3.5" /> Выводы ({(room.withdrawals || []).length})</TabsTrigger>
                <TabsTrigger value="alerts" className="rounded-lg gap-1.5"><Bell className="h-3.5 w-3.5" /> Алерты ({room.alerts.length})</TabsTrigger>
                <TabsTrigger value="promo" className="rounded-lg gap-1.5"><Ticket className="h-3.5 w-3.5" /> Промокоды ({room.promos.length})</TabsTrigger>
                <TabsTrigger value="refs" className="rounded-lg gap-1.5"><UsersIcon className="h-3.5 w-3.5" /> Рефералы ({room.referrals_total})</TabsTrigger>
                <TabsTrigger value="info" className="rounded-lg gap-1.5"><Network className="h-3.5 w-3.5" /> Данные</TabsTrigger>
              </TabsList>

              {/* Transactions */}
              <TabsContent value="tx" className="mt-3 space-y-1.5">
                {room.activity.length === 0 && <EmptyState text="Транзакций пока нет" />}
                {room.activity.map((a: any) => {
                  const meta = ACTION_META[a.action_type] || ACTION_META.subscribe;
                  const Icon = meta.icon;
                  const reward = Number(a.reward_pt || 0);
                  const negative = reward < 0;
                  return (
                    <div key={a.id} className="glass-card p-3 flex items-center gap-3 text-sm">
                      <div className={`p-2 rounded-xl bg-muted/40 ${meta.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{meta.label}</span>
                          {a.task_public_id && (
                            <span className="font-mono text-[11px] text-primary">{a.task_public_id}</span>
                          )}
                          {a.advertiser_public_id && (
                            <span className="font-mono text-[11px] text-muted-foreground">{a.advertiser_public_id}</span>
                          )}
                        </div>
                        {a.task_title && <div className="text-xs text-muted-foreground truncate">{a.task_title}</div>}
                        <div className="text-[10.5px] text-muted-foreground font-mono mt-0.5">
                          {format(parseISO(a.created_at), "dd.MM.yy HH:mm:ss")}
                        </div>
                      </div>
                      <div className={`font-semibold whitespace-nowrap ${negative ? "text-orange-500" : "text-brand-gold"}`}>
                        {negative ? "" : "+"}{reward.toFixed(2).replace(/\.?0+$/, "")} PT
                      </div>
                    </div>
                  );
                })}
              </TabsContent>

              {/* Withdrawals */}
              <TabsContent value="withdrawals" className="mt-3 space-y-1.5">
                {(room.withdrawals || []).length === 0 && <EmptyState text="Заявок на вывод не было" />}
                {(room.withdrawals || []).map((w: any) => {
                  const statusMeta = w.status === "approved" || w.status === "paid"
                    ? { label: "Оплачено", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" }
                    : w.status === "rejected"
                    ? { label: "Отменено", cls: "bg-destructive/10 text-destructive border-destructive/30" }
                    : { label: "В ожидании", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" };
                  return (
                    <div key={w.id} className="glass-card p-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <ArrowUp className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold tabular-nums">
                              {Number(w.amount_usdt || 0).toFixed(2)} USDT
                              <span className="text-muted-foreground font-normal text-xs ml-1.5">({Number(w.amount_pt || 0)} PT)</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              №{w.request_number} · {format(parseISO(w.created_at), "dd.MM.yyyy HH:mm")}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className={`rounded-md text-[10px] ${statusMeta.cls}`}>{statusMeta.label}</Badge>
                      </div>
                      {w.wallet_address && (
                        <div className="text-[11px] font-mono text-muted-foreground break-all pl-11">{w.wallet_address}</div>
                      )}
                      {w.cancel_reason && !w.cancel_reason.startsWith("await:") && (
                        <div className="text-[11px] text-destructive pl-11 mt-1">Причина: {w.cancel_reason}</div>
                      )}



                    </div>
                  );
                })}
              </TabsContent>

              {/* Alerts */}
              <TabsContent value="alerts" className="mt-3 space-y-1.5">
                {room.alerts.length === 0 && <EmptyState text="Алертов по этому пользователю нет" />}
                {room.alerts.map((al: any) => (
                  <div key={al.id} className="glass-card p-3 flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-destructive/10 text-destructive shrink-0">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="rounded-md text-[10px]">{al.type}</Badge>
                        <span className="text-[11px] text-muted-foreground">{format(parseISO(al.created_at), "dd.MM.yyyy HH:mm")}</span>
                      </div>
                      <p className="text-sm">{al.message}</p>
                    </div>
                  </div>
                ))}
              </TabsContent>

              {/* Promo */}
              <TabsContent value="promo" className="mt-3 space-y-1.5">
                {room.promos.length === 0 && <EmptyState text="Промокоды не активировал" />}
                {room.promos.map((p: any) => (
                  <div key={p.id} className="glass-card p-3 flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
                      <Gift className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm">{p.promo_codes?.code || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{format(parseISO(p.redeemed_at), "dd.MM.yyyy HH:mm")}</div>
                    </div>
                    <div className="font-semibold text-brand-gold whitespace-nowrap">+{Number(p.reward_pt).toFixed(2).replace(/\.?0+$/, "")} PT</div>
                  </div>
                ))}
              </TabsContent>

              {/* Referrals */}
              <TabsContent value="refs" className="mt-3 space-y-2">
                <div className="glass-card p-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Всего рефералов</span>
                  <span className="font-semibold">{room.referrals_total}</span>
                </div>
                <div className="glass-card p-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Всего заработано с рефералов</span>
                  <span className="font-semibold text-brand-gold">{Number(room.referrals_earnings_total || 0).toFixed(2)} PT</span>
                </div>
                {room.referrals.length === 0 ? <EmptyState text="Приглашённых пока нет" /> : (
                  <div className="space-y-1.5">
                    {room.referrals.map((r: any) => (
                      <button
                        key={r.id}
                        onClick={() => onJumpToUser(r.id)}
                        className="w-full glass-card p-3 flex items-center gap-3 text-left hover:bg-primary/5 transition-all press-soft"
                      >
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-purple to-brand-blue text-white text-sm font-bold flex items-center justify-center">
                          {(r.username || "U")[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{r.username ? `@${r.username}` : `ID ${r.telegram_id}`}</span>
                            {r.is_banned && <Badge variant="destructive" className="rounded-md text-[10px]">BAN</Badge>}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {r.telegram_id} · {format(parseISO(r.created_at), "dd.MM.yy")}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-brand-gold">+{Number(r.earned_from).toFixed(2)} PT</div>
                          <div className="text-[10px] text-muted-foreground">заработано с него</div>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Info: user_id, ips, farms */}
              <TabsContent value="info" className="mt-3 space-y-2">
                <div className="glass-card p-3 space-y-1.5 text-sm">
                  <InfoRow label="Telegram ID" value={<span className="font-mono">{user.telegram_id}</span>} />
                  <InfoRow label="Внутренний ID" value={<span className="font-mono text-xs">{user.id}</span>} />
                  <InfoRow label="Username" value={user.username ? `@${user.username}` : "—"} />
                  <InfoRow label="Регистрация" value={format(parseISO(user.created_at), "dd.MM.yyyy HH:mm")} />
                  <InfoRow label="Ежедневный бонус" value={user.daily_bonus_at ? format(parseISO(user.daily_bonus_at), "dd.MM.yyyy HH:mm") : "—"} />
                  <InfoRow label="Кол-во капч" value={String(user.captcha_count || 0)} />
                  <InfoRow label="Нарушений" value={String(user.violation_count || 0)} />
                  {user.ton_wallet_address && (
                    <InfoRow label="TON кошелёк" value={
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs break-all">{user.ton_wallet_address}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(user.ton_wallet_address); }}
                          className="press-soft text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0"
                        >Копировать</button>
                      </span>
                    } />
                  )}
                </div>




                {/* Farms shared IPs */}
                {room.ips.length > 0 && (
                  <div className="glass-card p-3">
                    <button
                      onClick={() => setShowIps(!showIps)}
                      className="w-full flex items-center justify-between text-sm press-soft"
                    >
                      <span className="flex items-center gap-2">
                        <Network className="h-4 w-4 text-muted-foreground" />
                        IP-адреса ({room.ips.length})
                      </span>
                      {showIps ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {showIps && (
                      <div className="mt-3 space-y-2">
                        {room.ips.map((ip: any) => {
                          const farm = room.farms?.find((f: any) => f.ip === ip.ip_address) || null;
                          return (
                            <div key={ip.ip_address} className="p-2 rounded-lg bg-muted/30">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-mono">{ip.ip_address}</span>
                                <span className="text-muted-foreground">{format(parseISO(ip.last_seen_at), "dd.MM.yy HH:mm")}</span>
                              </div>
                              {farm && farm.others.length > 0 && (
                                <div className="mt-1.5 pl-2 border-l-2 border-destructive/40 text-[11px] text-destructive">
                                  Ферма: ещё {farm.others.length} акк(а) с этого IP
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Detected farms */}
                {(() => {
                  const relevantFarms: any[] = [];
                  const seen = new Set();
                  (room.ips || []).forEach(() => {});
                  return null;
                })()}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </>
  );
}

function StatBox({ icon: Icon, label, value, sub }: any) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-lg font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="glass-card p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
