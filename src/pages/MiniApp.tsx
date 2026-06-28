import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Drawer as Vaul } from "vaul";
import { Progress } from "@/components/ui/progress";
import { Play, CheckCircle, Loader2, AlertTriangle, Gift, ExternalLink, ShieldAlert, Wallet, Clock, XCircle, Send, ClipboardList, Newspaper, Camera, ChevronRight, X, ClipboardCheck, BarChart3, Gamepad2, Home, User, Star, Sparkles, Inbox } from "lucide-react";
import logoImg from "@/assets/starment-logo.png";
import starIcon from "@/assets/starment-star.png";
import { useAntiClicker } from "@/hooks/use-anti-clicker";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface BotTask {
  id: string;
  type: string;
  title?: string | null;
  channel_username?: string | null;
  post_url?: string | null;
  reward_pt: number;
}

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
  return { id: null, photo: null, name: null };
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
  const [status, setStatus] = useState<"loading" | "ready" | "playing" | "completed" | "error" | "no_video" | "locked" | "limit" | "no_telegram">("loading");
  const [error, setError] = useState("");
  const [limitInfo, setLimitInfo] = useState<{ watched: number; limit: number } | null>(null);
  const [turnstileState, setTurnstileState] = useState<"idle" | "running" | "passed" | "failed">("idle");
  const [elapsed, setElapsed] = useState(0); // seconds (float)
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [user, setUser] = useState<UserSnap | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [bonusToast, setBonusToast] = useState<{ kind: "got" | "wait"; bonus?: number; hours?: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  // Set right after a video finishes — shown in the completed screen
  const [lastFinished, setLastFinished] = useState<{ video: VideoAd; reward: number; rewarded: boolean } | null>(null);
  const [nextVideo, setNextVideo] = useState<VideoAd | null>(null);

  // Category sheet snap points (collapses below ~70%)
  const [snap, setSnap] = useState<string | number | null>(0.97);

  // Bot tasks for category sheets (non-extra pool)
  const [botTasks, setBotTasks] = useState<BotTask[]>([]);
  // Доп. задания pool
  const [extraTasks, setExtraTasks] = useState<BotTask[]>([]);
  const [activeSheet, setActiveSheet] = useState<null | "subscribe" | "survey" | "view_post" | "view_story">(null);
  // Quick-action sheets opened from the 2x2 grid
  const [quickSheet, setQuickSheet] = useState<null | "tasks" | "ads" | "surveys" | "games">(null);
  // Hero carousel index
  const [heroIdx, setHeroIdx] = useState(0);
  // Active bottom tab (purely visual for now)
  const [activeTab, setActiveTab] = useState<"earn" | "home" | "games" | "wallet" | "profile">("home");

  const videoRef = useRef<HTMLVideoElement>(null);
  const imgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);
  const sessionSecretRef = useRef<string | null>(null);
  const checkpointTimesRef = useRef<number[]>([]);
  const checkpointSentRef = useRef<number>(0);

  const syncPlaybackDuration = useCallback((node?: HTMLVideoElement | null) => {
    const mediaDuration = node?.duration;
    if (typeof mediaDuration === "number" && Number.isFinite(mediaDuration) && mediaDuration > 0) {
      setPlaybackDuration(mediaDuration);
      return mediaDuration;
    }
    const fallback = video?.duration_seconds ?? 0;
    if (fallback > 0) setPlaybackDuration(fallback);
    return fallback;
  }, [video]);

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

  // Image-only fallback timer (videos drive elapsed from <video> currentTime)
  const startImageTimer = useCallback(() => {
    if (imgTimerRef.current) return;
    const t0 = Date.now();
    imgTimerRef.current = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      setElapsed(sec);
      if (video && sec >= video.duration_seconds && imgTimerRef.current) {
        clearInterval(imgTimerRef.current); imgTimerRef.current = null;
      }
    }, 100);
  }, [video]);
  const stopImageTimer = useCallback(() => {
    if (imgTimerRef.current) { clearInterval(imgTimerRef.current); imgTimerRef.current = null; }
  }, []);

  const loadVideo = useCallback(async () => {
    if (!telegramId) { setStatus("no_telegram"); return; }
    try {
      setStatus("loading");
      const data = await miniAppApi("get_next_video", { telegram_id: telegramId });
      if (data?.locked) { setStatus("locked"); return; }
      if (data?.user) setUser(data.user);
      if (!data?.video) { setStatus("no_video"); return; }
      setVideo(data.video);
      setPosterUrl(null);
      setPlaybackDuration(data.video.duration_seconds);
      setIsBuffering(false);
      setStatus("ready");

    } catch (e: any) {
      if (/заблокирован/i.test(e.message) || /captcha/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  }, [telegramId]);
  useEffect(() => { loadVideo(); }, [loadVideo]);

  useEffect(() => {
    setPlaybackDuration(video?.duration_seconds ?? 0);
    setIsBuffering(false);
  }, [video?.id, video?.duration_seconds]);

  // Load bot tasks (non-extra) and extra tasks separately
  const loadBotTasks = useCallback(() => {
    if (!telegramId) return;
    miniAppApi("list_tasks", { telegram_id: telegramId, is_extra: false })
      .then((d) => setBotTasks(Array.isArray(d?.tasks) ? d.tasks : []))
      .catch(() => {});
    miniAppApi("list_tasks", { telegram_id: telegramId, is_extra: true })
      .then((d) => setExtraTasks(Array.isArray(d?.tasks) ? d.tasks : []))
      .catch(() => {});
  }, [telegramId]);
  useEffect(() => { loadBotTasks(); }, [loadBotTasks]);

  // Rotate hero banner every 4.5s
  useEffect(() => {
    const id = setInterval(() => setHeroIdx((i) => (i + 1) % 5), 4500);
    return () => clearInterval(id);
  }, []);

  // Per-task UI state for subscribe verification
  // 'idle' | 'checking' | 'done' | 'failed'
  const [taskState, setTaskState] = useState<Record<string, "idle" | "checking" | "done" | "failed">>({});
  // Tasks the user has clicked to subscribe — need verification on return
  const pendingVerifyRef = useRef<Set<string>>(new Set());

  const verifyTask = useCallback(async (taskId: string) => {
    if (!telegramId) return;
    setTaskState((s) => ({ ...s, [taskId]: "checking" }));
    try {
      const r = await miniAppApi("verify_task", { telegram_id: telegramId, task_id: taskId });
      if (r?.completed || r?.subscribed) {
        setTaskState((s) => ({ ...s, [taskId]: "done" }));
        if (typeof r.new_balance === "number") {
          setUser((u) => u ? { ...u, balance_pt: r.new_balance } : u);
        }
        pendingVerifyRef.current.delete(taskId);
      } else {
        setTaskState((s) => ({ ...s, [taskId]: "idle" }));
        pendingVerifyRef.current.delete(taskId);
      }
    } catch {
      setTaskState((s) => ({ ...s, [taskId]: "idle" }));
      pendingVerifyRef.current.delete(taskId);
    }
  }, [telegramId]);

  // When app regains focus, verify any pending tasks (subscribe / view_post / survey)
  useEffect(() => {
    const onFocus = () => {
      if (document.hidden) return;
      const pending = Array.from(pendingVerifyRef.current);
      pending.forEach((id) => verifyTask(id));
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [verifyTask]);

  // Group bot tasks by type — must be defined before any conditional return
  // to keep hook order stable across renders. Tasks completed in this session
  // stay visible (with a check) until the sheet closes and the list refreshes.
  const tasksByType = useMemo(() => {
    const m: Record<string, BotTask[]> = { subscribe: [], survey: [], view_post: [], view_story: [] };
    for (const t of botTasks) {
      if (m[t.type]) m[t.type].push(t);
    }
    return m;
  }, [botTasks]);

  // First-frame poster
  useEffect(() => {
    if (!video || video.media_type === "image") { setPosterUrl(null); return; }
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous"; v.muted = true; v.preload = "metadata"; v.src = video.video_url;
    const onSeeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
        const ctx = c.getContext("2d");
        if (ctx) { ctx.drawImage(v, 0, 0, c.width, c.height); if (!cancelled) setPosterUrl(c.toDataURL("image/jpeg", 0.6)); }
      } catch {}
    };
    const onMeta = () => {
      syncPlaybackDuration(v);
      try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch {}
    };
    v.addEventListener("loadedmetadata", onMeta); v.addEventListener("seeked", onSeeked);
    return () => { cancelled = true; v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("seeked", onSeeked); v.src = ""; };
  }, [syncPlaybackDuration, video]);

  // Pause when hidden
  useEffect(() => {
    if (status !== "playing") return;
    const onVis = () => {
      const v = videoRef.current;
      if (document.hidden) { try { v?.pause(); } catch {} stopImageTimer(); }
      else if (video) {
        if (video.media_type === "image") startImageTimer();
        else if (v && !finishedRef.current && v.currentTime < (video.duration_seconds - 0.05)) {
          v.play().catch(() => {});
        }
      }
    };
    const onBlur = () => { try { videoRef.current?.pause(); } catch {} stopImageTimer(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("blur", onBlur); };
  }, [status, video, startImageTimer, stopImageTimer]);

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
      if (data?.limit_reached) {
        setLimitInfo({ watched: data.watched_today ?? data.limit, limit: data.limit });
        setStatus("limit");
        return;
      }
      setViewId(data.view_id);
      sessionSecretRef.current = data.session_secret || null;
      checkpointTimesRef.current = Array.isArray(data.checkpoint_times) ? data.checkpoint_times : [];
      checkpointSentRef.current = 0;
      setStatus("playing"); setElapsed(0); finishedRef.current = false;
      if (video.media_type === "image") {
        startImageTimer();
      } else {
        videoRef.current?.play().catch(() => {});
      }
    } catch (e: any) {
      if (/captcha|заблокир/i.test(e.message)) { setStatus("locked"); return; }
      setError(e.message); setStatus("error");
    }
  };

  const finishWatching = async (finishedElapsed?: number) => {
    if (!viewId || !telegramId || !video) return;
    const effectiveDuration = videoRef.current?.duration || playbackDuration || video.duration_seconds;
    const effectiveElapsed = typeof finishedElapsed === "number" ? finishedElapsed : elapsed;
    if (effectiveElapsed < effectiveDuration - 0.25) return;
    try {
      finishedRef.current = true;
      setIsBuffering(false);
      stopImageTimer();
      try { videoRef.current?.pause(); } catch {}
      const res = await miniAppApi("finish_view", {
        telegram_id: telegramId, view_id: viewId, session_secret: sessionSecretRef.current,
      });
      if (res?.locked) { setStatus("locked"); return; }
      if (typeof res?.new_balance === "number") {
        setUser((u) => u ? { ...u, balance_pt: res.new_balance } : u);
      }
      setLastFinished({
        video,
        reward: res?.amount ?? video.reward_pt,
        rewarded: res?.rewarded !== false,
      });
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
    setPlaybackDuration(nextVideo.duration_seconds);
    setIsBuffering(false);
    setLastFinished(null);
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
    // For images only — videos finish via onEnded to avoid pausing mid-buffer.
    if (status === "playing" && video && video.media_type === "image"
        && elapsed >= video.duration_seconds - 0.05 && !finishedRef.current) finishWatching(elapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, status, video]);

  useEffect(() => () => stopImageTimer(), [stopImageTimer]);

  // Daily-bonus state
  const bonusReadyAt = user?.daily_bonus_at ? new Date(user.daily_bonus_at).getTime() + 24 * 3600 * 1000 : 0;
  const bonusCountdownMs = Math.max(0, bonusReadyAt - now);
  const bonusClaimed = bonusReadyAt > now;

  const progressPercent = video
    ? Math.min(100, (elapsed / Math.max(playbackDuration || video.duration_seconds, 0.1)) * 100)
    : 0;

  // ===== Locked screen with invisible Turnstile =====
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "locked" || !telegramId) return;
    let cancelled = false;
    setTurnstileState("running");

    const ensureScript = () =>
      new Promise<void>((resolve, reject) => {
        if ((window as any).turnstile) return resolve();
        const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
        if (existing) { existing.addEventListener("load", () => resolve()); return; }
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true; s.defer = true; s.setAttribute("data-turnstile", "1");
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("turnstile_load_failed"));
        document.head.appendChild(s);
      });

    (async () => {
      try {
        const cfg = await miniAppApi("get_config").catch(() => null);
        const siteKey = cfg?.turnstile_site_key;
        if (!siteKey) { if (!cancelled) setTurnstileState("failed"); return; }
        await ensureScript();
        if (cancelled || !turnstileRef.current) return;
        // @ts-ignore
        const ts = (window as any).turnstile;
        turnstileWidgetRef.current = ts.render(turnstileRef.current, {
          sitekey: siteKey,
          size: "invisible",
          callback: async (token: string) => {
            try {
              const res = await miniAppApi("verify_turnstile", { telegram_id: telegramId, token });
              if (!cancelled) setTurnstileState(res?.ok ? "passed" : "failed");
            } catch { if (!cancelled) setTurnstileState("failed"); }
          },
          "error-callback": () => { if (!cancelled) setTurnstileState("failed"); },
          "timeout-callback": () => { if (!cancelled) setTurnstileState("failed"); },
        });
      } catch {
        if (!cancelled) setTurnstileState("failed");
      }
    })();

    return () => {
      cancelled = true;
      try {
        // @ts-ignore
        if (turnstileWidgetRef.current && (window as any).turnstile) {
          // @ts-ignore
          (window as any).turnstile.remove(turnstileWidgetRef.current);
        }
      } catch {}
      turnstileWidgetRef.current = null;
    };
  }, [status, telegramId]);

  // ===== No Telegram: dev login by telegram_id =====
  if (status === "no_telegram") {
    return (
      <div className="min-h-screen text-white flex items-center justify-center p-6 fade-in"
           style={{ background: "radial-gradient(120% 80% at 50% 0%, #1a0a3a 0%, #0b0820 55%, #050314 100%)" }}>
        <div className="w-full max-w-sm rounded-3xl p-8 space-y-4 text-center screen-enter"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(16px)" }}>
          <img src={logoImg} alt="" className="w-14 h-14 rounded-2xl mx-auto shadow-lg" />
          <h2 className="text-lg font-semibold">Откройте через Telegram</h2>
          <p className="text-[13px] text-white/70">
            Это приложение работает только внутри Telegram. Откройте бота и нажмите «🎬 Смотреть видео».
          </p>
        </div>
      </div>
    );
  }


  if (status === "locked") {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#0a2a1f] text-white flex items-center justify-center p-6 z-50 fade-in">
        <div className="max-w-sm w-full rounded-3xl p-8 text-center space-y-4 screen-enter"
             style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(20px)" }}>
          <ShieldAlert className="w-14 h-14 mx-auto text-yellow-400" />
          <h2 className="text-xl font-bold">Необычная активность</h2>
          <p className="text-sm text-white/85">
            {turnstileState === "running" && "Проверяем устройство, подождите несколько секунд…"}
            {turnstileState === "passed" && "Устройство проверено. Откройте чат с ботом, решите простой пример и перезапустите приложение."}
            {turnstileState === "failed" && "Откройте чат с ботом и решите простой пример, чтобы продолжить."}
            {turnstileState === "idle" && "Подготовка проверки…"}
          </p>
          {turnstileState === "running" && (
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-white/60" />
          )}
          <div ref={turnstileRef} style={{ position: "absolute", left: -9999, top: -9999 }} />
        </div>
      </div>
    );
  }

  // ===== Daily limit reached =====
  if (status === "limit" && limitInfo) {
    return (
      <div className="min-h-screen text-white flex items-center justify-center p-6 fade-in"
           style={{ background: "radial-gradient(120% 80% at 50% 0%, #1a0a3a 0%, #0b0820 55%, #050314 100%)" }}>
        <div className="max-w-sm w-full rounded-3xl p-8 text-center space-y-3 screen-enter"
             style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(16px)" }}>
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center">
            <CheckCircle className="w-7 h-7 text-emerald-300" />
          </div>
          <h2 className="text-xl font-bold">Дневной лимит достигнут</h2>
          <p className="text-2xl font-bold tabular-nums text-yellow-300">
            {limitInfo.watched}/{limitInfo.limit}
          </p>
          <p className="text-sm text-white/80">
            Вы посмотрели все доступные на сегодня видео. Возвращайтесь завтра — лимит сбрасывается в 00:00 UTC.
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
              className="max-w-full max-h-full" playsInline autoPlay preload="metadata"
              controls={false} disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              onLoadedMetadata={(e) => {
                syncPlaybackDuration(e.currentTarget);
                setIsBuffering(false);
              }}
              onDurationChange={(e) => {
                syncPlaybackDuration(e.currentTarget);
              }}
              onCanPlay={() => setIsBuffering(false)}
              onPlaying={() => setIsBuffering(false)}
              onTimeUpdate={(e) => {
                setElapsed(e.currentTarget.currentTime);
                if (isBuffering) setIsBuffering(false);
              }}
              onEnded={() => {
                const naturalDuration = syncPlaybackDuration(videoRef.current);
                setElapsed(naturalDuration || video.duration_seconds);
                if (!finishedRef.current) finishWatching(naturalDuration || video.duration_seconds);
              }}
              onStalled={() => setIsBuffering(true)}
              onSuspend={() => setIsBuffering(false)}
              onWaiting={() => setIsBuffering(true)}
              onError={() => setIsBuffering(false)}
            />
          )}
        </div>
        <div className="p-4 bg-black/80 backdrop-blur space-y-2">
          <div className="flex justify-between text-xs text-white">
            <span className="tabular-nums">{Math.min(playbackDuration || video.duration_seconds, elapsed).toFixed(1)}с / {(playbackDuration || video.duration_seconds).toFixed(1)}с</span>
            <span className="text-yellow-300">+{video.reward_pt} PT</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
          <p className="text-center text-[11px] text-white/70">{isBuffering ? "Загружаем видео…" : "Не закрывайте — иначе просмотр не засчитается"}</p>
        </div>
      </div>
    );
  }

  // ===== Home =====
  const initial = (tgUser.name || "U").slice(0, 1).toUpperCase();




  const SHEET_CONFIG: Record<string, { title: string; icon: any; empty: string; ctaLabel: string }> = {
    subscribe:  { title: "Подписаться на канал",  icon: Send,          empty: "Пока нет каналов для подписки", ctaLabel: "Подписаться" },
    survey:     { title: "Пройти опрос",          icon: ClipboardList, empty: "Пока нет доступных опросов",     ctaLabel: "Пройти" },
    view_story: { title: "Посмотреть историю",    icon: Camera,        empty: "Пока нет историй",                ctaLabel: "Открыть" },
    view_post:  { title: "Посмотреть пост",       icon: Newspaper,     empty: "Пока нет публикаций",             ctaLabel: "Открыть" },
  };

  const taskLink = (t: BotTask) => {
    if (t.post_url) return t.post_url;
    if (t.channel_username) {
      const u = t.channel_username.replace(/^@/, "");
      return `https://t.me/${u}`;
    }
    return null;
  };

  const taskTitle = (t: BotTask) => {
    if (t.title && t.title.trim()) return t.title.trim();
    if (t.channel_username) return t.channel_username.startsWith("@") ? t.channel_username : `@${t.channel_username}`;
    return "Задание";
  };

  // ---- Render a single task row (used in sheets + extra list) ----
  const TaskRow = ({ t }: { t: BotTask }) => {
    const link = taskLink(t);
    const state = taskState[t.id] || "idle";
    const cfg = SHEET_CONFIG[t.type as keyof typeof SHEET_CONFIG] || SHEET_CONFIG.subscribe;
    const Icon = cfg.icon;

    const iconBg: Record<string, string> = {
      subscribe:  "from-sky-500 to-blue-600",
      survey:     "from-emerald-500 to-teal-600",
      view_post:  "from-rose-500 to-pink-600",
      view_story: "from-orange-500 to-red-600",
    };

    const handleClick = (e: React.MouseEvent) => {
      if (!link) return;
      pendingVerifyRef.current.add(t.id);
      setTaskState((s) => ({ ...s, [t.id]: "checking" }));
      if (telegramId) {
        miniAppApi("start_task", { telegram_id: telegramId, task_id: t.id }).catch(() => {});
      }
      try {
        const tg = (window as any).Telegram?.WebApp;
        if (tg?.openTelegramLink && /^https?:\/\/t\.me\//.test(link)) {
          e.preventDefault(); tg.openTelegramLink(link); return;
        }
        if (tg?.openLink) { e.preventDefault(); tg.openLink(link); return; }
      } catch {}
    };

    let cta: React.ReactNode;
    if (state === "checking") {
      cta = (
        <span className="px-4 h-9 inline-flex items-center justify-center rounded-xl bg-white/8 border border-white/10">
          <Loader2 className="w-4 h-4 animate-spin text-white/80" />
        </span>
      );
    } else if (state === "done") {
      cta = (
        <span className="px-4 h-9 inline-flex items-center gap-1 rounded-xl bg-emerald-400/20 border border-emerald-400/40 text-emerald-200 text-[12px] font-medium animate-scale-in">
          <CheckCircle className="w-3.5 h-3.5" /> Готово
        </span>
      );
    } else {
      cta = (
        <span className="press-cta px-5 h-9 inline-flex items-center justify-center rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-md shadow-indigo-900/30">
          Старт
        </span>
      );
    }

    const disabled = state === "checking" || state === "done";

    const inner = (
      <div
        className={
          "rounded-2xl p-3 flex items-center gap-3 transition-all duration-200 " +
          (disabled ? "opacity-70" : "hover:bg-white/[0.06] active:scale-[0.985]")
        }
        style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${iconBg[t.type] || iconBg.subscribe} shadow-lg flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-white truncate">{taskTitle(t)}</div>
          <div className={
            "text-[12px] mt-0.5 tabular-nums transition-colors duration-300 " +
            (state === "done" ? "text-emerald-400 line-through" : "text-white/55")
          }>+{t.reward_pt.toFixed(2)} PT</div>
        </div>
        {cta}
      </div>
    );

    if (disabled || !link) return <div className="pointer-events-none">{inner}</div>;
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" className="block press" onClick={handleClick}>
        {inner}
      </a>
    );
  };

  // ---- Per-quick-sheet random pick (stable while open) ----
  const [quickPickId, setQuickPickId] = useState<string | null>(null);
  const quickPool = useMemo(() => {
    if (!quickSheet) return [] as BotTask[];
    const notDone = (t: BotTask) => taskState[t.id] !== "done";
    if (quickSheet === "tasks")   return botTasks.filter(t => ["subscribe","view_post","view_story"].includes(t.type) && notDone(t));
    if (quickSheet === "surveys") return botTasks.filter(t => t.type === "survey" && notDone(t));
    return [] as BotTask[];
  }, [quickSheet, botTasks, taskState]);
  useEffect(() => {
    if (!quickSheet) { setQuickPickId(null); return; }
    if (quickPool.length === 0) { setQuickPickId(null); return; }
    if (quickPickId && quickPool.some(t => t.id === quickPickId)) return;
    const t = quickPool[Math.floor(Math.random() * quickPool.length)];
    setQuickPickId(t.id);
  }, [quickSheet, quickPool, quickPickId]);
  const quickPick = quickPool.find(t => t.id === quickPickId) || null;

  // ---- Hero banner content ----
  const heroBanners = [
    { title: "Супер задания", subtitle: "Выполняй и зарабатывай больше!" },
    { title: "Приглашай друзей",  subtitle: "Получай % с их заработка" },
    { title: "Ежедневная серия",  subtitle: "Заходи каждый день и копи PT" },
    { title: "Топ недели",        subtitle: "Соревнуйся и побеждай" },
    { title: "Скоро новые задания", subtitle: "Следи за обновлениями" },
  ];

  // ---- Quick-action tiles config ----
  const quickTiles: Array<{ id: "tasks"|"ads"|"surveys"|"games"; label: string; sub: string; icon: React.ReactNode; bg: string }> = [
    { id: "tasks",   label: "Задания", sub: "~0.06 PT", icon: <ClipboardCheck className="w-7 h-7 text-white drop-shadow" />, bg: "from-orange-400 to-amber-600" },
    { id: "ads",     label: "Реклама", sub: "~0.10 PT", icon: <Play className="w-7 h-7 text-white drop-shadow" />,            bg: "from-fuchsia-500 to-purple-700" },
    { id: "surveys", label: "Опросы",  sub: "~0.15 PT", icon: <BarChart3 className="w-7 h-7 text-white drop-shadow" />,       bg: "from-emerald-400 to-green-700" },
    { id: "games",   label: "Игры",    sub: "Играй",     icon: <Gamepad2 className="w-7 h-7 text-white drop-shadow" />,        bg: "from-indigo-500 to-purple-700" },
  ];

  return (
    <div className="min-h-screen text-white flex flex-col fade-in pb-28"
         style={{ background: "radial-gradient(120% 80% at 50% 0%, #1a0a3a 0%, #0b0820 55%, #050314 100%)" }}>

      {/* ===== Header ===== */}
      <header className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
        <img src={logoImg} alt="Starment" className="h-9 w-auto shrink-0 select-none" draggable={false} />
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-9 h-9 rounded-full overflow-hidden ring-1 ring-white/15 shadow-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm font-semibold">
            {tgUser.photo ? (<img src={tgUser.photo} alt="" className="w-full h-full object-cover" />) : initial}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0b0820]" />
          </div>
          <div className="flex items-center gap-1.5 px-3 h-9 rounded-full"
               style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(14px)" }}>
            <Wallet className="w-3.5 h-3.5 text-white/75" />
            <span className="font-semibold tabular-nums text-[14px]">{user ? user.balance_pt.toFixed(1) : "…"}</span>
            <span className="text-[11px] text-white/60">PT</span>
          </div>
        </div>
      </header>

      {/* ===== Hero carousel: Супер задания ===== */}
      <section className="px-4">
        <button
          onClick={() => { /* press-feedback only */ }}
          className="press w-full rounded-2xl p-4 flex items-center gap-4 text-left overflow-hidden relative"
          style={{
            background: "linear-gradient(110deg, #2a1356 0%, #4a1668 55%, #6b1e6c 100%)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 10px 40px -10px rgba(120, 40, 200, 0.45)",
          }}
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-300 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-700/40 shrink-0">
            <Star className="w-8 h-8 text-white fill-white drop-shadow" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-semibold tracking-tight">{heroBanners[heroIdx].title}</div>
            <div className="text-[12.5px] text-white/70 mt-0.5 truncate">{heroBanners[heroIdx].subtitle}</div>
          </div>
          <ChevronRight className="w-5 h-5 text-white/70 shrink-0" />
        </button>
        <div className="flex items-center justify-center gap-1.5 mt-2.5">
          {heroBanners.map((_, i) => (
            <span key={i} className={"h-1.5 rounded-full transition-all duration-300 " + (i === heroIdx ? "w-5 bg-indigo-400" : "w-1.5 bg-white/25")} />
          ))}
        </div>
      </section>

      {/* ===== Daily bonus (как раньше) ===== */}
      <section className="px-4 mt-4">
        <button
          onClick={() => { if (!bonusClaimed) claimDailyBonus(); else setBonusToast({ kind: "wait", hours: Math.ceil(bonusCountdownMs / 3600000) }); }}
          className="press w-full rounded-2xl p-4 flex items-center gap-3 text-left transition-all relative overflow-hidden"
          style={{
            background: "linear-gradient(120deg, #1c1245 0%, #2a1962 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[18px] font-semibold tracking-tight">Ежедневный бонус</div>
            <div className="text-[13px] text-white/65 mt-0.5 tabular-nums flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {bonusClaimed ? formatCountdown(bonusCountdownMs) : "Доступен сейчас"}
            </div>
            <span className={"mt-3 inline-flex px-4 h-8 items-center rounded-full text-[12.5px] font-semibold " +
              (bonusClaimed
                ? "bg-white/8 text-white/60 border border-white/10"
                : "bg-gradient-to-r from-yellow-400 to-orange-500 text-black shadow-md shadow-orange-700/40")}>
              {bonusClaimed ? "Получено" : "Получить"}
            </span>
          </div>
          <div className="shrink-0 w-24 h-24 -my-2 -mr-1 flex items-center justify-center text-5xl select-none" aria-hidden>
            <div className="relative">
              <Gift className="w-20 h-20 text-orange-400 drop-shadow-[0_0_20px_rgba(255,120,40,0.5)]" />
              <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-pink-300 animate-pulse" />
            </div>
          </div>
        </button>
        {bonusToast && (
          <div className="mt-2 text-center text-[12px] text-white/75 fade-in">
            {bonusToast.kind === "got"
              ? <>🎁 +<span className="text-yellow-300 font-semibold">{bonusToast.bonus} PT</span> зачислено</>
              : <>Уже получен. Следующий через ~{bonusToast.hours} ч.</>}
          </div>
        )}
      </section>

      {/* ===== Quick actions ===== */}
      <section className="px-4 mt-6">
        <div className="text-[15px] font-semibold mb-3 text-white/90">Быстрые действия</div>
        <div className="grid grid-cols-4 gap-2.5">
          {quickTiles.map(tile => (
            <button
              key={tile.id}
              onClick={() => setQuickSheet(tile.id)}
              className="press relative rounded-2xl p-3 flex flex-col items-center text-center transition-all active:scale-[0.96]"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${tile.bg} flex items-center justify-center shadow-lg mb-2`}>
                {tile.icon}
              </div>
              <div className="text-[12.5px] font-medium text-white">{tile.label}</div>
              <div className="text-[10.5px] text-white/50 mt-0.5 tabular-nums">{tile.sub}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ===== Доп. задания (extra pool only) ===== */}
      <section className="px-4 mt-6">
        <div className="text-[15px] font-semibold mb-3 text-white/90">Доп. задания</div>
        {extraTasks.filter(t => taskState[t.id] !== "done").length === 0 ? (
          <div className="rounded-2xl py-10 flex flex-col items-center text-white/45 text-[13px] gap-2"
               style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
            <Inbox className="w-7 h-7 text-white/30" />
            Тут пусто
          </div>
        ) : (
          <div className="space-y-2">
            {extraTasks.map(t => <TaskRow key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* ===== Bottom Tab Bar ===== */}
      <nav className="fixed bottom-0 inset-x-0 z-30 px-3 pb-3 pt-1 pointer-events-none">
        <div
          className="pointer-events-auto max-w-md mx-auto h-16 rounded-[28px] flex items-end justify-around px-2 relative"
          style={{
            background: "rgba(12,7,30,0.92)",
            border: "1px solid rgba(120,90,255,0.25)",
            boxShadow: "0 0 30px rgba(120,90,255,0.15), 0 10px 30px -10px rgba(0,0,0,0.6)",
            backdropFilter: "blur(20px)",
          }}
        >
          {([
            { id: "earn",    label: "Заработок", icon: <ClipboardCheck className="w-6 h-6" />, color: "text-orange-400" },
            { id: "home",    label: "Главная",   icon: <Home className="w-6 h-6" />,          color: "text-indigo-300" },
            { id: "games",   label: "Игры",      icon: null,                                   color: "" },
            { id: "wallet",  label: "Кошелёк",   icon: <Wallet className="w-6 h-6" />,        color: "text-indigo-300" },
            { id: "profile", label: "Профиль",   icon: <User className="w-6 h-6" />,          color: "text-indigo-300" },
          ] as const).map((t, idx) => {
            const isCenter = t.id === "games";
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={"press flex-1 h-full flex flex-col items-center justify-end gap-1 pb-2 relative transition-all " +
                  (isCenter ? "" : "active:scale-[0.92]")}
              >
                {isCenter ? (
                  <div className="flex flex-col items-center -mt-7">
                    <img src={starIcon} alt="" className="w-14 h-14 drop-shadow-[0_0_18px_rgba(255,180,60,0.55)] transition-transform active:scale-95" draggable={false} />
                    <span className={"text-[10.5px] mt-0.5 " + (isActive ? "text-white" : "text-white/70")}>{t.label}</span>
                  </div>
                ) : (
                  <>
                    <span className={(isActive ? "text-orange-400 drop-shadow-[0_0_8px_rgba(255,140,40,0.6)]" : "text-indigo-300/80") + " transition-all"}>
                      {t.icon}
                    </span>
                    <span className={"text-[10.5px] " + (isActive ? "text-white" : "text-white/55")}>{t.label}</span>
                    {isActive && <span className="absolute bottom-0 h-[3px] w-7 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(255,140,40,0.7)]" />}
                  </>
                )}
                {idx === 0 && <span className="absolute right-0 top-3 bottom-3 w-px bg-white/8" />}
                {idx === 1 && <span className="absolute right-0 top-3 bottom-3 w-px bg-white/8" />}
                {idx === 2 && <span className="absolute right-0 top-3 bottom-3 w-px bg-white/8" />}
                {idx === 3 && <span className="absolute right-0 top-3 bottom-3 w-px bg-white/8" />}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ===== Quick-action bottom sheet ===== */}
      <Vaul.Root
        open={quickSheet !== null}
        onOpenChange={(o) => { if (!o) { setQuickSheet(null); loadBotTasks(); } else setSnap(0.7); }}
        snapPoints={[0.55, 0.9]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        dismissible
      >
        <Vaul.Portal>
          <Vaul.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
          <Vaul.Content
            className="fixed bottom-0 inset-x-0 z-50 rounded-t-[28px] outline-none flex flex-col"
            style={{
              background: "rgba(15,8,40,0.97)",
              borderTop: "1px solid rgba(255,255,255,0.10)",
              backdropFilter: "blur(28px)",
              maxHeight: "92vh",
            }}
          >
            <div className="pt-2.5 pb-2 flex items-center justify-center">
              <div className="h-1.5 w-12 rounded-full bg-white/35" />
            </div>
            <div className="px-5 pb-3 flex items-center justify-between gap-3 border-b border-white/5">
              <Vaul.Title className="text-[17px] font-semibold tracking-tight text-white">
                {quickSheet === "tasks"   && "Задание"}
                {quickSheet === "ads"     && "Реклама"}
                {quickSheet === "surveys" && "Опрос"}
                {quickSheet === "games"   && "Игры"}
              </Vaul.Title>
              <button
                onClick={() => setQuickSheet(null)}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10 transition-all hover:bg-white/10 active:scale-90"
              >
                <X className="w-4 h-4 text-white/80" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-10">
              <div className="max-w-md mx-auto">

                {/* ---- TASKS / SURVEYS: one random task at a time ---- */}
                {(quickSheet === "tasks" || quickSheet === "surveys") && (
                  quickPick ? (
                    <div className="space-y-3">
                      <div className="text-[12px] text-white/55 px-1">
                        Выполни текущее задание, чтобы получить следующее.
                      </div>
                      <TaskRow t={quickPick} />
                    </div>
                  ) : (
                    <div className="rounded-2xl py-12 flex flex-col items-center text-white/55 text-sm gap-2"
                         style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
                      <CheckCircle className="w-8 h-8 text-emerald-400/70" />
                      Все задания выполнены
                    </div>
                  )
                )}

                {/* ---- ADS: video card ---- */}
                {quickSheet === "ads" && (
                  <>
                    {status === "loading" && (
                      <div className="rounded-3xl overflow-hidden"
                           style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <div className="relative aspect-video skeleton-shimmer" />
                        <div className="p-4 space-y-3.5">
                          <div className="h-4 rounded-md skeleton-shimmer w-3/4 mx-auto" />
                          <div className="h-12 rounded-2xl skeleton-shimmer" />
                        </div>
                      </div>
                    )}

                    {status === "error" && (
                      <div className="rounded-3xl flex flex-col items-center gap-3 py-10 text-center"
                           style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <AlertTriangle className="w-10 h-10 text-red-400" />
                        <p className="text-red-200 text-sm px-4">{error}</p>
                        <button onClick={loadVideo} className="press mt-1 px-5 h-10 rounded-xl border border-white/15 bg-white/5 text-sm">
                          Попробовать снова
                        </button>
                      </div>
                    )}

                    {status === "no_video" && (
                      <div className="rounded-2xl py-12 flex flex-col items-center text-white/55 text-sm gap-2"
                           style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
                        <Play className="w-8 h-8 text-white/35" />
                        Видеореклама сейчас недоступна
                      </div>
                    )}

                    {status === "ready" && video && (
                      <div key={video.id} className="screen-enter">
                        <div className="rounded-3xl overflow-hidden"
                             style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                          <div className="relative aspect-video bg-black/40 overflow-hidden">
                            {posterUrl || video.media_type === "image" ? (
                              <img src={posterUrl || video.video_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-purple-900/40 to-blue-900/40" />
                            )}
                            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-2xl font-bold text-lg tabular-nums">
                              +{video.reward_pt} PT
                            </div>
                            <div className="absolute right-2 bottom-2 px-2.5 py-1 rounded-full text-[11px] bg-black/60 backdrop-blur tabular-nums flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {video.duration_seconds}с
                            </div>
                          </div>
                          <div className="p-4 space-y-3.5">
                            <h2 className="text-[15px] font-medium text-center text-white/95 leading-snug">{video.title}</h2>
                            <button onClick={startWatching}
                              className="press-cta w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                                bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 shadow-lg shadow-purple-900/30
                                flex items-center justify-center gap-2 active:scale-[0.97] hover:brightness-110">
                              <Play className="w-4 h-4" /> СМОТРЕТЬ
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {status === "completed" && lastFinished && (
                      <div className="screen-enter">
                        <div className="rounded-3xl overflow-hidden text-center"
                             style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                          <div className="px-6 pt-6 pb-2 flex flex-col items-center gap-2">
                            {lastFinished.rewarded ? (
                              <>
                                <div className="w-14 h-14 rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center">
                                  <CheckCircle className="w-7 h-7 text-emerald-300" />
                                </div>
                                <div className="text-[15px] text-white/90">Видео просмотрено</div>
                                <div className="text-2xl font-bold tabular-nums">+<span className="text-yellow-300">{lastFinished.reward} PT</span></div>
                              </>
                            ) : (
                              <>
                                <div className="w-14 h-14 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center">
                                  <XCircle className="w-7 h-7 text-red-300" />
                                </div>
                                <div className="text-[15px] text-white/90">Просмотр не засчитан</div>
                              </>
                            )}
                          </div>
                          <div className="p-4">
                            <button onClick={watchNext}
                              className="press-cta w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                                bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 shadow-lg
                                flex items-center justify-center gap-2 active:scale-[0.97] hover:brightness-110">
                              <Play className="w-4 h-4" /> {nextVideo ? "СМОТРЕТЬ СЛЕДУЮЩЕЕ" : "ОБНОВИТЬ"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ---- GAMES placeholder ---- */}
                {quickSheet === "games" && (
                  <div className="rounded-2xl py-14 flex flex-col items-center text-white/55 text-sm gap-3"
                       style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
                    <Gamepad2 className="w-9 h-9 text-indigo-300/70" />
                    Игры скоро появятся
                  </div>
                )}

              </div>
            </div>
          </Vaul.Content>
        </Vaul.Portal>
      </Vaul.Root>
    </div>
  );
}


