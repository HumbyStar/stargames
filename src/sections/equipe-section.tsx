import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Plus,
  AlertCircle,
  CheckCircle2,
  Clock,
  Flag,
  User as UserIcon,
  MessageSquare,
  X,
  Send,
  Package as PackageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  listTasks,
  listTeamMembers,
  createTask,
  updateTask,
  addTaskComment,
  listTaskComments,
  deleteTask,
  type TeamTask,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/team.functions";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";

const COLUMNS: { id: TaskStatus; label: string; tone: string }[] = [
  { id: "todo", label: "A Fazer", tone: "border-muted-foreground/30" },
  { id: "doing", label: "Em Andamento", tone: "border-primary/40" },
  { id: "review", label: "Revisão", tone: "border-warning/50" },
  { id: "blocked", label: "Bloqueado", tone: "border-destructive/40" },
  { id: "done", label: "Concluído", tone: "border-success/50" },
];

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baixa",
  med: "Média",
  high: "Alta",
  urgent: "Urgente",
};
const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  med: "bg-primary/15 text-primary",
  high: "bg-warning/20 text-warning-foreground",
  urgent: "bg-destructive/15 text-destructive",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function EquipeSection() {
  const { hasPermission, access } = usePermissions();
  const qc = useQueryClient();
  const listFn = useServerFn(listTasks);
  const membersFn = useServerFn(listTeamMembers);
  const updateFn = useServerFn(updateTask);

  const tasksQ = useQuery({
    queryKey: ["team-tasks"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });
  const membersQ = useQuery({
    queryKey: ["team-members"],
    queryFn: () => membersFn(),
    staleTime: 60_000,
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [openTask, setOpenTask] = useState<TeamTask | null>(null);
  const [confirmDone, setConfirmDone] = useState<{ task: TeamTask } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, TeamTask[]> = {
      todo: [], doing: [], review: [], blocked: [], done: [],
    };
    for (const t of tasksQ.data ?? []) map[t.status].push(t);
    return map;
  }, [tasksQ.data]);

  const canAssignTeam = hasPermission("team.assign.team") || hasPermission("team.assign.all");

  async function moveTo(task: TeamTask, status: TaskStatus) {
    if (status === task.status) return;
    if (status === "done") {
      setConfirmDone({ task });
      return;
    }
    try {
      await updateFn({ data: { id: task.id, status } });
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao mover tarefa");
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const target = e.over?.id as TaskStatus | undefined;
    if (!target) return;
    const task = (tasksQ.data ?? []).find((t) => t.id === taskId);
    if (!task) return;
    void moveTo(task, target);
  };

  if (!hasPermission("team.view") && !access?.roles.length) {
    return (
      <section id="equipe" className="one-page-section">
        <PageHeader title="Equipe" description="Você não tem permissão para visualizar o quadro." />
      </section>
    );
  }

  return (
    <section id="equipe" className="one-page-section">
      <PageHeader
        title="Equipe"
        description="Quadro estilo Trello com atribuição em escada empresarial e responsabilidades por papel."
        actions={
          <Button onClick={() => setOpenCreate(true)} size="sm">
            <Plus className="size-4" /> Nova tarefa
          </Button>
        }
      />

      {tasksQ.isLoading ? (
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          Carregando tarefas…
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {COLUMNS.map((col) => (
              <Column key={col.id} id={col.id} label={col.label} tone={col.tone}>
                {grouped[col.id].length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-6 italic">
                    Vazio
                  </div>
                ) : (
                  grouped[col.id].map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      assigneeName={
                        membersQ.data?.find((m) => m.id === t.assignee_id)?.fullName ??
                        membersQ.data?.find((m) => m.id === t.assignee_id)?.email ??
                        "Sem responsável"
                      }
                      onClick={() => setOpenTask(t)}
                    />
                  ))
                )}
              </Column>
            ))}
          </div>
        </DndContext>
      )}

      <CreateTaskDialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        members={membersQ.data ?? []}
        canAssignTeam={canAssignTeam}
        currentUserId={access?.userId ?? ""}
      />

      <TaskDetailDialog
        task={openTask}
        onClose={() => setOpenTask(null)}
        members={membersQ.data ?? []}
      />

      <CompletionDialog
        task={confirmDone?.task ?? null}
        onClose={() => setConfirmDone(null)}
      />
    </section>
  );
}

