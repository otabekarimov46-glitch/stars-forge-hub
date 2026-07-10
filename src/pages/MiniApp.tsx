import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Drawer as Vaul } from "vaul";
import { Progress } from "@/components/ui/progress";
import { Play, CheckCircle, Loader2, AlertTriangle, Gift, ExternalLink, ShieldAlert, Wallet, Clock, XCircle, Send, Newspaper, Camera, ChevronRight, X, ListChecks, User as UserIcon, Star, Copy, Trophy, History, Film } from "lucide-react";
import logoImg from "@/assets/logo.png";
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
  requires_redo?: boolean;
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

function getTelegramUser(): { id: number | null; photo: string | null; name: string | null; start_param: string | null } {
  try {
    const w = (window as any).Telegram?.WebApp;
    const u = w?.initDataUnsafe?.user;
    const sp = w?.initDataUnsafe?.start_param || null;
    if (u?.id) return { id: u.id, photo: u.photo_url || null, name: u.first_name || u.username || null, start_param: sp };
  } catch {}
  return { id: null, photo: null, name: null, start_param: null };
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

  // Bot tasks for category sheets
  const [botTasks, setBotTasks] = useState<BotTask[]>([]);
  const [activeSheet, setActiveSheet] = useState<null | "subscribe" | "view_post" | "view_story">(null);
  const [tab, setTab] = useState<"tasks" | "wallet" | "profile">("tasks");
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [botUsername, setBotUsername] = useState<string>("");
  const [refSheetOpen, setRefSheetOpen] = useState(false);
  const [refData, setRefData] = useState<{
    user_id: string;
    bot_username: string;
    total_earnings_pt: number;
    count: number;
    referrals: { id: string; telegram_id: number; username: string | null; joined_at: string }[];
  } | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [copyTip, setCopyTip] = useState(false);
  const [leaderboard, setLeaderboard] = useState<{
    top: { id: string; telegram_id: number; username: string | null; balance_pt: number }[];
    me: { id: string; telegram_id: number; username: string | null; balance_pt: number; rank: number } | null;
  } | null>(null);
  const [txs, setTxs] = useState<{ id: string; kind: string; label: string; reward_pt: number; at: string }[] | null>(null);


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

  // Load config (exchange rate, bot username)
  useEffect(() => {
    miniAppApi("get_config")
      .then((c) => {
        if (c && typeof c.exchange_rate === "number") setExchangeRate(c.exchange_rate);
        if (c && typeof c.bot_username === "string") setBotUsername(c.bot_username);
      })
      .catch(() => {});
  }, []);

  const openRefSheet = useCallback(() => {
    setRefSheetOpen(true);
    if (!telegramId) return;
    setRefLoading(true);
    miniAppApi("get_referral", { telegram_id: telegramId })
      .then((d) => { setRefData(d); if (d?.bot_username && !botUsername) setBotUsername(d.bot_username); })
      .catch(() => {})
      .finally(() => setRefLoading(false));
  }, [telegramId, botUsername]);

  const refLink = useMemo(() => {
    if (!refData?.user_id) return "";
    const bu = (botUsername || refData.bot_username || "").replace(/^@/, "");
    if (!bu) return "";
    return `https://t.me/${bu}?start=${refData.user_id}`;
  }, [refData, botUsername]);

  const copyRefLink = useCallback(async () => {
    if (!refLink) return;
    try {
      await navigator.clipboard.writeText(refLink);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = refLink; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopyTip(true);
    setTimeout(() => setCopyTip(false), 1600);
  }, [refLink]);

  const shareRefLink = useCallback(() => {
    if (!refLink) return;
    const text = "🚀 Заходи в Starment — смотри видео и получай Stars. По моей ссылке начнём вместе:";
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`;
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.openTelegramLink) { tg.openTelegramLink(shareUrl); return; }
    } catch {}
    window.open(shareUrl, "_blank");
  }, [refLink]);


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
      const data = await miniAppApi("get_next_video", { telegram_id: telegramId, start_param: tgUser.start_param });
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

  // Load bot tasks (subscribe / survey / view_post)
  const loadBotTasks = useCallback(() => {
    if (!telegramId) return;
    miniAppApi("list_tasks", { telegram_id: telegramId })
      .then((d) => setBotTasks(Array.isArray(d?.tasks) ? d.tasks : []))
      .catch(() => {});
  }, [telegramId]);
  useEffect(() => { loadBotTasks(); }, [loadBotTasks]);

  useEffect(() => {
    if (tab !== "profile" || !telegramId) return;
    miniAppApi("get_leaderboard", { telegram_id: telegramId })
      .then((d) => setLeaderboard(d))
      .catch(() => {});
  }, [tab, telegramId, user?.balance_pt]);

  useEffect(() => {
    if (tab !== "wallet" || !telegramId) return;
    miniAppApi("get_transactions", { telegram_id: telegramId })
      .then((d) => setTxs(Array.isArray(d?.items) ? d.items : []))
      .catch(() => {});
  }, [tab, telegramId, user?.balance_pt]);




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
    const m: Record<string, BotTask[]> = { subscribe: [], view_post: [], view_story: [] };
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

  const categoryTile = (kind: "subscribe" | "view_post" | "view_story") => {
    const cfg = SHEET_CONFIG[kind];
    const Icon = cfg.icon;
    const list = (tasksByType[kind] || []).filter((t) => taskState[t.id] !== "done");
    const disabled = list.length === 0;
    return (
      <button
        key={kind}
        disabled={disabled}
        onClick={() => !disabled && setActiveSheet(kind)}
        className={
          "press w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all duration-200 " +
          (disabled
            ? "opacity-45 cursor-not-allowed"
            : "hover:bg-white/[0.09] active:scale-[0.985]")
        }
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500/25 to-indigo-500/25 border border-white/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-sky-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-medium text-white/95 leading-tight">{cfg.title}</div>
          <div className="text-[11.5px] text-white/50 mt-0.5">
            {disabled ? "нет заданий" : `${list.length} ${list.length === 1 ? "задание" : list.length < 5 ? "задания" : "заданий"}`}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />
      </button>
    );
  };

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

      <div className="pb-28">
      {tab === "tasks" && (<>
      {/* ===== Daily bonus ===== */}
      <section className="px-4 mt-2">
        <button
          onClick={() => { if (!bonusClaimed) claimDailyBonus(); else setBonusToast({ kind: "wait", hours: Math.ceil(bonusCountdownMs / 3600000) }); }}
          className="press w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all duration-200 hover:bg-white/[0.09] active:scale-[0.985]"
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
            {bonusClaimed ? "Получено" : "Получить"}
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

      {/* ===== Watch ad card (always visible, no grabber) ===== */}
      <section className="px-4 mt-4">
        <div className="max-w-md mx-auto">
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
              <button onClick={loadVideo}
                className="press mt-1 px-5 h-10 rounded-xl border border-white/15 bg-white/5 text-sm transition-all hover:bg-white/10 active:scale-95">
                Попробовать снова
              </button>
            </div>
          )}

          {status === "no_video" && (
            <button
              type="button"
              onClick={() => { /* no-op — press feedback only */ }}
              className="press w-full rounded-2xl p-3.5 flex items-center gap-3 text-left opacity-50 transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
                backdropFilter: "blur(14px)",
              }}
              aria-disabled="true"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center shrink-0">
                <Play className="w-5 h-5 text-white/60" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-medium text-white/85 leading-tight">Видеореклама</div>
                <div className="text-[11.5px] text-white/50 mt-0.5">сейчас недоступно</div>
              </div>
              <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
            </button>
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
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-2xl shadow-purple-900/40 font-bold text-lg tabular-nums">
                    +{video.reward_pt} PT
                  </div>
                  <div className="absolute right-2 bottom-2 px-2.5 py-1 rounded-full text-[11px] bg-black/60 backdrop-blur tabular-nums flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {video.duration_seconds}с
                  </div>
                </div>
                <div className="p-4 space-y-3.5">
                  <h2 className="text-[15px] font-medium text-center text-white/95 leading-snug">{video.title}</h2>
                  <button
                    onClick={startWatching}
                    className="press-cta w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                      bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500
                      shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2
                      transition-transform duration-150 active:scale-[0.97] hover:brightness-110"
                  >
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
                      <div className="text-2xl font-bold tabular-nums">
                        +<span className="text-yellow-300">{lastFinished.reward} PT</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center">
                        <XCircle className="w-7 h-7 text-red-300" />
                      </div>
                      <div className="text-[15px] text-white/90">Просмотр не засчитан</div>
                      <div className="text-[12px] text-white/60 max-w-xs">
                        Видео было прервано или закрыто слишком рано. Попробуйте ещё раз — досмотрите до конца.
                      </div>
                    </>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <button
                    onClick={watchNext}
                    className="press-cta w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                      bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500
                      shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2
                      transition-transform duration-150 active:scale-[0.97] hover:brightness-110"
                  >
                    <Play className="w-4 h-4" />
                    {nextVideo ? "СМОТРЕТЬ СЛЕДУЮЩЕЕ" : "ОБНОВИТЬ"}
                  </button>

                  {lastFinished.video.external_link_url && (
                    <a href={lastFinished.video.external_link_url} target="_blank" rel="noopener noreferrer"
                       className="press-soft mx-auto inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-[12px] text-white/85 border border-white/10 bg-white/5 transition-all hover:bg-white/10">
                      <ExternalLink className="w-3.5 h-3.5" />
                      {lastFinished.video.external_link_label || "Перейти к рекламодателю"}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== Category tiles (scrollable list under watch card) ===== */}
      <section className="px-4 mt-3 pb-8 space-y-2.5">
        <div className="max-w-md mx-auto space-y-2.5">
          {categoryTile("subscribe")}
          {categoryTile("view_story")}
          {categoryTile("view_post")}
        </div>
      </section>
      </>)}

      {tab === "wallet" && (
        <section className="px-4 mt-4 space-y-3">
          <div className="max-w-md mx-auto space-y-3">
            <div className="rounded-3xl p-6 text-center relative overflow-hidden"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(16px)" }}>
              <div className="absolute inset-0 pointer-events-none opacity-30"
                   style={{ background: "radial-gradient(60% 50% at 50% 0%, rgba(139,92,246,0.35) 0%, transparent 70%)" }} />
              <div className="relative">
                <div className="text-[12px] uppercase tracking-widest text-white/60 mb-2">Ваш баланс</div>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl font-bold tabular-nums bg-gradient-to-r from-yellow-300 to-orange-400 bg-clip-text text-transparent">
                    {user ? user.balance_pt.toFixed(1) : "…"}
                  </span>
                  <span className="text-white/70 font-medium">PT</span>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-white/5 border border-white/10">
                  <Star className="w-3.5 h-3.5 text-yellow-300 fill-yellow-300" />
                  <span className="text-[13px] tabular-nums">
                    ≈ {user ? (user.balance_pt * exchangeRate).toFixed(2) : "…"}
                  </span>
                  <span className="text-[11px] text-white/60">Stars</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl p-4"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(14px)" }}>
              <div className="text-[13px] font-semibold text-white/85 mb-2">Курс обмена</div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-white/70">1 PT</span>
                <span className="tabular-nums font-semibold">≈ {exchangeRate.toFixed(2)} ⭐</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[12px] text-white/50">
                <span>10 PT</span>
                <span className="tabular-nums">≈ {(exchangeRate * 10).toFixed(2)} ⭐</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[12px] text-white/50">
                <span>100 PT</span>
                <span className="tabular-nums">≈ {(exchangeRate * 100).toFixed(2)} ⭐</span>
              </div>
            </div>

            <button
              disabled
              className="press w-full h-12 rounded-2xl font-semibold tracking-wide text-[15px] text-white
                bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500
                shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2
                opacity-60 cursor-not-allowed"
            >
              <Star className="w-4 h-4" /> Вывести в Stars
            </button>
            <p className="text-center text-[11px] text-white/50">Вывод откроется скоро</p>
          </div>
        </section>
      )}

      {tab === "profile" && (
        <section className="px-4 mt-4 space-y-3">
          <div className="max-w-md mx-auto space-y-3">
            <div className="rounded-3xl p-6 text-center"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(16px)" }}>
              <div className="w-20 h-20 rounded-full mx-auto overflow-hidden ring-2 ring-white/15 shadow-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-2xl font-semibold">
                {tgUser.photo ? (
                  <img src={tgUser.photo} alt="" className="w-full h-full object-cover" />
                ) : (initial)}
              </div>
              <div className="mt-3 text-[17px] font-semibold">{tgUser.name || "Пользователь"}</div>
              {telegramId && (
                <div className="text-[12px] text-white/50 tabular-nums mt-0.5">ID: {telegramId}</div>
              )}
            </div>

            <div className="rounded-2xl p-4 flex items-center gap-3"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(14px)" }}>
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400/90 to-orange-500/90 flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-white/60">Баланс</div>
                <div className="text-[15px] font-semibold tabular-nums">
                  {user ? user.balance_pt.toFixed(1) : "…"} PT
                  <span className="text-white/50 font-normal"> · ≈ {user ? (user.balance_pt * exchangeRate).toFixed(2) : "…"} ⭐</span>
                </div>
              </div>
              <button
                onClick={() => setTab("wallet")}
                className="press-soft px-3 h-8 rounded-full text-[12px] border border-white/10 bg-white/5 hover:bg-white/10 transition-all"
              >
                Кошелёк
              </button>
            </div>

            {telegramId && (
              <button
                onClick={openRefSheet}
                className="press w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all duration-200 hover:bg-white/[0.09] active:scale-[0.985]"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(14px)" }}
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400/25 to-sky-500/25 border border-white/10 flex items-center justify-center shrink-0">
                  <Send className="w-5 h-5 text-emerald-200" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] font-medium text-white/95 leading-tight">Пригласить друга</div>
                  <div className="text-[11.5px] text-white/50 mt-0.5">Приглашай и зарабатывай 5%</div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />
              </button>
            )}

          </div>
        </section>
      )}
      </div>

      {/* ===== Floating tab bar ===== */}
      <nav className="fixed bottom-4 inset-x-0 z-40 flex justify-center pointer-events-none">
        <div
          className="pointer-events-auto flex items-center gap-1 p-1.5 rounded-full shadow-2xl shadow-black/40"
          style={{
            background: "rgba(15,8,40,0.72)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
          }}
        >
          {[
            { id: "tasks",   label: "Задания", icon: ListChecks },
            { id: "wallet",  label: "Кошелёк", icon: Wallet },
            { id: "profile", label: "Профиль", icon: UserIcon },
          ].map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id as any)}
                className={
                  "press-soft h-11 px-4 rounded-full flex items-center gap-2 text-[13px] font-medium transition-all duration-200 " +
                  (active
                    ? "bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 text-white shadow-lg shadow-purple-900/40"
                    : "text-white/70 hover:text-white hover:bg-white/5")
                }
              >
                <Icon className="w-4 h-4" />
                <span className="inline">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ===== Category bottom sheet (full-screen w/ grabber) ===== */}
      <Vaul.Root
        open={activeSheet !== null}
        onOpenChange={(o) => { if (!o) { setActiveSheet(null); loadBotTasks(); } else setSnap(0.97); }}
        snapPoints={[0.7, 0.97]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        dismissible
      >
        <Vaul.Portal>
          <Vaul.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
          <Vaul.Content
            className="fixed bottom-0 inset-x-0 z-50 rounded-t-[28px] outline-none flex flex-col"
            style={{
              background: "rgba(15,8,40,0.96)",
              borderTop: "1px solid rgba(255,255,255,0.10)",
              backdropFilter: "blur(28px)",
              maxHeight: "97vh",
              height: "97vh",
            }}
          >
            {/* Grabber */}
            <div className="pt-2.5 pb-2 flex items-center justify-center">
              <div className="h-1.5 w-12 rounded-full bg-white/35" />
            </div>

            {/* Header */}
            <div className="px-5 pb-3 flex items-center justify-between gap-3 border-b border-white/5">
              <Vaul.Title className="text-[17px] font-semibold tracking-tight text-white">
                {activeSheet ? SHEET_CONFIG[activeSheet].title : ""}
              </Vaul.Title>
              <button
                onClick={() => setActiveSheet(null)}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10 transition-all hover:bg-white/10 active:scale-90"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4 text-white/80" />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-10">
              <div className="max-w-md mx-auto space-y-2.5">
                {activeSheet && tasksByType[activeSheet].length === 0 && (
                  <div className="text-center text-white/55 text-sm py-16">
                    {SHEET_CONFIG[activeSheet].empty}
                  </div>
                )}
                {activeSheet && tasksByType[activeSheet].map((t) => {
                  const link = taskLink(t);
                  const cfg = SHEET_CONFIG[activeSheet];
                  const Icon = cfg.icon;
                  const state = taskState[t.id] || "idle";

                  const handleClick = (e: React.MouseEvent) => {
                    if (!link) return;
                    // Mark as pending, log the click server-side, open the link,
                    // verification happens automatically when the user returns.
                    pendingVerifyRef.current.add(t.id);
                    setTaskState((s) => ({ ...s, [t.id]: "checking" }));
                    if (telegramId) {
                      miniAppApi("start_task", { telegram_id: telegramId, task_id: t.id }).catch(() => {});
                    }
                    try {
                      const tg = (window as any).Telegram?.WebApp;
                      if (tg?.openTelegramLink && /^https?:\/\/t\.me\//.test(link)) {
                        e.preventDefault();
                        tg.openTelegramLink(link);
                        return;
                      }
                      if (tg?.openLink) {
                        e.preventDefault();
                        tg.openLink(link);
                        return;
                      }
                    } catch {}
                    // Fallback: let the <a> open normally in a new tab
                  };

                  let cta: React.ReactNode;
                  if (state === "checking") {
                    cta = (
                      <span className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/8 border border-white/10">
                        <Loader2 className="w-4 h-4 animate-spin text-white/80" />
                      </span>
                    );
                  } else if (state === "done") {
                    cta = (
                      <span className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-emerald-400/20 border border-emerald-400/40 animate-scale-in">
                        <CheckCircle className="w-4 h-4 text-emerald-300" />
                      </span>
                    );
                  } else {
                    cta = (
                      <span className="px-3 h-8 inline-flex items-center gap-1 rounded-full text-[12px] font-medium bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-md shadow-indigo-900/30">
                        {cfg.ctaLabel} <ExternalLink className="w-3 h-3" />
                      </span>
                    );
                  }

                  const disabled = state === "checking" || state === "done";
                  const content = (
                    <div
                      className={
                        "rounded-2xl p-3.5 flex items-center gap-3 transition-all duration-200 " +
                        (disabled ? "opacity-60" : "hover:bg-white/[0.09] active:scale-[0.985]")
                      }
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.09)",
                      }}
                    >
                      <div className="w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 bg-gradient-to-br from-sky-500/25 to-indigo-500/25 border-white/10">
                        <Icon className="w-5 h-5 text-sky-200" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14.5px] font-medium text-white/95 truncate">{taskTitle(t)}</div>
                        <div className={
                          "text-[12px] mt-0.5 tabular-nums transition-colors duration-300 " +
                          (state === "done" ? "text-emerald-400 line-through" : "text-yellow-300/90")
                        }>
                          +{t.reward_pt} PT
                        </div>
                      </div>
                      {cta}
                    </div>
                  );


                  if (disabled) {
                    return <div key={t.id} className="pointer-events-none">{content}</div>;
                  }
                  return link ? (
                    <a
                      key={t.id}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                      onClick={handleClick}
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={t.id}>{content}</div>
                  );
                })}
              </div>
            </div>
          </Vaul.Content>
        </Vaul.Portal>
      </Vaul.Root>

      {/* ===== Referral bottom sheet ===== */}
      <Vaul.Root open={refSheetOpen} onOpenChange={setRefSheetOpen}>
        <Vaul.Portal>
          <Vaul.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
          <Vaul.Content
            className="fixed bottom-0 inset-x-0 z-50 rounded-t-[28px] outline-none flex flex-col"
            style={{
              background: "rgba(15,8,40,0.96)",
              borderTop: "1px solid rgba(255,255,255,0.10)",
              backdropFilter: "blur(28px)",
              maxHeight: "88vh",
            }}
          >
            <div className="pt-2.5 pb-2 flex items-center justify-center">
              <div className="h-1.5 w-12 rounded-full bg-white/35" />
            </div>
            <div className="px-5 pb-3 flex items-center justify-between gap-3 border-b border-white/5">
              <Vaul.Title className="text-[17px] font-semibold tracking-tight text-white">
                Реферальная программа
              </Vaul.Title>
              <button
                onClick={() => setRefSheetOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10 transition-all hover:bg-white/10 active:scale-90"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4 text-white/80" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
              <div className="max-w-md mx-auto space-y-3">
                {/* Hero */}
                <div className="rounded-3xl p-5 text-center relative overflow-hidden"
                     style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                  <div className="absolute inset-0 pointer-events-none opacity-40"
                       style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(16,185,129,0.35) 0%, transparent 70%)" }} />
                  <div className="relative">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-sky-500 flex items-center justify-center shadow-lg shadow-emerald-900/30">
                      <Send className="w-6 h-6 text-white" />
                    </div>
                    <div className="mt-3 text-[15px] text-white/85 leading-snug">
                      Получай <span className="text-emerald-300 font-semibold">5%</span> от каждого задания,
                      которое выполнит приглашённый друг
                    </div>
                  </div>
                </div>


                {/* Stats */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl p-3.5"
                       style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
                    <div className="text-[11px] uppercase tracking-widest text-white/50">Приглашено</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-white">
                      {refData?.count ?? (refLoading ? "…" : 0)}
                    </div>

                  </div>
                  <div className="rounded-2xl p-3.5"
                       style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
                    <div className="text-[11px] uppercase tracking-widest text-white/50">Заработано</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums">
                      <span className="bg-gradient-to-r from-yellow-300 to-orange-400 bg-clip-text text-transparent">
                        {refData ? refData.total_earnings_pt.toFixed(2).replace(/\.?0+$/, "") : (refLoading ? "…" : "0")}
                      </span>
                      <span className="text-white/60 text-sm font-medium"> PT</span>
                    </div>
                  </div>
                </div>




                {/* Referral link */}
                <div className="rounded-2xl p-4 space-y-3"
                     style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <div className="text-[12px] uppercase tracking-widest text-white/50">Ваша ссылка</div>
                  {refLink ? (
                    <button
                      onClick={copyRefLink}
                      className="w-full text-left px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-[12.5px] text-white/85 break-all tabular-nums hover:bg-black/35 active:scale-[0.99] transition"
                    >
                      {refLink}
                    </button>
                  ) : (
                    <div className="px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-[12.5px] text-white/60 break-all">
                      {refLoading ? "Загрузка…" : "Ссылка недоступна"}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={copyRefLink}
                      disabled={!refLink}
                      className="press h-11 rounded-xl font-medium text-[13.5px] text-white/90 border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      {copyTip ? "Скопировано" : "Скопировать"}
                    </button>
                    <button
                      onClick={shareRefLink}
                      disabled={!refLink}
                      className="press-cta h-11 rounded-xl font-semibold text-[13.5px] text-white
                        bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500
                        shadow-lg shadow-sky-900/30 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Поделиться
                    </button>
                  </div>
                </div>

                {/* Referrals list */}
                {refData && refData.count > 0 && (
                  <div className="rounded-2xl overflow-hidden"
                       style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
                    <div className="px-4 pt-3 pb-2 text-[13px] font-semibold text-white/85">
                      Твои приглашённые
                    </div>
                    <div className="divide-y divide-white/5 max-h-56 overflow-y-auto">
                      {refData.referrals.map((r) => (
                        <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-[13px] font-semibold shrink-0">
                            {(r.username || String(r.telegram_id)).slice(0, 1).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] text-white/90 truncate">
                              {r.username ? `@${r.username}` : `ID ${r.telegram_id}`}
                            </div>
                            <div className="text-[11px] text-white/45">
                              {new Date(r.joined_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
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

