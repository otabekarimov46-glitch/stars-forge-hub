import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Play, X, CheckCircle, Loader2, AlertTriangle } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface VideoAd {
  id: string;
  title: string;
  video_url: string;
  duration_seconds: number;
  reward_pt: number;
}

async function miniAppApi(action: string, params: Record<string, any> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/miniapp-api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

function getTelegramUserId(): number | null {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
      return tg.initDataUnsafe.user.id;
    }
  } catch {}
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("user_id");
  return uid ? parseInt(uid, 10) : null;
}

export default function MiniApp() {
  const telegramId = getTelegramUserId();
  const [video, setVideo] = useState<VideoAd | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "playing" | "completed" | "error" | "no_video">("loading");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [rewarded, setRewarded] = useState(false);

  const loadVideo = useCallback(async () => {
    if (!telegramId) {
      setError("Откройте через Telegram");
      setStatus("error");
      return;
    }
    try {
      setStatus("loading");
      const data = await miniAppApi("get_next_video", { telegram_id: telegramId });
      if (!data) {
        setStatus("no_video");
        return;
      }
      setVideo(data);
      setStatus("ready");
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  }, [telegramId]);

  useEffect(() => { loadVideo(); }, [loadVideo]);

  const startWatching = async () => {
    if (!video || !telegramId) return;
    try {
      const data = await miniAppApi("start_view", {
        telegram_id: telegramId,
        video_ad_id: video.id,
      });
      setViewId(data.view_id);
      setStatus("playing");
      setElapsed(0);
      videoRef.current?.play();

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          if (next >= video.duration_seconds && timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return next;
        });
      }, 1000);
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  };

  const finishWatching = async () => {
    if (!viewId || !telegramId || !video) return;
    if (elapsed < video.duration_seconds) return;

    try {
      const data = await miniAppApi("finish_view", {
        telegram_id: telegramId,
        view_id: viewId,
      });
      setRewarded(true);
      setStatus("completed");
      if (timerRef.current) clearInterval(timerRef.current);
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  };

  const canClose = video ? elapsed >= video.duration_seconds : false;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const progressPercent = video ? Math.min(100, (elapsed / video.duration_seconds) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-gray-800/80 border-gray-700 p-6 space-y-4">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
            <p className="text-gray-300">Загрузка видео...</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="w-10 h-10 text-red-400" />
            <p className="text-red-300">{error}</p>
            <Button variant="outline" onClick={loadVideo}>Попробовать снова</Button>
          </div>
        )}

        {status === "no_video" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <CheckCircle className="w-10 h-10 text-green-400" />
            <p className="text-gray-300 text-center">Нет доступных видео для просмотра. Попробуйте позже!</p>
          </div>
        )}

        {status === "ready" && video && (
          <div className="flex flex-col items-center gap-4 py-6">
            <h2 className="text-xl font-bold text-center">{video.title}</h2>
            <p className="text-gray-400 text-sm text-center">
              Посмотрите видео ({video.duration_seconds} сек.) и получите <span className="text-yellow-400 font-bold">{video.reward_pt} PT</span>
            </p>
            <Button onClick={startWatching} className="gap-2 bg-blue-600 hover:bg-blue-700">
              <Play className="w-4 h-4" /> Смотреть
            </Button>
          </div>
        )}

        {status === "playing" && video && (
          <div className="space-y-4">
            <video
              ref={videoRef}
              src={video.video_url}
              className="w-full rounded-lg aspect-video bg-black"
              playsInline
              autoPlay
              onEnded={() => {}}
            />
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-400">
                <span>{elapsed} сек.</span>
                <span>{video.duration_seconds} сек.</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
            {canClose ? (
              <Button onClick={finishWatching} className="w-full gap-2 bg-green-600 hover:bg-green-700">
                <CheckCircle className="w-4 h-4" /> Получить {video.reward_pt} PT
              </Button>
            ) : (
              <Button disabled className="w-full gap-2" variant="outline">
                <X className="w-4 h-4" /> Досмотрите видео до конца
              </Button>
            )}
          </div>
        )}

        {status === "completed" && video && (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle className="w-14 h-14 text-green-400" />
            <h2 className="text-xl font-bold">Готово!</h2>
            <p className="text-gray-300 text-center">
              Вам начислено <span className="text-yellow-400 font-bold">{video.reward_pt} PT</span>
            </p>
            <Button onClick={() => {
              setVideo(null);
              setViewId(null);
              setRewarded(false);
              setElapsed(0);
              loadVideo();
            }} variant="outline">
              Следующее видео
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
