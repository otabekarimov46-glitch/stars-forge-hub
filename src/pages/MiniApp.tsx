import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, CheckCircle, Loader2, AlertTriangle, Gift, ExternalLink } from "lucide-react";
import logoImg from "@/assets/logo.png";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface VideoAd {
  id: string;
  title: string;
  video_url: string;
  duration_seconds: number;
  reward_pt: number;
  external_link_url?: string;
  external_link_label?: string;
}

async function miniAppApi(action: string, params: Record<string, any> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/miniapp-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

function getTelegramUserId(): number | null {
  try { const tg = (window as any).Telegram?.WebApp; if (tg?.initDataUnsafe?.user?.id) return tg.initDataUnsafe.user.id; } catch {}
  const uid = new URLSearchParams(window.location.search).get("user_id");
  return uid ? parseInt(uid, 10) : null;
}

export default function MiniApp() {
  const telegramId = getTelegramUserId();
  const [video, setVideo] = useState<VideoAd | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "playing" | "completed" | "error" | "no_video" | "bonus">("loading");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [bonusResult, setBonusResult] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadVideo = useCallback(async () => {
    if (!telegramId) { setError("Откройте через Telegram"); setStatus("error"); return; }
    try {
      setStatus("loading");
      const data = await miniAppApi("get_next_video", { telegram_id: telegramId });
      if (!data) { setStatus("no_video"); return; }
      setVideo(data); setStatus("ready");
    } catch (e: any) { setError(e.message); setStatus("error"); }
  }, [telegramId]);

  useEffect(() => { loadVideo(); }, [loadVideo]);

  const claimDailyBonus = async () => {
    if (!telegramId) return;
    try {
      const result = await miniAppApi("claim_daily_bonus", { telegram_id: telegramId });
      setBonusResult(result);
      setStatus("bonus");
    } catch (e: any) { setError(e.message); setStatus("error"); }
  };

  const startWatching = async () => {
    if (!video || !telegramId) return;
    try {
      const data = await miniAppApi("start_view", { telegram_id: telegramId, video_ad_id: video.id });
      setViewId(data.view_id); setStatus("playing"); setElapsed(0);
      videoRef.current?.play();
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          if (next >= video.duration_seconds && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          return next;
        });
      }, 1000);
    } catch (e: any) { setError(e.message); setStatus("error"); }
  };

  const finishWatching = async () => {
    if (!viewId || !telegramId || !video || elapsed < video.duration_seconds) return;
    try {
      await miniAppApi("finish_view", { telegram_id: telegramId, view_id: viewId });
      setStatus("completed");
      if (timerRef.current) clearInterval(timerRef.current);
    } catch (e: any) { setError(e.message); setStatus("error"); }
  };

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const canClose = video ? elapsed >= video.duration_seconds : false;
  const progressPercent = video ? Math.min(100, (elapsed / video.duration_seconds) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#0a2a1f] text-white flex flex-col items-center justify-center p-4">
      <img src={logoImg} alt="StarBot" className="w-20 h-20 rounded-2xl shadow-2xl mb-6" />

      {/* Daily Bonus Button */}
      {status !== "playing" && status !== "bonus" && (
        <Button onClick={claimDailyBonus} className="mb-4 gap-2 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 text-white border-0">
          <Gift className="w-4 h-4" /> Ежедневный бонус
        </Button>
      )}

      <div className="w-full max-w-lg glass-card p-6 space-y-4 text-white" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}>
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-purple-400" />
            <p className="text-gray-300">Загрузка видео...</p>
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="w-10 h-10 text-red-400" />
            <p className="text-red-300">{error}</p>
            <Button variant="outline" onClick={loadVideo} className="rounded-xl border-white/20 text-white">Попробовать снова</Button>
          </div>
        )}
        {status === "bonus" && (
          <div className="flex flex-col items-center gap-4 py-8">
            {bonusResult?.claimed ? (
              <>
                <Gift className="w-14 h-14 text-yellow-400" />
                <h2 className="text-xl font-bold">🎁 Бонус получен!</h2>
                <p className="text-gray-300">+<span className="text-yellow-400 font-bold">{bonusResult.bonus} PT</span></p>
                <p className="text-sm text-gray-400">Баланс: {bonusResult.new_balance?.toFixed(1)} PT</p>
              </>
            ) : (
              <>
                <Gift className="w-14 h-14 text-gray-500" />
                <h2 className="text-xl font-bold">Уже получен</h2>
                <p className="text-gray-400">Следующий через {bonusResult?.hours_left} ч.</p>
              </>
            )}
            <Button onClick={() => { setBonusResult(null); loadVideo(); }} variant="outline" className="rounded-xl border-white/20 text-white">К видео</Button>
          </div>
        )}
        {status === "no_video" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <CheckCircle className="w-10 h-10 text-green-400" />
            <p className="text-gray-300 text-center">Нет доступных видео. Попробуйте позже!</p>
          </div>
        )}
        {status === "ready" && video && (
          <div className="flex flex-col items-center gap-4 py-6">
            <h2 className="text-xl font-bold text-center">{video.title}</h2>
            <p className="text-gray-400 text-sm text-center">
              Посмотрите видео ({video.duration_seconds} сек.) и получите <span className="text-yellow-400 font-bold">{video.reward_pt} PT</span>
            </p>
            <Button onClick={startWatching} className="gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0">
              <Play className="w-4 h-4" /> Смотреть
            </Button>
          </div>
        )}
        {status === "playing" && video && (
          <div className="space-y-4">
            <video ref={videoRef} src={video.video_url} className="w-full rounded-xl aspect-video bg-black" playsInline autoPlay />
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-400"><span>{elapsed}с</span><span>{video.duration_seconds}с</span></div>
              <Progress value={progressPercent} className="h-2" />
            </div>
            {canClose ? (
              <Button onClick={finishWatching} className="w-full gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0">
                <CheckCircle className="w-4 h-4" /> Получить {video.reward_pt} PT
              </Button>
            ) : (
              <Button disabled className="w-full gap-2 rounded-xl" variant="outline">Досмотрите видео</Button>
            )}
          </div>
        )}
        {status === "completed" && video && (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle className="w-14 h-14 text-green-400" />
            <h2 className="text-xl font-bold">Готово!</h2>
            <p className="text-gray-300 text-center">Вам начислено <span className="text-yellow-400 font-bold">{video.reward_pt} PT</span></p>
            {video.external_link_url && (
              <a href={video.external_link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium">
                <ExternalLink className="w-4 h-4" /> {video.external_link_label || "Перейти"}
              </a>
            )}
            <Button onClick={() => { setVideo(null); setViewId(null); setElapsed(0); loadVideo(); }} variant="outline" className="rounded-xl border-white/20 text-white">Следующее видео</Button>
          </div>
        )}
      </div>
    </div>
  );
}
