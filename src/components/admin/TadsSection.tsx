import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Megaphone, Hash, Copy, Play, Pause, Coins, Users as UsersIcon, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";

interface WindowStats {
  views: number;
  spent_pt: number;
  users: number;
}

interface TadsData {
  advertiser: { id: string; name: string; public_id: string | null } | null;
  settings: { reward_pt: number; paused: boolean; widget_id: string };
  stats: { day: WindowStats; week: WindowStats; month: WindowStats; all: WindowStats };
}

const EMPTY: WindowStats = { views: 0, spent_pt: 0, users: 0 };

export default function TadsSection({
  advertiser,
  onBack,
}: {
  advertiser: any;
  onBack: () => void;
}) {
  const { tr } = useTranslation();
  const [data, setData] = useState<TadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reward, setReward] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await adminApi("get_tads");
      setData(d);
      setReward(String(d?.settings?.reward_pt ?? ""));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveReward = async () => {
    const v = Number(String(reward).replace(",", "."));
    if (!Number.isFinite(v) || v < 0) {
      toast.error(tr("Некорректная цена за просмотр"));
      return;
    }
    setSaving(true);
    try {
      await adminApi("update_tads_settings", { reward_pt: v });
      toast.success(tr("Цена за просмотр обновлена"));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePaused = async (paused: boolean) => {
    setSaving(true);
    try {
      await adminApi("update_tads_settings", { paused });
      toast.success(paused ? tr("Реклама TADS приостановлена") : tr("Реклама TADS активна"));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const paused = !!data?.settings?.paused;
  const periods: Array<{ key: keyof TadsData["stats"]; label: string }> = [
    { key: "day", label: "За день" },
    { key: "week", label: "За неделю" },
    { key: "month", label: "За месяц" },
    { key: "all", label: "За всё время" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={onBack}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-500 shrink-0">
          <Megaphone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold truncate">TADS</h2>
            <Badge
              variant="outline"
              className={`rounded-lg text-[10px] px-1.5 py-0 ${
                paused
                  ? "bg-muted text-muted-foreground"
                  : "bg-emerald-500/10 text-emerald-500 border-emerald-500/25"
              }`}
            >
              {paused ? tr("Приостановлена") : tr("Активна")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Hash className="h-3 w-3" />
            <span className="font-mono">Widget {data?.settings?.widget_id || "—"}</span>
            {advertiser?.public_id && (
              <>
                <span>·</span>
                <span className="font-mono">{advertiser.public_id}</span>
                <button
                  className="p-1 rounded hover:bg-muted"
                  onClick={() => { navigator.clipboard.writeText(advertiser.public_id); toast.success(tr("ID скопирован")); }}
                >
                  <Copy className="h-3 w-3" />
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {tr("Встроенная рекламная сеть. Показывается в Mini App вперемешку с обычной видеорекламой: одно обычное видео, одна реклама TADS.")}
      </p>

      {/* Settings */}
      <div className="rounded-2xl bg-muted/30 p-4 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <Label className="text-sm font-medium">{tr("Показывать рекламу TADS")}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tr("Если выключить, плашка TADS исчезнет из Mini App и награды начисляться не будут.")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {paused ? <Pause className="h-4 w-4 text-muted-foreground" /> : <Play className="h-4 w-4 text-emerald-500" />}
            <Switch checked={!paused} disabled={saving || loading} onCheckedChange={(v) => togglePaused(!v)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{tr("Цена за просмотр (PT)")}</Label>
          <div className="flex items-center gap-2">
            <Input
              className="rounded-xl max-w-[180px]"
              type="number"
              step="0.01"
              min="0"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              placeholder="0.5"
            />
            <Button className="rounded-xl" disabled={saving || loading} onClick={saveReward}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : tr("Сохранить")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("Сколько PT получает пользователь за один просмотр рекламы TADS.")}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-sm font-semibold mb-3">{tr("Статистика TADS")}</h3>
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {periods.map((p) => {
              const s = data?.stats?.[p.key] || EMPTY;
              return (
                <div key={p.key} className="rounded-2xl bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{tr(p.label)}</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Eye className="h-4 w-4 text-violet-500" />
                      <span className="font-semibold">{s.views}</span>
                      <span className="text-muted-foreground text-xs">{tr("просмотров")}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Coins className="h-4 w-4 text-brand-gold" />
                      <span className="font-semibold">{s.spent_pt}</span>
                      <span className="text-muted-foreground text-xs">PT</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <UsersIcon className="h-4 w-4 text-brand-blue" />
                      <span className="font-semibold">{s.users}</span>
                      <span className="text-muted-foreground text-xs">{tr("пользователей")}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
