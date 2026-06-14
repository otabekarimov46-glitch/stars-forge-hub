import { useEffect, useState, useRef } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Eye, Users as UsersIcon, Film, Heart, Link2, Building2, ChevronLeft, Power, PowerOff, Pencil, MoreVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

async function normalizeVideoFile(file: File): Promise<File> {
  if (!file.type.startsWith("video/")) return file;
  const ffmpegFactory = (window as any).FFmpegWASM;
  if (!ffmpegFactory?.createFFmpeg || !ffmpegFactory?.fetchFile) return file;

  const { createFFmpeg, fetchFile } = ffmpegFactory;
  const ffmpeg = createFFmpeg({ log: false });
  if (!ffmpeg.isLoaded()) await ffmpeg.load();

  const inputName = `input_${Date.now()}.mp4`;
  const outputName = `normalized_${Date.now()}.mp4`;
  ffmpeg.FS("writeFile", inputName, await fetchFile(file));
  await ffmpeg.run(
    "-i", inputName,
    "-movflags", "+faststart",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-profile:v", "main",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    outputName,
  );

  const data = ffmpeg.FS("readFile", outputName);
  ffmpeg.FS("unlink", inputName);
  ffmpeg.FS("unlink", outputName);
  return new File([data.buffer], file.name.replace(/\.[^.]+$/, "") + "_normalized.mp4", { type: "video/mp4" });
}

const TASK_TYPE_CONFIG: Record<string, { icon: any; color: string }> = {
  subscribe: { icon: UsersIcon, color: "bg-brand-blue/10 text-brand-blue" },
  view_post: { icon: Eye, color: "bg-brand-green/10 text-brand-green" },
  survey: { icon: Heart, color: "bg-brand-gold/10 text-brand-gold" },
};

