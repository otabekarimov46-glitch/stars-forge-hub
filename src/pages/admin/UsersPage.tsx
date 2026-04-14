import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Ban, Snowflake, ShieldAlert, RotateCcw, MessageSquare, Search, Plus, Minus, Network, Skull } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<any[]>([]);
  const [farms, setFarms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [messageUser, setMessageUser] = useState<any>(null);
  const [messageText, setMessageText] = useState("");
  const [adjustUser, setAdjustUser] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState("");

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

  const handleBan = async (userId: string, currentBanned: boolean) => {
    await adminApi("ban_user", { user_id: userId, is_banned: !currentBanned });
    toast.success(currentBanned ? t("users.unbanned") : t("users.banned"));
    fetchData();
  };

  const handleFreeze = async (userId: string, currentFrozen: boolean) => {
    await adminApi("freeze_balance", { user_id: userId, frozen: !currentFrozen });
    toast.success(currentFrozen ? t("users.unfrozen") : t("users.frozen"));
    fetchData();
  };

  const handleCaptcha = async (userId: string) => {
    await adminApi("send_captcha", { user_id: userId });
    toast.success(t("users.captchaAssigned"));
    fetchData();
  };

  const handleReset = async (userId: string) => {
    if (!confirm(t("users.confirmReset"))) return;
    await adminApi("reset_balance", { user_id: userId });
    toast.success(t("users.balanceReset"));
    fetchData();
  };

  const handleMessage = async () => {
    if (!messageText.trim()) return;
    await adminApi("send_message", { user_id: messageUser.id, message: messageText });
    toast.success(t("users.messageSent"));
    setMessageUser(null);
    setMessageText("");
  };

  const handleAdjust = async (amount: number) => {
    if (!adjustUser) return;
    await adminApi("adjust_balance", { user_id: adjustUser.id, amount });
    toast.success(t("users.balanceAdjusted"));
    setAdjustUser(null);
    setAdjustAmount("");
    fetchData();
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
            {filtered.map((u) => (
              <div key={u.id} className={`glass-card p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${u.is_banned ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white ${
                    u.is_banned ? "bg-destructive" : u.is_suspicious ? "bg-yellow-500" : "bg-gradient-to-br from-brand-purple to-brand-blue"
                  }`}>
                    {(u.username || "U")[0].toUpperCase()}
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
                      {u.user_ips?.[0] && <span className="font-mono text-xs">{u.user_ips[0].ip_address}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => setAdjustUser(u)}>
                        <Plus className="h-4 w-4 text-brand-green" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("users.adjustBalance")}</TooltipContent>
                  </Tooltip>
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
                      <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => handleReset(u.id)}>
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
            ))}
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

      {/* Adjust Balance Dialog */}
      <Dialog open={!!adjustUser} onOpenChange={(v) => { if (!v) { setAdjustUser(null); setAdjustAmount(""); } }}>
        <DialogContent className="glass-card border-0">
          <DialogHeader>
            <DialogTitle>{t("users.adjustBalance")}: {adjustUser?.username ? `@${adjustUser.username}` : adjustUser?.telegram_id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("users.currentBalance")}: <span className="font-bold text-foreground">{Number(adjustUser?.balance_pt || 0).toFixed(1)} PT</span></p>
            <div>
              <Label>{t("users.amount")} (PT)</Label>
              <Input className="rounded-xl" type="number" step="0.1" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="10" />
            </div>
            <div className="flex gap-3">
              <Button onClick={() => handleAdjust(Number(adjustAmount))} className="flex-1 rounded-xl gap-2 bg-brand-green text-white">
                <Plus className="h-4 w-4" /> {t("users.add")}
              </Button>
              <Button onClick={() => handleAdjust(-Number(adjustAmount))} variant="destructive" className="flex-1 rounded-xl gap-2">
                <Minus className="h-4 w-4" /> {t("users.subtract")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
