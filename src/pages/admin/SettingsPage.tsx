import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save } from "lucide-react";

export default function SettingsPage() {
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
      toast.success(`${key} сохранён`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) return <div className="text-muted-foreground">Загрузка...</div>;

  return (
    <div className="max-w-lg space-y-6">
      <Card>
        <CardHeader><CardTitle>Курс обмена</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>EXCHANGE_RATE (1 PT = X ⭐)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="number"
                step="0.01"
                value={settings.exchange_rate || "1"}
                onChange={(e) => setSettings((s) => ({ ...s, exchange_rate: e.target.value }))}
              />
              <Button onClick={() => saveSetting("exchange_rate")}>
                <Save className="h-4 w-4 mr-1" /> Сохранить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