function Column({
  id,
  label,
  tone,
  children,
}: {
  id: TaskStatus;
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const count = Array.isArray(children) ? (children as any[]).length : 0;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl border-2 bg-card/40 backdrop-blur p-2 min-h-[300px] transition-colors",
        tone,
        isOver && "bg-primary/5 border-primary/60",
      )}
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </div>
      <div className="flex flex-col gap-2 mt-1">{children}</div>
    </div>
  );
}

function TaskCard({
  task,
  assigneeName,
  onClick,
}: {
  task: TeamTask;
  assigneeName: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const overdue =
    task.due_at && task.status !== "done" && new Date(task.due_at).getTime() < Date.now();
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "group cursor-grab active:cursor-grabbing rounded-xl border border-border bg-card p-3 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5",
        isDragging && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-tight line-clamp-2 flex-1">{task.title}</h4>
        <Badge
          variant="secondary"
          className={cn("text-[10px] shrink-0", PRIORITY_STYLES[task.priority])}
        >
          <Flag className="size-3 mr-0.5" />
          {PRIORITY_LABEL[task.priority]}
        </Badge>
      </div>
      {task.description ? (
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      ) : null}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1 truncate">
          <UserIcon className="size-3" />
          <span className="truncate max-w-[100px]">{assigneeName}</span>
        </span>
        {task.due_at && (
          <span
            className={cn(
              "flex items-center gap-1",
              overdue && "text-destructive font-medium",
            )}
          >
            <Clock className="size-3" />
            {fmtDate(task.due_at)}
          </span>
        )}
      </div>
      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTaskDialog({
  open,
  onClose,
  members,
  canAssignTeam,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  members: Array<{ id: string; fullName: string | null; email: string | null; roles: string[] }>;
  canAssignTeam: boolean;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createTask);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("med");
  const [assignee, setAssignee] = useState<string>(currentUserId || "self");
  const [dueAt, setDueAt] = useState<string>("");
  const [tagsStr, setTagsStr] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle(""); setDescription(""); setPriority("med");
    setAssignee(currentUserId || "self"); setDueAt(""); setTagsStr("");
  };

  const submit = async () => {
    const parsed = z.object({
      title: z.string().trim().min(1, "Título obrigatório").max(180),
    }).safeParse({ title });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          title: title.trim(),
          description: description.trim() || null,
          status: "todo",
          priority,
          assignee_id: assignee === "self" ? currentUserId || null : assignee || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          tags: tagsStr.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12),
        },
      });
      toast.success("Tarefa criada");
      reset();
      onClose();
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar tarefa");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>
            Atribuição segue a escada empresarial — você só vê pessoas que pode comandar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Título *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descrição</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Prioridade</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="med">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Prazo</label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Responsável</label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="self">Eu mesmo</SelectItem>
                {canAssignTeam &&
                  members
                    .filter((m) => m.id !== currentUserId)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.fullName ?? m.email ?? m.id.slice(0, 8)}
                        {m.roles.length > 0 && (
                          <span className="text-muted-foreground text-[10px] ml-1">
                            ({m.roles[0]})
                          </span>
                        )}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Tags (separadas por vírgula)
            </label>
            <Input
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="envio, urgente, cliente-vip"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? "Criando…" : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailDialog({
  task,
  onClose,
  members,
}: {
  task: TeamTask | null;
  onClose: () => void;
  members: Array<{ id: string; fullName: string | null; email: string | null }>;
}) {
  const qc = useQueryClient();
  const listCommentsFn = useServerFn(listTaskComments);
  const addCommentFn = useServerFn(addTaskComment);
  const updateFn = useServerFn(updateTask);
  const deleteFn = useServerFn(deleteTask);
  const { hasPermission, access } = usePermissions();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "observation">("comment");
  const [busy, setBusy] = useState(false);

  const commentsQ = useQuery({
    queryKey: ["task-comments", task?.id],
    queryFn: () => listCommentsFn({ data: { task_id: task!.id } }),
    enabled: !!task,
  });

  if (!task) return null;
  const assigneeName =
    members.find((m) => m.id === task.assignee_id)?.fullName ??
    members.find((m) => m.id === task.assignee_id)?.email ??
    "Sem responsável";

  const sendComment = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addCommentFn({ data: { task_id: task.id, body: body.trim(), kind } });
      setBody("");
      qc.invalidateQueries({ queryKey: ["task-comments", task.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao comentar");
    } finally {
      setBusy(false);
    }
  };

  const markShipped = async () => {
    try {
      await updateFn({
        data: { id: task.id, status: "done", completionNote: "Marcado como ENVIADO." },
      });
      toast.success("Tarefa marcada como enviada");
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
      qc.invalidateQueries({ queryKey: ["task-comments", task.id] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const removeTask = async () => {
    if (!confirm("Excluir esta tarefa?")) return;
    try {
      await deleteFn({ data: { id: task.id } });
      toast.success("Tarefa excluída");
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const canShip = hasPermission("shipping.mark_sent");
  const isOwner = task.created_by === access?.userId;

  return (
    <Dialog open={!!task} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2">
            <span className="flex-1">{task.title}</span>
            <Badge variant="secondary" className={cn("text-[10px]", PRIORITY_STYLES[task.priority])}>
              {PRIORITY_LABEL[task.priority]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-3 mt-1 text-xs">
              <span className="flex items-center gap-1">
                <UserIcon className="size-3" /> {assigneeName}
              </span>
              {task.due_at && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" /> {new Date(task.due_at).toLocaleString("pt-BR")}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Flag className="size-3" /> {task.status}
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>

        {task.description && (
          <div className="rounded-lg bg-muted/40 p-3 text-sm">{task.description}</div>
        )}

        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(["todo", "doing", "review", "blocked", "done"] as TaskStatus[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={task.status === s ? "default" : "outline"}
              onClick={async () => {
                if (s === "done") {
                  const note = prompt("Descreva brevemente a conclusão:");
                  if (!note || note.trim().length < 3) {
                    toast.error("Conclusão precisa de no mínimo 3 caracteres");
                    return;
                  }
                  await updateFn({ data: { id: task.id, status: s, completionNote: note } });
                } else {
                  await updateFn({ data: { id: task.id, status: s } });
                }
                qc.invalidateQueries({ queryKey: ["team-tasks"] });
                qc.invalidateQueries({ queryKey: ["task-comments", task.id] });
                onClose();
              }}
            >
              {COLUMNS.find((c) => c.id === s)?.label}
            </Button>
          ))}
        </div>

        {canShip && task.status !== "done" && (
          <Button onClick={markShipped} variant="secondary" size="sm">
            <Send className="size-4" /> Marcar como enviado
          </Button>
        )}
        {hasPermission("mgmv.register_product") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              toast.message("Abra a seção MGMV para cadastrar o produto vinculado.");
            }}
          >
            <PackageIcon className="size-4" /> Cadastrar produto MGMV
          </Button>
        )}

        <div className="mt-2 border-t pt-3">
          <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
            <MessageSquare className="size-3.5" /> Comentários e observações
          </h4>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {(commentsQ.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">Sem comentários ainda.</p>
            )}
            {(commentsQ.data ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border bg-card p-2 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px]">
                    {c.kind === "completion"
                      ? <><CheckCircle2 className="size-3 inline" /> Conclusão</>
                      : c.kind === "observation"
                      ? <><AlertCircle className="size-3 inline" /> Observação</>
                      : "Comentário"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comment">Comentário</SelectItem>
                <SelectItem value="observation">Observação</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Escreva..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendComment()}
            />
            <Button onClick={sendComment} disabled={busy || !body.trim()} size="sm">
              <Send className="size-4" />
            </Button>
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          {isOwner && (
            <Button variant="ghost" size="sm" onClick={removeTask}>
              <X className="size-4" /> Excluir
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompletionDialog({ task, onClose }: { task: TeamTask | null; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateTask);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!task) return null;

  const confirm = async () => {
    if (note.trim().length < 3) {
      toast.error("Descreva a conclusão (mín. 3 caracteres)");
      return;
    }
    setBusy(true);
    try {
      await updateFn({
        data: { id: task.id, status: "done", completionNote: note.trim() },
      });
      toast.success("Tarefa concluída");
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
      setNote("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Concluir tarefa</DialogTitle>
          <DialogDescription>
            Conte rapidamente como ficou — fica registrado na linha do tempo.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="Ex: Envio confirmado via Correios, código XYZ."
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Salvando…" : "Concluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}