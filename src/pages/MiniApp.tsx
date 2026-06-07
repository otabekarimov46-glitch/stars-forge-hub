import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { Play, CheckCircle, Loader2, AlertTriangle, Gift, ExternalLink, ShieldAlert, Wallet, Clock } from "lucide-react";
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
interface UserSnap {
  balance_pt: number;
  daily_bonus_at: string | null;
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

function getTelegramUser(): { id: number | null; photo: string | null; name: string | null } {
  try {
    const u = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
    if (u?.id) return { id: u.id, photo: u.photo_url || null, name: u.first_name || u.username || null };
  } catch {}
  const uid = new URLSearchParams(window.location.search).get("user_id");
  return { id: uid ? parseInt(uid, 10) : null, photo: null, name: null };
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export default function MiniApp() {
  const tgUser = useMemo(getTelegramUser, []);
  const telegramId = tgUser.id;

  const [video, setVideo] = useState<VideoAd | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "playing" | "completed" | "error" | "no_video" | "locked">("loading");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [user, setUser] = useState<UserSnap | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [bonusToast, setBonusToast] = useState<{ kind: "got" | "wait"; bonus?: number; hours?: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ctaOffset, setCtaOffset] = useState({ x: 0, y: 0 });
  // Set right after a video finishes — shown in the completed screen
  const [lastFinished, setLastFinished] = useState<{ video: VideoAd; reward: number } | null>(null);
  const [nextVideo, setNextVideo] = useState<VideoAd | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);
  const sessionSecretRef = useRef<string | null>(null);
  const checkpointTimesRef = useRef<number[]>([]);
  const checkpointSentRef = useRef<number>(0);

  // Telegram WebApp init
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    try {
      tg.ready(); tg.expand();
      tg.disableVerticalSwipes?.();
      tg.setHeaderColor?.("#0b0820");
      tg.setBackgroundColor?.("#0b0820");
    } catch {}
  }, []);

  // 1-second tick for bonus countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Anti-clicker
  const reportSuspicious = useCallback(async () => {
    if (!telegramId) return;
    try { await miniAppApi("report_suspicious_click", { telegram_id: telegramId }); } catch {}
    setStatus("locked");
    try { videoRef.current?.pause(); } catch {}
  }, [telegramId]);
  useAntiClicker(reportSuspicious, status !== "locked");

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (video && next >= video.duration_seconds && timerRef.current) {
          clearInterval(timerRef.current); timerRef.current = null;
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
      if (data?.user) setUser(data.user);
      if (!data?.video) { setStatus("no_video"); return; }
      setVideo(data.video);
      setPosterUrl(null);
      setStatus("ready");
    } catch (e: any) {
      if (/заблокирован/i.test(e.message) || /captcha/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  }, [telegramId]);
  useEffect(() => { loadVideo(); }, [loadVideo]);

  // First-frame poster
  useEffect(() => {
    if (!video || video.media_type === "image") { setPosterUrl(null); return; }
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous"; v.muted = true; v.preload = "auto"; v.src = video.video_url;
    const onSeeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
        const ctx = c.getContext("2d");
        if (ctx) { ctx.drawImage(v, 0, 0, c.width, c.height); if (!cancelled) setPosterUrl(c.toDataURL("image/jpeg", 0.6)); }
      } catch {}
    };
    const onMeta = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch {} };
    v.addEventListener("loadedmetadata", onMeta); v.addEventListener("seeked", onSeeked);
    return () => { cancelled = true; v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("seeked", onSeeked); v.src = ""; };
  }, [video]);

  // Pause when hidden
  useEffect(() => {
    if (status !== "playing") return;
    const onVis = () => {
      if (document.hidden) { videoRef.current?.pause(); stopTimer(); }
      else if (video && elapsed < video.duration_seconds) {
        videoRef.current?.play().catch(() => {}); startTimer();
      }
    };
    const onBlur = () => { videoRef.current?.pause(); stopTimer(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("blur", onBlur); };
  }, [status, video, elapsed, startTimer, stopTimer]);

  const claimDailyBonus = async () => {
    if (!telegramId) return;
    try {
      const r = await miniAppApi("claim_daily_bonus", { telegram_id: telegramId });
      if (r.claimed) {
        setBonusToast({ kind: "got", bonus: r.bonus });
        setUser((u) => u ? { ...u, balance_pt: r.new_balance, daily_bonus_at: new Date().toISOString() } : u);
      } else {
        setBonusToast({ kind: "wait", hours: r.hours_left });
      }
      setTimeout(() => setBonusToast(null), 3500);
    } catch (e: any) {
      if (/captcha|заблокир/i.test(e.message)) setStatus("locked");
    }
  };

  const startWatching = async () => {
    if (!video || !telegramId) return;
    try {
      const data = await miniAppApi("start_view", { telegram_id: telegramId, video_ad_id: video.id });
      setViewId(data.view_id);
      sessionSecretRef.current = data.session_secret || null;
      checkpointTimesRef.current = Array.isArray(data.checkpoint_times) ? data.checkpoint_times : [];
      checkpointSentRef.current = 0;
      setStatus("playing"); setElapsed(0); finishedRef.current = false;
      if (video.media_type !== "image") videoRef.current?.play().catch(() => {});
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
      const res = await miniAppApi("finish_view", {
        telegram_id: telegramId, view_id: viewId, session_secret: sessionSecretRef.current,
      });
      if (res?.locked) { setStatus("locked"); return; }
      stopTimer();
      // Update balance
      if (typeof res?.new_balance === "number") {
        setUser((u) => u ? { ...u, balance_pt: res.new_balance } : u);
      }
      // Jitter CTA position so autoclickers can't memorise coords
      setCtaOffset({
        x: Math.round((Math.random() - 0.5) * 24),
        y: Math.round((Math.random() - 0.5) * 14),
      });
      // Remember just-finished ad (for "Перейти" link) and pre-load next
      setLastFinished({ video, reward: res?.amount ?? video.reward_pt });
      setNextVideo(res?.next_video || null);
      setStatus("completed");
    } catch (e: any) {
      if (/captcha|заблокир/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  };

  const watchNext = async () => {
    if (!nextVideo) { loadVideo(); return; }
    setVideo(nextVideo); setNextVideo(null); setPosterUrl(null);
    setViewId(null); setElapsed(0); finishedRef.current = false;
    setLastFinished(null);
    // small extra jitter every cycle
    setCtaOffset({
      x: Math.round((Math.random() - 0.5) * 24),
      y: Math.round((Math.random() - 0.5) * 14),
    });
    setStatus("ready");
  };

  // Fire dynamic checkpoints
  useEffect(() => {
    if (status !== "playing" || !viewId || !telegramId) return;
    const times = checkpointTimesRef.current;
    while (checkpointSentRef.current < times.length && elapsed >= times[checkpointSentRef.current]) {
      const index = checkpointSentRef.current; checkpointSentRef.current += 1;
      miniAppApi("checkpoint", {
        telegram_id: telegramId, view_id: viewId,
        session_secret: sessionSecretRef.current, index,
      }).catch(() => {});
    }
  }, [elapsed, status, viewId, telegramId]);

  useEffect(() => {
    if (status === "playing" && video && elapsed >= video.duration_seconds && !finishedRef.current) finishWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, status, video]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  // Daily-bonus state
  const bonusReadyAt = user?.daily_bonus_at ? new Date(user.daily_bonus_at).getTime() + 24 * 3600 * 1000 : 0;
  const bonusCountdownMs = Math.max(0, bonusReadyAt - now);
  const bonusClaimed = bonusReadyAt > now;

  const progressPercent = video ? Math.min(100, (elapsed / video.duration_seconds) * 100) : 0;

  // ===== Locked screen (no chat-open button — it never worked) =====
  if (status === "locked") {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#0a2a1f] text-white flex items-center justify-center p-6 z-50 fade-in">
        <div className="max-w-sm w-full rounded-3xl p-8 text-center space-y-3 screen-enter"
             style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(20px)" }}>
          <ShieldAlert className="w-14 h-14 mx-auto text-yellow-400" />
          <h2 className="text-xl font-bold">Подтвердите, что вы человек</h2>
          <p className="text-sm text-white/85">
            Откройте чат с ботом и решите простой пример, чтобы продолжить.
          </p>
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
              ref={videoRef} src={video.video_url} poster={posterUrl || undefined}
              className="max-w-full max-h-full" playsInline autoPlay preload="auto"
              controls={false} disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
        </div>
        <div className="p-4 bg-black/80 backdrop-blur space-y-2">
          <div className="flex justify-between text-xs text-white">
            <span>{elapsed}с / {video.duration_seconds}с</span>
            <span className="text-yellow-300">+{video.reward_pt} PT</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
          <p className="text-center text-[11px] text-white/70">Не закрывайте — иначе просмотр не засчитается</p>
        </div>
      </div>
    );
  }

  // ===== Home =====
  const initial = (tgUser.name || "U").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen text-white flex flex-col fade-in"
         style={{ background: "radial-gradient(120% 80% at 50% 0%, #1a0a3a 0%, #0b0820 55%, #050314 100%)" }}>

      {/* ===== Header ===== */}
      <header className="px-4 pt-5 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src={logoImg} alt="" className="w-9 h-9 rounded-xl shadow-lg shrink-0" />
          <span className="font-semibold text-[17px] tracking-tight truncate">Starment</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-white/15 shadow-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm font-semibold">
            {tgUser.photo ? (
              <img src={tgUser.photo} alt="" className="w-full h-full object-cover" />
            ) : (initial)}
          </div>
          <div className="flex items-center gap-1.5 px-3 h-9 rounded-full"
               style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(14px)" }}>
            <Wallet className="w-3.5 h-3.5 text-white/75" />
            <span className="font-semibold tabular-nums text-[14px]">
              {user ? user.balance_pt.toFixed(1) : "…"}
            </span>
            <span className="text-[11px] text-white/60">PT</span>
          </div>
        </div>
      </header>

      {/* ===== Daily bonus ===== */}
      <section className="px-4 mt-2">
        <button
          onClick={() => { if (!bonusClaimed) claimDailyBonus(); else setBonusToast({ kind: "wait", hours: Math.ceil(bonusCountdownMs / 3600000) }); }}
          className="press w-full rounded-2xl p-3.5 flex items-center gap-3 text-left"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(14px)" }}
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400/90 to-orange-500/90 flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
            <Gift className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold tracking-wide text-white/90">DAILY BONUS</div>
            <div className="text-[12px] text-white/60 flex items-center gap-1.5 tabular-nums">
              <Clock className="w-3 h-3" />
              {bonusClaimed ? formatCountdown(bonusCountdownMs) : "Доступен"}
            </div>
          </div>
          <span className={"px-3 h-7 inline-flex items-center rounded-full text-[11px] font-semibold tracking-wide " +
            (bonusClaimed
              ? "bg-emerald-400/15 text-emerald-300 border border-emerald-400/30"
              : "bg-gradient-to-r from-yellow-400 to-orange-500 text-black")}>
            {bonusClaimed ? "CLAIMED" : "ПОЛУЧИТЬ"}
          </span>
        </button>

        {bonusToast && (
          <div className="mt-2 text-center text-[12px] text-white/75 fade-in">
            {bonusToast.kind === "got"
              ? <>🎁 +<span className="text-yellow-300 font-semibold">{bonusToast.bonus} PT</span> зачислено</>
              : <>Уже получен. Следующий через ~{bonusToast.hours} ч.</>}
          </div>
        )}
      </section>

      {/* ===== Main content ===== */}
      <main className="flex-1 px-4 pt-5 pb-8 flex flex-col">
        {status === "loading" && (
          <div className="m-auto flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-9 h-9 animate-spin text-purple-300" />
            <p className="text-white/80 text-sm">Загрузка...</p>
          </div>
        )}

        {status === "error" && (
          <div className="m-auto flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="w-10 h-10 text-red-400" />
            <p className="text-red-200 text-sm">{error}</p>
            <button onClick={loadVideo}
              className="press mt-1 px-5 h-10 rounded-xl border border-white/15 bg-white/5 text-sm">
              Попробовать снова
            </button>
          </div>
        )}

        {status === "no_video" && (
          <div className="m-auto flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-300" />
            <p className="text-white/80 text-sm">Новых видео пока нет. Загляните чуть позже.</p>
            <button onClick={loadVideo}
              className="press mt-1 px-5 h-10 rounded-xl border border-white/15 bg-white/5 text-sm">
              Обновить
            </button>
          </div>
        )}

        {status === "ready" && video && (
          <div key={video.id} className="w-full max-w-md mx-auto screen-enter">
            <div className="rounded-3xl overflow-hidden"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(16px)" }}>
              {/* Cover */}
              <div className="relative aspect-video bg-black/40 overflow-hidden">
                {posterUrl || video.media_type === "image" ? (
                  <img src={posterUrl || video.video_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-900/40 to-blue-900/40" />
                )}
                {/* Reward chip */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-2xl shadow-purple-900/40 font-bold text-lg tabular-nums">
                  +{video.reward_pt} PT
                </div>
                {/* Duration chip */}
                <div className="absolute right-2 bottom-2 px-2.5 py-1 rounded-full text-[11px] bg-black/60 backdrop-blur tabular-nums flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {video.duration_seconds}с
                </div>
                {/* Aspect chip */}
                <div className="absolute left-2 top-2 px-2 py-0.5 rounded-md text-[10px] bg-black/55 backdrop-blur">16:9</div>
              </div>

              {/* Body */}
              <div className="p-4 space-y-3.5">
                <h2 className="text-[15px] font-medium text-center text-white/95 leading-snug">{video.title}</h2>

                <button
                  onClick={startWatching}
                  style={{ transform: `translate(${ctaOffset.x}px, ${ctaOffset.y}px)` }}
                  className="press w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                    bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500
                    shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" /> СМОТРЕТЬ
                </button>

              </div>
            </div>
          </div>
        )}

        {status === "completed" && lastFinished && (
          <div className="w-full max-w-md mx-auto screen-enter">
            <div className="rounded-3xl overflow-hidden text-center"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(16px)" }}>
              <div className="px-6 pt-6 pb-2 flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-emerald-300" />
                </div>
                <div className="text-[15px] text-white/90">Видео просмотрено</div>
                <div className="text-2xl font-bold tabular-nums">
                  +<span className="text-yellow-300">{lastFinished.reward} PT</span>
                </div>
                {user && (
                  <div className="text-[12px] text-white/55 tabular-nums">
                    Баланс: {user.balance_pt.toFixed(1)} PT
                  </div>
                )}
              </div>

              <div className="p-4 space-y-3">
                <button
                  onClick={watchNext}
                  style={{ transform: `translate(${ctaOffset.x}px, ${ctaOffset.y}px)` }}
                  className="press w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                    bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500
                    shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  {nextVideo ? "СМОТРЕТЬ СЛЕДУЮЩЕЕ" : "ОБНОВИТЬ"}
                </button>

                {lastFinished.video.external_link_url && (
                  <a href={lastFinished.video.external_link_url} target="_blank" rel="noopener noreferrer"
                     className="press-soft mx-auto inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-[12px] text-white/85 border border-white/10 bg-white/5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    {lastFinished.video.external_link_label || "Перейти к рекламодателю"}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
