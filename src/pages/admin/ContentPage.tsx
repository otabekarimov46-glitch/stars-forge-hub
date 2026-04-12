import { useEffect, useState, useRef } from "react";
import { adminApi } from "@/lib/admin-api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Link2, Heart, Eye, Users as UsersIcon, Film } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

const TASK_TYPE_CONFIG: Record<string, { icon: any; color: string }> = {
  subscribe: { icon: UsersIcon, color: "bg-brand-blue/10 text-brand-blue" },
  video: { icon: Film, color: "bg-brand-purple/10 text-brand-purple" },
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
    reaction_emoji: "👍",
  });
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  const [videoForm, setVideoForm] = useState({ title: "", video_url: "", duration_seconds: "30", reward_pt: "5" });
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
        reaction_emoji: taskForm.reaction_emoji || null,
      });
      toast.success(t("content.taskCreated"));
      setTaskDialogOpen(false);
      setTaskForm({ type: "subscribe", channel_username: "", channel_id: "", reward_pt: "10", post_url: "", reaction_emoji: "👍" });
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleVideoUpload = async (file: File) => {
    setUploading(true);
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage
        .from("video-ads")
        .upload(fileName, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("video-ads").getPublicUrl(fileName);
      setVideoForm((f) => ({ ...f, video_url: urlData.publicUrl }));
      toast.success("Видео загружено");
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
      });
      toast.success(t("content.videoAdded"));
      setVideoDialogOpen(false);
      setVideoForm({ title: "", video_url: "", duration_seconds: "30", reward_pt: "5" });
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
      video: t("task.video"),
      view_post: t("task.view_post"),
      reaction: t("task.reaction"),
    };
    return map[type] || type;
  };

  const showChannelFields = taskForm.type === "subscribe";
  const showPostUrl = taskForm.type === "view_post" || taskForm.type === "reaction";
  const showEmoji = taskForm.type === "reaction";

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="space-y-8">
      {/* TASKS */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-lg font-semibold">{t("content.tasks")}</h2>
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
                      <SelectItem value="video">{t("task.video")}</SelectItem>
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
                {showEmoji && (
                  <div>
                    <Label>{t("content.reactionEmoji")}</Label>
                    <Input className="rounded-xl" value={taskForm.reaction_emoji} onChange={e => setTaskForm(f => ({ ...f, reaction_emoji: e.target.value }))} placeholder="👍" />
                  </div>
                )}
                <div>
                  <Label>{t("common.reward")} (PT)</Label>
                  <Input className="rounded-xl" type="number" value={taskForm.reward_pt} onChange={e => setTaskForm(f => ({ ...f, reward_pt: e.target.value }))} />
                </div>
                <Button onClick={createTask} className="w-full rounded-xl bg-gradient-to-r from-brand-purple to-brand-blue text-white">{t("common.create")}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="px-6 pb-6">
          {tasks.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t("content.noTasks")}</p>
          ) : (
            <div className="space-y-3">
              {tasks.map(ta => {
                const config = TASK_TYPE_CONFIG[ta.type] || TASK_TYPE_CONFIG.subscribe;
                const Icon = config.icon;
                return (
                  <div key={ta.id} className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className={`p-2.5 rounded-xl ${config.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="rounded-lg text-xs">{taskTypeLabel(ta.type)}</Badge>
                        {ta.channel_username && <span className="text-sm text-muted-foreground">{ta.channel_username}</span>}
                        {ta.post_url && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{ta.post_url}</span>}
                        {ta.reaction_emoji && <span className="text-lg">{ta.reaction_emoji}</span>}
                      </div>
                      <p className="text-sm font-medium mt-1">{ta.reward_pt} PT</p>
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

      {/* VIDEO ADS */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-lg font-semibold">{t("content.videoAds")}</h2>
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
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleVideoUpload(file);
                      }}
                    />
                    <Button
                      variant="outline"
                      className="rounded-xl gap-1"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <Upload className="h-4 w-4" />
                      {uploading ? "..." : t("content.uploadVideo")}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>{t("content.duration")}</Label>
                  <Input className="rounded-xl" type="number" value={videoForm.duration_seconds} onChange={e => setVideoForm(f => ({ ...f, duration_seconds: e.target.value }))} />
                </div>
                <div>
                  <Label>{t("common.reward")} (PT)</Label>
                  <Input className="rounded-xl" type="number" value={videoForm.reward_pt} onChange={e => setVideoForm(f => ({ ...f, reward_pt: e.target.value }))} />
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
                    <p className="text-xs text-muted-foreground">{v.duration_seconds}s • {v.reward_pt} PT</p>
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
    </div>
  );
}
