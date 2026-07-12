import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Plus, Ticket, MoreVertical, Play, Pause, Trash2, RotateCcw, Copy, Clock, Users as UsersIcon } from "lucide-react";

interface Promo {
  id: string;
  code: string;
  reward_pt: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  is_paused: boolean;
  created_at: string;
}

type DurationUnit = "minutes" | "hours" | "days";

const emptyForm = {
  code: "",
  reward_pt: "10",
  limit_uses: true,
  max_uses: "100",
  limit_time: false,
  duration_value: "1",
  duration_unit: "days" as DurationUnit,
};

function timeLeft(expires_at: string | null): string | null {
  if (!expires_at) return null;
  const ms = new Date(expires_at).getTime() - Date.now();
  if (ms <= 0) return "истёк";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

function computeExpiresAt(value: string, unit: DurationUnit): string {
  const n = Math.max(1, Number(value) || 1);
  const mult = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + n * mult).toISOString();
}

function isExhausted(p: Promo): boolean {
  const overUses = p.max_uses != null && p.used_count >= p.max_uses;
  const overTime = !!p.expires_at && new Date(p.expires_at).getTime() <= Date.now();
  return overUses || overTime || !p.is_active;
}

export default function PromoCodesSection() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [, setTick] = useState(0);

  // Re-render every minute so "time left" stays live.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const fetchData = async () => {
    try {
      const p = await adminApi("get_promos");
      setPromos(p || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const submit = async () => {
    const code = form.code.trim();
    if (!code) return toast.error("Введите промокод");
    const reward_pt = Number(form.reward_pt);
    if (!(reward_pt > 0)) return toast.error("Некорректная награда");
    // No lim + no expiry = infinite (1 activation per account still enforced on redeem).
    try {
      await adminApi("create_promo", {
        code,
        reward_pt,
        max_uses: form.limit_uses ? Number(form.max_uses) : null,
        expires_at: form.limit_time ? computeExpiresAt(form.duration_value, form.duration_unit) : null,
      });
      toast.success("Промокод создан");
      setDialogOpen(false);
      setForm(emptyForm);
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const togglePause = async (p: Promo) => {
    try {
      await adminApi("pause_promo", { promo_id: p.id, is_paused: !p.is_paused });
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const restart = async (p: Promo) => {
    try {
      await adminApi("restart_promo", { promo_id: p.id });
      toast.success("Промокод перезапущен");
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (p: Promo) => {
    try {
      await adminApi("delete_promo", { promo_id: p.id });
      toast.success("Промокод удалён");
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const copyCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); toast.success("Скопировано"); } catch {}
  };

  const active = promos.filter((p) => !isExhausted(p));
  const exhausted = promos.filter(isExhausted);

  const renderRow = (p: Promo, dim: boolean) => {
    const left = p.max_uses != null ? Math.max(0, p.max_uses - p.used_count) : null;
    const tl = timeLeft(p.expires_at);
    const paused = p.is_paused && !isExhausted(p);
    return (
      <div
        key={p.id}
        className={
          "flex items-center gap-4 p-4 rounded-2xl transition-colors " +
          (dim
            ? "bg-muted/20 border border-dashed border-border/60 opacity-70"
            : "bg-muted/30 hover:bg-muted/50")
        }
      >
        <div className={"p-2.5 rounded-xl " + (dim ? "bg-muted text-muted-foreground" : "bg-brand-purple/10 text-brand-purple")}>
          <Ticket className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => copyCode(p.code)}
              className="font-mono font-semibold text-sm tracking-wider hover:underline flex items-center gap-1.5"
              title="Скопировать"
            >
              {p.code}
              <Copy className="h-3 w-3 opacity-50" />
            </button>
            {dim && <Badge variant="outline" className="rounded-lg text-xs text-muted-foreground">Исчерпан</Badge>}
            {paused && <Badge variant="outline" className="rounded-lg text-xs text-amber-500 border-amber-500/40">На паузе</Badge>}
            {!dim && !paused && <Badge variant="outline" className="rounded-lg text-xs text-emerald-500 border-emerald-500/30">Активен</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
            <span className="font-medium">{p.reward_pt} PT за активацию</span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <UsersIcon className="h-3 w-3" />
              {p.used_count}{p.max_uses != null ? `/${p.max_uses}` : ""} активаций
              {left != null && !dim && <span className="text-emerald-500">· осталось {left}</span>}
            </span>
            {tl && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {dim ? "срок истёк" : `осталось ${tl}`}
                </span>
              </>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-xl h-8 w-8 opacity-60 hover:opacity-100">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl">
            {!dim && (
              <DropdownMenuItem onClick={() => togglePause(p)}>
                {p.is_paused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                {p.is_paused ? "Возобновить" : "Приостановить"}
              </DropdownMenuItem>
            )}
            {dim && (
              <DropdownMenuItem onClick={() => restart(p)}>
                <RotateCcw className="h-4 w-4 mr-2" /> Перезапустить
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => copyCode(p.code)}>
              <Copy className="h-4 w-4 mr-2" /> Скопировать код
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" /> Удалить
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent className="glass-card border-0">
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить промокод «{p.code}»?</AlertDialogTitle>
                  <AlertDialogDescription>Действие необратимо. Активации сохранятся в истории пользователей.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
                  <AlertDialogAction className="rounded-xl bg-destructive text-destructive-foreground" onClick={() => remove(p)}>
                    Удалить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between p-6 pb-4">
        <div>
          <h2 className="text-lg font-semibold">Промокоды</h2>
          <p className="text-xs text-muted-foreground mt-1">Начисляют PT пользователям при активации в мини-аппе.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setForm(emptyForm); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl gap-2 bg-gradient-to-r from-brand-purple to-brand-blue text-white border-0">
              <Plus className="h-4 w-4" /> Новый промокод
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-card border-0">
            <DialogHeader><DialogTitle>Новый промокод</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Код</Label>
                <Input
                  className="rounded-xl font-mono tracking-wider"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="Любые буквы, цифры, символы"
                  autoFocus
                />
              </div>
              <div>
                <Label>Награда, PT</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="rounded-xl"
                  value={form.reward_pt}
                  onChange={(e) => setForm((f) => ({ ...f, reward_pt: e.target.value }))}
                />
              </div>

              <div className="rounded-xl border p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.limit_uses}
                    onChange={(e) => setForm((f) => ({ ...f, limit_uses: e.target.checked }))}
                  />
                  Лимит активаций
                </label>
                {form.limit_uses && (
                  <Input
                    type="number"
                    min="1"
                    className="rounded-lg"
                    value={form.max_uses}
                    onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                    placeholder="Например, 100"
                  />
                )}
              </div>

              <div className="rounded-xl border p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.limit_time}
                    onChange={(e) => setForm((f) => ({ ...f, limit_time: e.target.checked }))}
                  />
                  Срок действия
                </label>
                {form.limit_time && (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      className="rounded-lg flex-1"
                      value={form.duration_value}
                      onChange={(e) => setForm((f) => ({ ...f, duration_value: e.target.value }))}
                    />
                    <Select value={form.duration_unit} onValueChange={(v) => setForm((f) => ({ ...f, duration_unit: v as DurationUnit }))}>
                      <SelectTrigger className="rounded-lg w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">минут</SelectItem>
                        <SelectItem value="hours">часов</SelectItem>
                        <SelectItem value="days">дней</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Можно выбрать одно из ограничений, оба или ни одного. Если ничего не выбрано — промокод бесконечный (но всё равно <b>1 активация на аккаунт</b>). Одинаковые коды создать нельзя.
              </p>

              <Button onClick={submit} className="w-full rounded-xl bg-gradient-to-r from-brand-purple to-brand-blue text-white">
                Создать
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="px-6 pb-6 space-y-6">
        {loading ? (
          <p className="text-center text-muted-foreground py-8">Загрузка…</p>
        ) : promos.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Промокодов пока нет. Создайте первый.</p>
        ) : (
          <>
            {active.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground px-1">
                  Активные · {active.length}
                </div>
                <div className="space-y-2">{active.map((p) => renderRow(p, false))}</div>
              </div>
            )}
            {exhausted.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground px-1">
                  Исчерпанные · {exhausted.length}
                </div>
                <div className="space-y-2">{exhausted.map((p) => renderRow(p, true))}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
