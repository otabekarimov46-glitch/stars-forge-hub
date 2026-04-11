import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Ban, Snowflake, ShieldAlert, RotateCcw, MessageSquare, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [messageUser, setMessageUser] = useState<any>(null);
  const [messageText, setMessageText] = useState("");

  const fetchUsers = async () => {
    try {
      const data = await adminApi("get_users");
      setUsers(data || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleBan = async (userId: string, currentBanned: boolean) => {
    await adminApi("ban_user", { user_id: userId, is_banned: !currentBanned });
    toast.success(currentBanned ? "Разбанен" : "Забанен");
    fetchUsers();
  };

  const handleFreeze = async (userId: string, currentFrozen: boolean) => {
    await adminApi("freeze_balance", { user_id: userId, frozen: !currentFrozen });
    toast.success(currentFrozen ? "Баланс разморожен" : "Баланс заморожен");
    fetchUsers();
  };

  const handleCaptcha = async (userId: string) => {
    await adminApi("force_captcha", { user_id: userId });
    toast.success("Капча назначена");
    fetchUsers();
  };

  const handleReset = async (userId: string) => {
    if (!confirm("Сбросить баланс пользователя до 0?")) return;
    await adminApi("reset_balance", { user_id: userId });
    toast.success("Баланс сброшен");
    fetchUsers();
  };

  const handleMessage = async () => {
    if (!messageText.trim()) return;
    await adminApi("message_user", { user_id: messageUser.id, message: messageText });
    toast.success("Сообщение отправлено");
    setMessageUser(null);
    setMessageText("");
  };

  const filtered = users.filter(u => {
    const s = search.toLowerCase();
    return (
      String(u.telegram_id).includes(s) ||
      (u.username || "").toLowerCase().includes(s) ||
      u.id.toLowerCase().includes(s)
    );
  });

  if (loading) return <div className="text-muted-foreground">Загрузка...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по ID, Telegram ID, username..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <span className="text-sm text-muted-foreground">{filtered.length} из {users.length}</span>
      </div>

      <div className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Telegram ID</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Баланс</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Нарушения</TableHead>
              <TableHead>Капчи</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => (
              <TableRow key={u.id} className={u.is_banned ? "opacity-60" : ""}>
                <TableCell className="font-mono text-xs">{u.telegram_id}</TableCell>
                <TableCell>{u.username || "—"}</TableCell>
                <TableCell>
                  <span className={u.balance_frozen ? "line-through text-muted-foreground" : ""}>
                    {Number(u.balance_pt).toFixed(0)} PT
                  </span>
                  {u.balance_frozen && <Badge variant="outline" className="ml-1 text-xs">🧊</Badge>}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {u.user_ips?.map((ip: any) => ip.ip_address).join(", ") || "—"}
                </TableCell>
                <TableCell className="space-x-1">
                  {u.is_banned && <Badge variant="destructive">BAN</Badge>}
                  {u.is_suspicious && <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">⚠️</Badge>}
                  {!u.is_banned && !u.is_suspicious && <Badge variant="outline">OK</Badge>}
                </TableCell>
                <TableCell>{u.violation_count}</TableCell>
                <TableCell>{u.captcha_count}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => handleBan(u.id, u.is_banned)}>
                          <Ban className={`h-4 w-4 ${u.is_banned ? "text-destructive" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{u.is_banned ? "Разбанить" : "Забанить"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => handleFreeze(u.id, u.balance_frozen)}>
                          <Snowflake className={`h-4 w-4 ${u.balance_frozen ? "text-blue-500" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{u.balance_frozen ? "Разморозить" : "Заморозить баланс"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => handleCaptcha(u.id)}>
                          <ShieldAlert className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Назначить капчу</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => handleReset(u.id)}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Сбросить баланс</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setMessageUser(u)}>
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Написать</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Пользователи не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Message dialog */}
      <Dialog open={!!messageUser} onOpenChange={(v) => { if (!v) setMessageUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сообщение пользователю {messageUser?.username || messageUser?.telegram_id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Текст сообщения</Label>
              <Textarea value={messageText} onChange={e => setMessageText(e.target.value)} placeholder="Введите сообщение..." rows={4} />
            </div>
            <Button onClick={handleMessage} className="w-full">Отправить</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
