import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Sun, Moon, ShieldCheck } from "lucide-react";

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
    </div>
  );
}
