import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Sun, Moon } from "lucide-react";

export default function SettingsPage() {
  const { t, lang, setLang } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi("get_settings")
      .then((data: any[]) => {
        const map: Record<string, string> = {};
        data?.forEach((s) => (map[s.key] = s.value));
        setSettings(map);
      })
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const saveSetting = async (key: string) => {
    try {
      await adminApi("update_setting", { key, value: settings[key] });
      toast.success(`${key} ${t("settings.saved")}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-lg space-y-6">
      {/* Theme */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-semibold">{t("settings.theme")}</h3>
        <div className="flex gap-3">
          <Button
            variant={theme === "light" ? "default" : "outline"}
            className="rounded-xl gap-2 flex-1"
            onClick={() => setTheme("light")}
          >
            <Sun className="h-4 w-4" /> {t("settings.light")}
          </Button>
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            className="rounded-xl gap-2 flex-1"
            onClick={() => setTheme("dark")}
          >
            <Moon className="h-4 w-4" /> {t("settings.dark")}
          </Button>
        </div>
      </div>

      {/* Language */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-semibold">{t("settings.language")}</h3>
        <div className="flex gap-3">
          <Button
            variant={lang === "ru" ? "default" : "outline"}
            className="rounded-xl gap-2 flex-1"
            onClick={() => setLang("ru")}
          >
            🇷🇺 Русский
          </Button>
          <Button
            variant={lang === "en" ? "default" : "outline"}
            className="rounded-xl gap-2 flex-1"
            onClick={() => setLang("en")}
          >
            🇬🇧 English
          </Button>
        </div>
      </div>

      {/* Exchange Rate */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-semibold">{t("settings.exchangeRate")}</h3>
        <div>
          <Label>{t("settings.exchangeLabel")}</Label>
          <div className="flex gap-2 mt-2">
            <Input
              className="rounded-xl"
              type="number"
              step="0.01"
              value={settings.exchange_rate || "1"}
              onChange={(e) => setSettings((s) => ({ ...s, exchange_rate: e.target.value }))}
            />
            <Button
              className="rounded-xl gap-2 bg-gradient-to-r from-brand-purple to-brand-blue text-white"
              onClick={() => saveSetting("exchange_rate")}
            >
              <Save className="h-4 w-4" /> {t("common.save")}
            </Button>
          </div>
        </div>
      </div>

      {/* Subscription re-check */}
      <SubRecheckCard
        value={settings.sub_recheck_minutes ?? "60"}
        onChange={(v) => setSettings((s) => ({ ...s, sub_recheck_minutes: v }))}
        onSave={() => saveSetting("sub_recheck_minutes")}
      />
    </div>
  );
}

function SubRecheckCard({
  value, onChange, onSave,
}: { value: string; onChange: (v: string) => void; onSave: () => void }) {
  const minutes = Math.max(0, Math.floor(Number(value || "0")));
  // If divisible by 60, treat as hours by default; else minutes.
  const initialUnit: "m" | "h" = minutes > 0 && minutes % 60 === 0 ? "h" : "m";
  const [unit, setUnit] = useState<"m" | "h">(initialUnit);
  const displayVal = useMemo(() => {
    if (minutes === 0) return "0";
    return unit === "h" ? String(minutes / 60) : String(minutes);
  }, [minutes, unit]);

  const setDisplay = (v: string) => {
    const n = Math.max(0, Math.floor(Number(v || "0")));
    const asMin = unit === "h" ? n * 60 : n;
    onChange(String(asMin));
  };

  const disabled = minutes === 0;

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h3 className="font-semibold">Проверка отписки от каналов</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            После выполнения задания на подписку через указанное время бот в фоне проверит,
            остался ли пользователь подписанным. Если отписался — PT спишутся,
            задание вернётся в список с красной рамкой. <b>0 = проверку не проводить.</b>
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          className="rounded-xl"
          type="number"
          min={0}
          step={1}
          value={displayVal}
          onChange={(e) => setDisplay(e.target.value)}
        />
        <div className="flex rounded-xl overflow-hidden border">
          <button
            type="button"
            onClick={() => setUnit("m")}
            className={"px-3 text-sm " + (unit === "m" ? "bg-primary text-primary-foreground" : "bg-transparent")}
          >
            мин
          </button>
          <button
            type="button"
            onClick={() => setUnit("h")}
            className={"px-3 text-sm " + (unit === "h" ? "bg-primary text-primary-foreground" : "bg-transparent")}
          >
            ч
          </button>
        </div>
        <Button
          className="rounded-xl gap-2 bg-gradient-to-r from-brand-purple to-brand-blue text-white"
          onClick={onSave}
        >
          <Save className="h-4 w-4" /> Сохранить
        </Button>
      </div>

      <div className={"text-xs " + (disabled ? "text-amber-500" : "text-muted-foreground")}>
        {disabled
          ? "Проверка отключена — подписки не перепроверяются."
          : `Проверка запустится через ${minutes} мин (${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 2)} ч) после засчитанной подписки.`}
      </div>
    </div>
  );
}
