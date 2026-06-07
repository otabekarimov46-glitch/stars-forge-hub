import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, CheckCircle, Loader2, AlertTriangle, Gift, ExternalLink, ShieldAlert } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { useAntiClicker } from "@/hooks/use-anti-clicker";

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
  media_type?: "video" | "image";
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
  const [status, setStatus] = useState<"loading" | "ready" | "playing" | "completed" | "error" | "no_video" | "bonus" | "locked">("loading");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [bonusResult, setBonusResult] = useState<any>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);

  // ===== Telegram WebApp init =====
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      tg.disableVerticalSwipes?.();
      tg.requestFullscreen?.();
      tg.setHeaderColor?.("#000000");
      tg.setBackgroundColor?.("#000000");
    } catch {}
  }, []);

  // ===== Anti-clicker =====
  const reportSuspicious = useCallback(async () => {
    if (!telegramId) return;
    try { await miniAppApi("report_suspicious_click", { telegram_id: telegramId }); } catch {}
    setStatus("locked");
    try { videoRef.current?.pause(); } catch {}
  }, [telegramId]);
  useAntiClicker(reportSuspicious, status !== "locked");

  // ===== Timer =====
  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (video && next >= video.duration_seconds && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return next;
      });
    }, 1000);
  }, [video]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const loadVideo = useCallback(async () => {
    if (!telegramId) { setError("Откройте через Telegram"); setStatus("error"); return; }
    try {
      setStatus("loading");
      const data = await miniAppApi("get_next_video", { telegram_id: telegramId });
      if (data?.locked) { setStatus("locked"); return; }
      if (!data) { setStatus("no_video"); return; }
      setVideo(data);
      setPosterUrl(null);
      setStatus("ready");
    } catch (e: any) {
      if (/заблокирован/i.test(e.message) || /captcha/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  }, [telegramId]);

  useEffect(() => { loadVideo(); }, [loadVideo]);

  // Generate poster (first frame) for video — kills the black screen on start
  useEffect(() => {
    if (!video || video.media_type === "image") { setPosterUrl(null); return; }
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.src = video.video_url;
    const onSeeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640;
        c.height = v.videoHeight || 360;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          if (!cancelled) setPosterUrl(c.toDataURL("image/jpeg", 0.6));
        }
      } catch {}
    };
    const onMeta = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch {} };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("seeked", onSeeked);
    return () => { cancelled = true; v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("seeked", onSeeked); v.src = ""; };
  }, [video]);

  // Pause/resume when Telegram is minimized / tab hidden / out of focus
  useEffect(() => {
    if (status !== "playing") return;
    const onVisibility = () => {
      if (document.hidden) {
        videoRef.current?.pause(); stopTimer();
      } else {
        if (video && elapsed < video.duration_seconds) {
          videoRef.current?.play().catch(() => {});
          startTimer();
        }
      }
    };
    const onBlur = () => { videoRef.current?.pause(); stopTimer(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [status, video, elapsed, startTimer, stopTimer]);

  useEffect(() => {
    if (status !== "playing") return;
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!finishedRef.current) { e.preventDefault(); e.returnValue = "Просмотр не засчитан, если закрыть сейчас"; }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [status]);

  const claimDailyBonus = async () => {
    if (!telegramId) return;
    try {
      const result = await miniAppApi("claim_daily_bonus", { telegram_id: telegramId });
      setBonusResult(result); setStatus("bonus");
    } catch (e: any) {
      if (/captcha|заблокир/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  };

  const startWatching = async () => {
    if (!video || !telegramId) return;
    try {
      const data = await miniAppApi("start_view", { telegram_id: telegramId, video_ad_id: video.id });
      setViewId(data.view_id); setStatus("playing"); setElapsed(0); finishedRef.current = false;
      if (video.media_type !== "image") {
        videoRef.current?.play().catch(() => {});
      }
      startTimer();
    } catch (e: any) {
      if (/captcha|заблокир/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  };

  const finishWatching = async () => {
    if (!viewId || !telegramId || !video || elapsed < video.duration_seconds) return;
    try {
      finishedRef.current = true;
      await miniAppApi("finish_view", { telegram_id: telegramId, view_id: viewId });
      setStatus("completed"); stopTimer();
    } catch (e: any) {
      if (/captcha|заблокир/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  };

  useEffect(() => {
    if (status === "playing" && video && elapsed >= video.duration_seconds && !finishedRef.current) finishWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, status, video]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const closeApp = () => { try { (window as any).Telegram?.WebApp?.close?.(); } catch {} };

  const progressPercent = video ? Math.min(100, (elapsed / video.duration_seconds) * 100) : 0;

  // ===== Locked / suspicious screen =====
  if (status === "locked") {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#0a2a1f] text-white flex items-center justify-center p-6 z-50 fade-in">
        <div className="max-w-sm w-full rounded-3xl p-8 text-center space-y-4 screen-enter"
             style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(20px)" }}>
          <ShieldAlert className="w-14 h-14 mx-auto text-yellow-400" />
          <h2 className="text-xl font-bold text-readable">Подтвердите, что вы человек</h2>
          <p className="text-sm text-white/90 text-readable-soft">
            Перейдите в чат бота и решите простой пример, чтобы продолжить.
          </p>
          <Button onClick={closeApp} className="rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 text-white border-0">Открыть чат</Button>
        </div>
      </div>
    );
  }

  // ===== Fullscreen player =====
  if (status === "playing" && video) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col z-50 fade-in">
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {video.media_type === "image" ? (
            <img src={video.video_url} alt={video.title} className="max-w-full max-h-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              src={video.video_url}
              poster={posterUrl || undefined}
              className="max-w-full max-h-full"
              playsInline
              autoPlay
              preload="auto"
              controls={false}
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
        </div>
        <div className="p-4 bg-black/80 backdrop-blur space-y-2">
          <div className="flex justify-between text-xs text-white text-readable-soft">
            <span>{elapsed}с / {video.duration_seconds}с</span>
            <span className="text-yellow-300">+{video.reward_pt} PT</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
          <p className="text-center text-[11px] text-white/85 text-readable-soft">Не закрывайте, иначе просмотр не засчитается</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#0a2a1f] text-white flex flex-col items-center justify-center p-4 fade-in">
      <img src={logoImg} alt="Starment" className="w-20 h-20 rounded-2xl shadow-2xl mb-6" />

      {status !== "bonus" && (
        <Button onClick={claimDailyBonus} className="mb-4 gap-2 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 text-white border-0">
          <Gift className="w-4 h-4" /> Ежедневный бонус
        </Button>
      )}

      <div key={status} className="w-full max-w-lg glass-card p-6 space-y-4 text-white screen-enter" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}>
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-purple-300" />
            <p className="text-white/90 text-readable-soft">Загрузка...</p>
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="w-10 h-10 text-red-400" />
            <p className="text-red-200 text-readable-soft">{error}</p>
            <Button variant="outline" onClick={loadVideo} className="rounded-xl border-white/20 text-white">Попробовать снова</Button>
          </div>
        )}
        {status === "bonus" && (
          <div className="flex flex-col items-center gap-4 py-8">
            {bonusResult?.claimed ? (
              <>
                <Gift className="w-14 h-14 text-yellow-300" />
                <h2 className="text-xl font-bold text-readable">🎁 Бонус получен!</h2>
                <p className="text-white text-readable-soft">+<span className="text-yellow-300 font-bold">{bonusResult.bonus} PT</span></p>
                <p className="text-sm text-white/85 text-readable-soft">Баланс: {bonusResult.new_balance?.toFixed(1)} PT</p>
              </>
            ) : (
              <>
                <Gift className="w-14 h-14 text-white/50" />
                <h2 className="text-xl font-bold text-readable">Уже получен</h2>
                <p className="text-white/85 text-readable-soft">Следующий через {bonusResult?.hours_left} ч.</p>
              </>
            )}
            <Button onClick={() => { setBonusResult(null); loadVideo(); }} variant="outline" className="rounded-xl border-white/20 text-white">К видео</Button>
          </div>
        )}
        {status === "no_video" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <CheckCircle className="w-10 h-10 text-green-300" />
            <p className="text-white/90 text-center text-readable-soft">Нет доступных видео. Попробуйте позже!</p>
          </div>
        )}
        {status === "ready" && video && (
          <div className="flex flex-col items-center gap-4 py-6">
            <h2 className="text-xl font-bold text-center text-readable">{video.title}</h2>
            <p className="text-white/85 text-sm text-center text-readable-soft">
              {video.media_type === "image" ? "Посмотрите" : "Посмотрите видео"} ({video.duration_seconds} сек.) и получите <span className="text-yellow-300 font-bold">{video.reward_pt} PT</span>
            </p>
            {posterUrl && video.media_type !== "image" && (
              <img src={posterUrl} alt="" className="rounded-xl max-h-40 object-contain opacity-90" />
            )}
            <Button onClick={startWatching} className="gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0">
              <Play className="w-4 h-4" /> Смотреть
            </Button>
          </div>
        )}
        {status === "completed" && video && (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle className="w-14 h-14 text-green-300" />
            <h2 className="text-xl font-bold text-readable">Видео просмотрено!</h2>
            <p className="text-white text-center text-readable-soft">Вам начислено <span className="text-yellow-300 font-bold">+{video.reward_pt} PT</span></p>
            {video.external_link_url && (
              <a href={video.external_link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium">
                <ExternalLink className="w-4 h-4" /> {video.external_link_label || "Перейти"}
              </a>
            )}
            <div className="flex gap-2 flex-wrap justify-center">
              <Button onClick={() => { setVideo(null); setViewId(null); setElapsed(0); loadVideo(); }} variant="outline" className="rounded-xl border-white/20 text-white">Следующее</Button>
              <Button onClick={closeApp} className="rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0">Вернуться в чат</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
