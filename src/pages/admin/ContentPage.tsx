import { useEffect, useState, useRef } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Eye, Users as UsersIcon, Film, Heart, Link2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

const TASK_TYPE_CONFIG: Record<string, { icon: any; color: string }> = {
  subscribe: { icon: UsersIcon, color: "bg-brand-blue/10 text-brand-blue" },
  view_post: { icon: Eye, color: "bg-brand-green/10 text-brand-green" },
  reaction: { icon: Heart, color: "bg-brand-gold/10 text-brand-gold" },
};

export default function ContentPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [taskForm, setTaskForm] = useState({
    type: "subscribe" as string,
    channel_username: "",
    channel_id: "",
    reward_pt: "10",
    post_url: "",
    max_completions: "0",
    hold_days: "5",
  });
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

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
      const [ta, vi] = await Promise.all([adminApi("get_tasks"), adminApi("get_video_ads")]);
      setTasks(ta || []);
      setVideos(vi || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const createTask = async () => {
    try {
      await adminApi("create_task", {
        type: taskForm.type,
        channel_username: taskForm.channel_username || null,
        channel_id: taskForm.channel_id ? Number(taskForm.channel_id) : null,
        reward_pt: Number(taskForm.reward_pt),
        post_url: taskForm.post_url || null,
        max_completions: Number(taskForm.max_completions) || 0,
        hold_days: Number(taskForm.hold_days) || 5,
      });
      toast.success(t("content.taskCreated"));
      setTaskDialogOpen(false);
      setTaskForm({ type: "subscribe", channel_username: "", channel_id: "", reward_pt: "10", post_url: "", max_completions: "0", hold_days: "5" });
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
      const fileName = `${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("video-ads").upload(fileName, file, { contentType: file.type });
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
      reaction: t("task.reaction"),
    };
    return map[type] || type;
  };

  const showChannelFields = taskForm.type === "subscribe" || taskForm.type === "reaction";
  const showPostUrl = taskForm.type === "view_post" || taskForm.type === "reaction";

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
                        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleVideoUpload(file); }} />
                        <Button variant="outline" className="rounded-xl gap-1" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                          <Upload className="h-4 w-4" />
                          {uploading ? "..." : t("content.uploadVideo")}
                        </Button>
                      </div>
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

        {/* BOT TASKS (subscribe, view_post, reaction) */}
        <TabsContent value="tasks" className="mt-4">
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between p-6 pb-4">
              <div>
                <h2 className="text-lg font-semibold">{t("content.botTasks")}</h2>
                <p className="text-xs text-muted-foreground mt-1">{t("content.botTasksDesc")}</p>
              </div>
              <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="rounded-xl gap-2 bg-gradient-to-r from-brand-purple to-brand-blue text-white border-0">
                    <Plus className="h-4 w-4" /> {t("common.add")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="glass-card border-0">
                  <DialogHeader><DialogTitle>{t("content.newTask")}</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>{t("common.type")}</Label>
                      <Select value={taskForm.type} onValueChange={(v) => setTaskForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="subscribe">{t("task.subscribe")}</SelectItem>
                          <SelectItem value="view_post">{t("task.view_post")}</SelectItem>
                          <SelectItem value="reaction">{t("task.reaction")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {showChannelFields && (
                      <>
                        <div>
                          <Label>{t("content.channelUsername")}</Label>
                          <Input className="rounded-xl" value={taskForm.channel_username} onChange={e => setTaskForm(f => ({ ...f, channel_username: e.target.value }))} placeholder="@channel" />
                        </div>
                        <div>
                          <Label>{t("content.channelId")}</Label>
                          <Input className="rounded-xl" value={taskForm.channel_id} onChange={e => setTaskForm(f => ({ ...f, channel_id: e.target.value }))} placeholder="-100..." />
                        </div>
                      </>
                    )}
                    {showPostUrl && (
                      <div>
                        <Label>{t("content.postUrl")}</Label>
                        <Input className="rounded-xl" value={taskForm.post_url} onChange={e => setTaskForm(f => ({ ...f, post_url: e.target.value }))} placeholder="https://t.me/channel/123" />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{t("common.reward")} (PT)</Label>
                        <Input className="rounded-xl" type="number" value={taskForm.reward_pt} onChange={e => setTaskForm(f => ({ ...f, reward_pt: e.target.value }))} />
                      </div>
                      <div>
                        <Label>{t("content.maxCompletions")}</Label>
                        <Input className="rounded-xl" type="number" value={taskForm.max_completions} onChange={e => setTaskForm(f => ({ ...f, max_completions: e.target.value }))} placeholder="0 = ∞" />
                      </div>
                    </div>
                    <div>
                      <Label>{t("content.holdDays")}</Label>
                      <Input className="rounded-xl" type="number" min={1} max={10} value={taskForm.hold_days} onChange={e => setTaskForm(f => ({ ...f, hold_days: e.target.value }))} />
                      <p className="text-xs text-muted-foreground mt-1">{t("content.holdDaysHint")}</p>
                    </div>
                    <Button onClick={createTask} className="w-full rounded-xl bg-gradient-to-r from-brand-purple to-brand-blue text-white">{t("common.create")}</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="px-6 pb-6">
              {botTasks.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{t("content.noTasks")}</p>
              ) : (
                <div className="space-y-3">
                  {botTasks.map(ta => {
                    const config = TASK_TYPE_CONFIG[ta.type] || TASK_TYPE_CONFIG.subscribe;
                    const Icon = config.icon;
                    return (
                      <div key={ta.id} className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className={`p-2.5 rounded-xl ${config.color}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="rounded-lg text-xs">{taskTypeLabel(ta.type)}</Badge>
                            {ta.channel_username && <span className="text-sm text-muted-foreground">{ta.channel_username}</span>}
                            {ta.post_url && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{ta.post_url}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-medium">{ta.reward_pt} PT</p>
                            {ta.max_completions > 0 && (
                              <Badge variant="outline" className="rounded-lg text-xs">{ta.current_completions || 0}/{ta.max_completions}</Badge>
                            )}
                            <Badge variant="outline" className="rounded-lg text-xs">{t("content.hold")}: {ta.hold_days || 5}d</Badge>
                          </div>
                        </div>
                        <Switch checked={ta.is_active} onCheckedChange={(v) => toggleTask(ta.id, v)} />
                        <Button variant="ghost" size="icon" className="rounded-xl text-destructive hover:bg-destructive/10" onClick={() => deleteTask(ta.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