export default function ContentPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [advertisers, setAdvertisers] = useState<any[]>([]);
  const [activeAdvertiser, setActiveAdvertiser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emptyTaskForm = { type: "subscribe", title: "", channel_username: "", channel_id: "", reward_pt: "10", post_url: "", max_completions: "0", hold_days: "5" };
  const [taskForm, setTaskForm] = useState<any>(emptyTaskForm);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  const [advForm, setAdvForm] = useState({ name: "" });
  const [advDialogOpen, setAdvDialogOpen] = useState(false);
  const [editingAdvId, setEditingAdvId] = useState<string | null>(null);

  const [videoForm, setVideoForm] = useState({
    title: "",
    video_url: "",
    duration_seconds: "30",
    reward_pt: "5",
    external_link_url: "",
    external_link_label: "Перейти",
    media_type: "video" as "video" | "image",
  });
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);

  const fetchData = async () => {
    try {
      const [ta, vi, ad] = await Promise.all([
        adminApi("get_tasks"),
        adminApi("get_video_ads"),
        adminApi("get_advertisers"),
      ]);
      setTasks(ta || []);
      setVideos(vi || []);
      setAdvertisers(ad || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openCreateTask = () => {
    setEditingTaskId(null);
    setTaskForm(emptyTaskForm);
    setTaskDialogOpen(true);
  };

  const openEditTask = (ta: any) => {
    setEditingTaskId(ta.id);
    setTaskForm({
      type: ta.type,
      title: ta.title || "",
      channel_username: ta.channel_username || "",
      channel_id: ta.channel_id ? String(ta.channel_id) : "",
      reward_pt: String(ta.reward_pt ?? "10"),
      post_url: ta.post_url || "",
      max_completions: String(ta.max_completions ?? "0"),
      hold_days: String(ta.hold_days ?? "5"),
    });
    setTaskDialogOpen(true);
  };

  const submitTask = async () => {
    if (!activeAdvertiser) { toast.error("Сначала выберите рекламодателя"); return; }
    if (!taskForm.title.trim()) { toast.error("Введите название задания"); return; }
    try {
      if (editingTaskId) {
        await adminApi("update_task", {
          task_id: editingTaskId,
          type: taskForm.type,
          title: taskForm.title.trim(),
          channel_username: taskForm.channel_username || null,
          channel_id: taskForm.channel_id || null,
          reward_pt: Number(taskForm.reward_pt),
          post_url: taskForm.post_url || null,
          max_completions: Number(taskForm.max_completions) || 0,
          hold_days: Number(taskForm.hold_days) || 5,
        });
        toast.success("Задание обновлено");
      } else {
        await adminApi("create_task", {
          type: taskForm.type,
          title: taskForm.title.trim(),
          advertiser_id: activeAdvertiser.id,
          channel_username: taskForm.channel_username || null,
          channel_id: taskForm.channel_id ? Number(taskForm.channel_id) : null,
          reward_pt: Number(taskForm.reward_pt),
          post_url: taskForm.post_url || null,
          max_completions: Number(taskForm.max_completions) || 0,
          hold_days: Number(taskForm.hold_days) || 5,
        });
        toast.success(t("content.taskCreated"));
      }
      setTaskDialogOpen(false);
      setEditingTaskId(null);
      setTaskForm(emptyTaskForm);
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const submitAdvertiser = async () => {
    if (!advForm.name.trim()) { toast.error("Введите название"); return; }
    try {
      if (editingAdvId) {
        await adminApi("update_advertiser", { advertiser_id: editingAdvId, name: advForm.name.trim() });
        toast.success("Рекламодатель обновлён");
      } else {
        await adminApi("create_advertiser", { name: advForm.name.trim() });
        toast.success("Рекламодатель добавлен");
      }
      setAdvDialogOpen(false);
      setAdvForm({ name: "" });
      setEditingAdvId(null);
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const deleteAdvertiser = async (id: string) => {
    try {
      await adminApi("delete_advertiser", { advertiser_id: id });
      toast.success("Рекламодатель удалён");
      if (activeAdvertiser?.id === id) setActiveAdvertiser(null);
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const bulkToggle = async (advertiser_id: string, is_active: boolean) => {
    try {
      await adminApi("bulk_toggle_advertiser_tasks", { advertiser_id, is_active });
      toast.success(is_active ? "Все задания включены" : "Все задания отключены");
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const bulkDelete = async (advertiser_id: string) => {
    try {
      await adminApi("bulk_delete_advertiser_tasks", { advertiser_id });
      toast.success("Все задания удалены");
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const detectDuration = (file: File): Promise<number | null> =>
    new Promise((resolve) => {
      if (!file.type.startsWith("video/")) return resolve(null);
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
      };
      v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      v.src = url;
    });

  const handleVideoUpload = async (file: File) => {
    setUploading(true);
    try {
      const isImage = file.type.startsWith("image/");
      const mediaType: "video" | "image" = isImage ? "image" : "video";
      // Soft limit warning: keep videos light for fast Mini App load
      const sizeMb = file.size / (1024 * 1024);
      if (!isImage && sizeMb > 6) {
        toast.warning(`Видео ${sizeMb.toFixed(1)} МБ. Рекомендуем 720p и 3–5 МБ для мгновенной загрузки в Mini App.`);
      }
      const fileName = `${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("video-ads").upload(fileName, file, {
        contentType: file.type,
        cacheControl: "31536000", // aggressive CDN cache (1 year)
      });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("video-ads").getPublicUrl(fileName);
      const dur = isImage ? 30 : (await detectDuration(file)) ?? 30;
      setVideoForm((f) => ({
        ...f,
        video_url: urlData.publicUrl,
        duration_seconds: String(dur),
        media_type: mediaType,
      }));
      toast.success(t("content.videoUploaded"));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  const createVideo = async () => {
    try {
      await adminApi("create_video_ad", {
        title: videoForm.title,
        video_url: videoForm.video_url,
        duration_seconds: Number(videoForm.duration_seconds),
        reward_pt: Number(videoForm.reward_pt),
        external_link_url: videoForm.external_link_url || null,
        external_link_label: videoForm.external_link_label || "Перейти",
        media_type: videoForm.media_type,
      });
      toast.success(t("content.videoAdded"));
      setVideoDialogOpen(false);
      setVideoForm({ title: "", video_url: "", duration_seconds: "30", reward_pt: "5", external_link_url: "", external_link_label: "Перейти", media_type: "video" });
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const toggleTask = async (id: string, active: boolean) => {
    await adminApi("toggle_task", { task_id: id, is_active: active });
    fetchData();
  };

  const deleteTask = async (id: string) => {
    await adminApi("delete_task", { task_id: id });
    toast.success(t("content.deleted"));
    fetchData();
  };

  const toggleVideo = async (id: string, active: boolean) => {
    await adminApi("toggle_video_ad", { video_ad_id: id, is_active: active });
    fetchData();
  };

  const deleteVideo = async (id: string) => {
    await adminApi("delete_video_ad", { video_ad_id: id });
    toast.success(t("content.deleted"));
    fetchData();
  };

  const taskTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      subscribe: t("task.subscribe"),
      view_post: t("task.view_post"),
      survey: t("task.survey"),
    };
    return map[type] || type;
  };

  const showChannelFields = taskForm.type === "subscribe";
  const showPostUrl = taskForm.type === "view_post" || taskForm.type === "survey";

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  // Split tasks: Bot tasks (subscribe, view_post, reaction) — video is Mini App only
  const botTasks = tasks.filter(t => t.type !== "video");

  return (
    <div className="space-y-8">
      <Tabs defaultValue="videos">
        <TabsList className="rounded-xl">
          <TabsTrigger value="videos" className="rounded-lg gap-2"><Film className="h-4 w-4" /> {t("content.videoAds")} ({videos.length})</TabsTrigger>
          <TabsTrigger value="tasks" className="rounded-lg gap-2"><UsersIcon className="h-4 w-4" /> {t("content.botTasks")} ({botTasks.length})</TabsTrigger>
        </TabsList>

        {/* VIDEO ADS (Mini App) */}
        <TabsContent value="videos" className="mt-4">
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between p-6 pb-4">
              <div>
                <h2 className="text-lg font-semibold">{t("content.videoAds")}</h2>
                <p className="text-xs text-muted-foreground mt-1">{t("content.videoDesc")}</p>
              </div>
              <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="rounded-xl gap-2 bg-gradient-to-r from-brand-blue to-brand-green text-white border-0">
                    <Plus className="h-4 w-4" /> {t("common.add")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="glass-card border-0">
                  <DialogHeader><DialogTitle>{t("content.newVideo")}</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>{t("content.videoTitle")}</Label>
                      <Input className="rounded-xl" value={videoForm.title} onChange={e => setVideoForm(f => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div>
                      <Label>{t("content.videoUrl")}</Label>
                      <div className="flex gap-2">
                        <Input className="rounded-xl flex-1" value={videoForm.video_url} onChange={e => setVideoForm(f => ({ ...f, video_url: e.target.value }))} placeholder="https://..." />
                        <input ref={fileInputRef} type="file" accept="video/*,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleVideoUpload(file); }} />
                        <Button variant="outline" className="rounded-xl gap-1" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                          <Upload className="h-4 w-4" />
                          {uploading ? "..." : t("content.uploadVideo")}
                        </Button>
                      </div>
                      {videoForm.video_url && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {videoForm.media_type === "image" ? "📷 Фото" : "🎬 Видео"} · {videoForm.duration_seconds}с
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{t("content.duration")}</Label>
                        <Input className="rounded-xl" type="number" value={videoForm.duration_seconds} onChange={e => setVideoForm(f => ({ ...f, duration_seconds: e.target.value }))} />
                      </div>
                      <div>
                        <Label>{t("common.reward")} (PT)</Label>
                        <Input className="rounded-xl" type="number" value={videoForm.reward_pt} onChange={e => setVideoForm(f => ({ ...f, reward_pt: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <Label>{t("content.externalLink")} ({t("content.optional")})</Label>
                      <Input className="rounded-xl" value={videoForm.external_link_url} onChange={e => setVideoForm(f => ({ ...f, external_link_url: e.target.value }))} placeholder="https://advertiser.com" />
                    </div>
                    <div>
                      <Label>{t("content.linkLabel")}</Label>
                      <Input className="rounded-xl" value={videoForm.external_link_label} onChange={e => setVideoForm(f => ({ ...f, external_link_label: e.target.value }))} placeholder="Перейти" />
                    </div>
                    <Button onClick={createVideo} className="w-full rounded-xl bg-gradient-to-r from-brand-blue to-brand-green text-white">{t("common.add")}</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="px-6 pb-6">
              {videos.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{t("content.noVideos")}</p>
              ) : (
                <div className="space-y-3">
                  {videos.map(v => (
                    <div key={v.id} className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="p-2.5 rounded-xl bg-brand-purple/10 text-brand-purple">
                        <Film className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{v.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{v.duration_seconds}s • {v.reward_pt} PT</span>
                          {v.external_link_url && (
                            <Badge variant="outline" className="rounded-lg text-xs gap-1">
                              <Link2 className="h-3 w-3" /> {t("content.hasLink")}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Switch checked={v.is_active} onCheckedChange={(val) => toggleVideo(v.id, val)} />
                      <Button variant="ghost" size="icon" className="rounded-xl text-destructive hover:bg-destructive/10" onClick={() => deleteVideo(v.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* BOT TASKS — advertiser-based */}
        <TabsContent value="tasks" className="mt-4">
          <div className="glass-card overflow-hidden">
            {!activeAdvertiser ? (
              <>
                <div className="flex items-center justify-between p-6 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold">Рекламодатели</h2>
                    <p className="text-xs text-muted-foreground mt-1">Каждый рекламодатель — отдельная группа заданий.</p>
                  </div>
                  <Dialog open={advDialogOpen} onOpenChange={(o) => { setAdvDialogOpen(o); if (!o) { setEditingAdvId(null); setAdvForm({ name: "" }); } }}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="rounded-xl gap-2 bg-gradient-to-r from-brand-purple to-brand-blue text-white border-0" onClick={() => { setEditingAdvId(null); setAdvForm({ name: "" }); }}>
                        <Plus className="h-4 w-4" /> Добавить рекламодателя
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="glass-card border-0">
                      <DialogHeader><DialogTitle>{editingAdvId ? "Переименовать рекламодателя" : "Новый рекламодатель"}</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Название</Label>
                          <Input className="rounded-xl" value={advForm.name} onChange={(e) => setAdvForm({ name: e.target.value })} placeholder="Например, Coca-Cola" autoFocus />
                        </div>
                        <Button onClick={submitAdvertiser} className="w-full rounded-xl bg-gradient-to-r from-brand-purple to-brand-blue text-white">
                          {editingAdvId ? "Сохранить" : "Создать"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="px-6 pb-6">
                  {advertisers.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Нет рекламодателей. Создайте первого, чтобы начать.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {advertisers.map((a) => (
                        <div
                          key={a.id}
                          className="group relative rounded-2xl p-4 bg-muted/30 hover:bg-muted/50 transition-all cursor-pointer border border-transparent hover:border-border"
                          onClick={() => setActiveAdvertiser(a)}
                        >
                          <div className="flex items-start gap-3">
                            <div className="p-2.5 rounded-xl bg-brand-purple/10 text-brand-purple">
                              <Building2 className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{a.name}</p>
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                <Badge variant="outline" className="rounded-lg text-xs">{a.tasks_count} заданий</Badge>
                                {a.active_count > 0 && (
                                  <Badge variant="outline" className="rounded-lg text-xs text-emerald-500 border-emerald-500/30">
                                    {a.active_count} активных
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="rounded-xl h-8 w-8 opacity-60 hover:opacity-100">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="rounded-xl" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onClick={() => { setEditingAdvId(a.id); setAdvForm({ name: a.name }); setAdvDialogOpen(true); }}>
                                  <Pencil className="h-4 w-4 mr-2" /> Переименовать
                                </DropdownMenuItem>
                                {a.tasks_count > 0 && (
                                  <>
                                    <DropdownMenuItem onClick={() => bulkToggle(a.id, true)}>
                                      <Power className="h-4 w-4 mr-2" /> Включить все
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => bulkToggle(a.id, false)}>
                                      <PowerOff className="h-4 w-4 mr-2" /> Отключить все
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                      <Trash2 className="h-4 w-4 mr-2" /> Удалить рекламодателя
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent className="glass-card border-0">
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Удалить «{a.name}»?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Все {a.tasks_count} заданий рекламодателя будут удалены безвозвратно.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
                                      <AlertDialogAction className="rounded-xl bg-destructive text-destructive-foreground" onClick={() => deleteAdvertiser(a.id)}>
                                        Удалить
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Inside advertiser */}
                <div className="flex items-center justify-between p-6 pb-4 gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={() => setActiveAdvertiser(null)}>
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold truncate">{activeAdvertiser.name}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tasks.filter(x => x.advertiser_id === activeAdvertiser.id).length} заданий
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {tasks.some(x => x.advertiser_id === activeAdvertiser.id) && (
                      <>
                        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={() => bulkToggle(activeAdvertiser.id, true)}>
                          <Power className="h-3.5 w-3.5" /> Вкл. все
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={() => bulkToggle(activeAdvertiser.id, false)}>
                          <PowerOff className="h-3.5 w-3.5" /> Откл. все
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-destructive hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" /> Удалить все
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="glass-card border-0">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Удалить все задания?</AlertDialogTitle>
                              <AlertDialogDescription>Удалит все задания рекламодателя «{activeAdvertiser.name}».</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
                              <AlertDialogAction className="rounded-xl bg-destructive text-destructive-foreground" onClick={() => bulkDelete(activeAdvertiser.id)}>
                                Удалить
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                    <Dialog open={taskDialogOpen} onOpenChange={(o) => { setTaskDialogOpen(o); if (!o) { setEditingTaskId(null); setTaskForm(emptyTaskForm); } }}>
                      <DialogTrigger asChild>
                        <Button size="sm" className="rounded-xl gap-2 bg-gradient-to-r from-brand-purple to-brand-blue text-white border-0" onClick={openCreateTask}>
                          <Plus className="h-4 w-4" /> Задание
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="glass-card border-0">
                        <DialogHeader><DialogTitle>{editingTaskId ? "Редактировать задание" : t("content.newTask")}</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label>Название (видно пользователям)</Label>
                            <Input className="rounded-xl" value={taskForm.title} onChange={e => setTaskForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="Например, Подпишись на наш канал" />
                          </div>
                          <div>
                            <Label>{t("common.type")}</Label>
                            <Select value={taskForm.type} onValueChange={(v) => setTaskForm((f: any) => ({ ...f, type: v }))}>
                              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="subscribe">{t("task.subscribe")}</SelectItem>
                                <SelectItem value="view_post">{t("task.view_post")}</SelectItem>
                                <SelectItem value="survey">{t("task.survey")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {showChannelFields && (
                            <>
                              <div>
                                <Label>{t("content.channelUsername")}</Label>
                                <Input className="rounded-xl" value={taskForm.channel_username} onChange={e => setTaskForm((f: any) => ({ ...f, channel_username: e.target.value }))} placeholder="@channel" />
                              </div>
                              <div>
                                <Label>{t("content.channelId")}</Label>
                                <Input className="rounded-xl" value={taskForm.channel_id} onChange={e => setTaskForm((f: any) => ({ ...f, channel_id: e.target.value }))} placeholder="-100..." />
                              </div>
                            </>
                          )}
                          {showPostUrl && (
                            <div>
                              <Label>{t("content.postUrl")}</Label>
                              <Input className="rounded-xl" value={taskForm.post_url} onChange={e => setTaskForm((f: any) => ({ ...f, post_url: e.target.value }))} placeholder="https://t.me/channel/123" />
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label>{t("common.reward")} (PT)</Label>
                              <Input className="rounded-xl" type="number" value={taskForm.reward_pt} onChange={e => setTaskForm((f: any) => ({ ...f, reward_pt: e.target.value }))} />
                            </div>
                            <div>
                              <Label>{t("content.maxCompletions")}</Label>
                              <Input className="rounded-xl" type="number" value={taskForm.max_completions} onChange={e => setTaskForm((f: any) => ({ ...f, max_completions: e.target.value }))} placeholder="0 = ∞" />
                            </div>
                          </div>
                          <div>
                            <Label>{t("content.holdDays")}</Label>
                            <Input className="rounded-xl" type="number" min={1} max={10} value={taskForm.hold_days} onChange={e => setTaskForm((f: any) => ({ ...f, hold_days: e.target.value }))} />
                            <p className="text-xs text-muted-foreground mt-1">{t("content.holdDaysHint")}</p>
                          </div>
                          <Button onClick={submitTask} className="w-full rounded-xl bg-gradient-to-r from-brand-purple to-brand-blue text-white">
                            {editingTaskId ? "Сохранить" : t("common.create")}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
                <div className="px-6 pb-6">
                  {tasks.filter(x => x.advertiser_id === activeAdvertiser.id).length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">У этого рекламодателя пока нет заданий.</p>
                  ) : (
                    <div className="space-y-3">
                      {tasks.filter(x => x.advertiser_id === activeAdvertiser.id).map(ta => {
                        const config = TASK_TYPE_CONFIG[ta.type] || TASK_TYPE_CONFIG.subscribe;
                        const Icon = config.icon;
                        return (
                          <div key={ta.id} className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors">
                            <div className={`p-2.5 rounded-xl ${config.color}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm truncate">{ta.title || taskTypeLabel(ta.type)}</p>
                                <Badge variant="outline" className="rounded-lg text-xs">{taskTypeLabel(ta.type)}</Badge>
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <p className="text-sm font-medium">{ta.reward_pt} PT</p>
                                {ta.max_completions > 0 && (
                                  <Badge variant="outline" className="rounded-lg text-xs">{ta.current_completions || 0}/{ta.max_completions}</Badge>
                                )}
                                <Badge variant="outline" className="rounded-lg text-xs">{t("content.hold")}: {ta.hold_days || 5}d</Badge>
                              </div>
                            </div>
                            <Switch checked={ta.is_active} onCheckedChange={(v) => toggleTask(ta.id, v)} />
                            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => openEditTask(ta)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="rounded-xl text-destructive hover:bg-destructive/10" onClick={() => deleteTask(ta.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
