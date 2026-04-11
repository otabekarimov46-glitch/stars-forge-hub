import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ContentPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New task form
  const [taskForm, setTaskForm] = useState({ type: "subscribe" as string, channel_username: "", channel_id: "", reward_pt: "10" });
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  // New video form
  const [videoForm, setVideoForm] = useState({ title: "", video_url: "", duration_seconds: "30", reward_pt: "5" });
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);

  const fetchData = async () => {
    try {
      const [t, v] = await Promise.all([adminApi("get_tasks"), adminApi("get_video_ads")]);
      setTasks(t || []);
      setVideos(v || []);
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
      });
      toast.success("Задание создано");
      setTaskDialogOpen(false);
      setTaskForm({ type: "subscribe", channel_username: "", channel_id: "", reward_pt: "10" });
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  const createVideo = async () => {
    try {
      await adminApi("create_video_ad", {
        title: videoForm.title,
        video_url: videoForm.video_url,
        duration_seconds: Number(videoForm.duration_seconds),
        reward_pt: Number(videoForm.reward_pt),
      });
      toast.success("Видео добавлено");
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
    toast.success("Удалено");
    fetchData();
  };

  const toggleVideo = async (id: string, active: boolean) => {
    await adminApi("toggle_video_ad", { video_ad_id: id, is_active: active });
    fetchData();
  };

  const deleteVideo = async (id: string) => {
    await adminApi("delete_video_ad", { video_ad_id: id });
    toast.success("Удалено");
    fetchData();
  };

  if (loading) return <div className="text-muted-foreground">Загрузка...</div>;

  return (
    <div className="space-y-8">
      {/* TASKS */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Задания на подписку</CardTitle>
          <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Новое задание</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Тип</Label>
                  <Select value={taskForm.type} onValueChange={(v) => setTaskForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subscribe">Подписка</SelectItem>
                      <SelectItem value="video">Видео</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>@username канала</Label>
                  <Input value={taskForm.channel_username} onChange={e => setTaskForm(f => ({ ...f, channel_username: e.target.value }))} placeholder="@channel" />
                </div>
                <div>
                  <Label>Channel ID</Label>
                  <Input value={taskForm.channel_id} onChange={e => setTaskForm(f => ({ ...f, channel_id: e.target.value }))} placeholder="-100..." />
                </div>
                <div>
                  <Label>Награда (PT)</Label>
                  <Input type="number" value={taskForm.reward_pt} onChange={e => setTaskForm(f => ({ ...f, reward_pt: e.target.value }))} />
                </div>
                <Button onClick={createTask} className="w-full">Создать</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип</TableHead>
                <TableHead>Канал</TableHead>
                <TableHead>Награда</TableHead>
                <TableHead>Активно</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map(t => (
                <TableRow key={t.id}>
                  <TableCell><Badge variant={t.type === "subscribe" ? "default" : "secondary"}>{t.type}</Badge></TableCell>
                  <TableCell>{t.channel_username || "—"}</TableCell>
                  <TableCell>{t.reward_pt} PT</TableCell>
                  <TableCell>
                    <Switch checked={t.is_active} onCheckedChange={(v) => toggleTask(t.id, v)} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => deleteTask(t.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {tasks.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Нет заданий</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* VIDEO ADS */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Видеоролики</CardTitle>
          <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Новое видео</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Название</Label>
                  <Input value={videoForm.title} onChange={e => setVideoForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <Label>URL видео</Label>
                  <Input value={videoForm.video_url} onChange={e => setVideoForm(f => ({ ...f, video_url: e.target.value }))} placeholder="https://..." />
                </div>
                <div>
                  <Label>Длительность (сек)</Label>
                  <Input type="number" value={videoForm.duration_seconds} onChange={e => setVideoForm(f => ({ ...f, duration_seconds: e.target.value }))} />
                </div>
                <div>
                  <Label>Награда (PT)</Label>
                  <Input type="number" value={videoForm.reward_pt} onChange={e => setVideoForm(f => ({ ...f, reward_pt: e.target.value }))} />
                </div>
                <Button onClick={createVideo} className="w-full">Добавить</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Длительность</TableHead>
                <TableHead>Награда</TableHead>
                <TableHead>Активно</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map(v => (
                <TableRow key={v.id}>
                  <TableCell>{v.title}</TableCell>
                  <TableCell>{v.duration_seconds}с</TableCell>
                  <TableCell>{v.reward_pt} PT</TableCell>
                  <TableCell>
                    <Switch checked={v.is_active} onCheckedChange={(val) => toggleVideo(v.id, val)} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => deleteVideo(v.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {videos.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Нет видео</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
