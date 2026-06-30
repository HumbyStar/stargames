import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, Loader2, Users, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  suggestAssignees,
  createConciergeTask,
  type ConciergeTaskType,
  type ConciergePriority,
  type SuggestedAssignee,
} from "@/lib/concierge-tasks.functions";

const TYPE_LABELS: Record<ConciergeTaskType, string> = {
  cobranca: "Cobrança",
  mgmv: "MGMV",
  envio: "Envio",
  importacao: "Importação",
  revisao_ia: "Revisão IA",
  cadastro: "Cadastro",
  financeiro: "Financeiro",
  atendimento: "Atendimento",
  leiloes: "Leilões",
  dados_inconsistentes: "Dados inconsistentes",
};
const PRIORITY_LABELS: Record<ConciergePriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

export interface ConciergeTaskDraft {
  taskType: ConciergeTaskType;
  title: string;
  description: string;
  priority: ConciergePriority;
  linkedFilter: Record<string, unknown> | null;
  linkedEntityType:
    | "client"
    | "product"
    | "mgmv_agreement"
    | "mgmv_installment"
    | "collection"
    | "import_batch"
    | null;
  linkedEntityId: string | null;
}

export function ConciergeTaskConfirmModal({
  open,
  draft,
  onClose,
  onCreated,
}: {
  open: boolean;
  draft: ConciergeTaskDraft | null;
  onClose: () => void;
  onCreated?: (createdIds: string[]) => void;
}) {
  const qc = useQueryClient();
  const suggestFn = useServerFn(suggestAssignees);
  const createFn = useServerFn(createConciergeTask);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ConciergePriority>("media");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingFields, setEditingFields] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setPriority(draft.priority);
    setSelected(new Set());
    setEditingFields(false);
  }, [draft]);

  const suggestQuery = useQuery({
    queryKey: ["concierge-suggest", draft?.taskType],
    queryFn: () => suggestFn({ data: { taskType: draft!.taskType } }),
    enabled: open && !!draft,
    staleTime: 30_000,
  });

  const suggestions = (suggestQuery.data ?? []) as SuggestedAssignee[];

  // Pré-seleciona todos os usuários compatíveis ao chegar
  useEffect(() => {
    if (suggestQuery.isSuccess && suggestions.length > 0 && selected.size === 0) {
      setSelected(new Set(suggestions.map((s) => s.id)));
    }
  }, [suggestQuery.isSuccess, suggestions, selected.size]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const createMut = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Sem rascunho.");
      const trimmedTitle = title.trim();
      if (trimmedTitle.length < 3) throw new Error("Informe um título com ao menos 3 caracteres.");
      return createFn({
        data: {
          title: trimmedTitle,
          description: description.trim() || null,
          taskType: draft.taskType,
          priority,
          assigneeIds: Array.from(selected),
          linkedFilter: (draft.linkedFilter ?? null) as any,
          linkedEntityType: draft.linkedEntityType ?? null,
          linkedEntityId: draft.linkedEntityId ?? null,
          source: "concierge",
        },
      });
    },
    onSuccess: (res) => {
      const ids = (res as { createdIds?: string[] })?.createdIds ?? [];
      toast.success(
        ids.length > 1
          ? `${ids.length} tarefas criadas com sucesso.`
          : "Tarefa criada com sucesso.",
        {
          action: ids.length
            ? {
                label: "Abrir tarefa",
                onClick: () => {
                  onClose();
                  setTimeout(() => {
                    const el = document.getElementById("equipe");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 60);
                },
              }
            : undefined,
        },
      );
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
      onCreated?.(ids);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasFilter = useMemo(() => {
    if (!draft?.linkedFilter) return false;
    return Object.keys(draft.linkedFilter).length > 0;
  }, [draft]);

  if (!draft) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
 <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" />
            Confirmar criação de tarefa
          </DialogTitle>
          <DialogDescription>
            Revise os detalhes antes de salvar. Nada é criado sem sua confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{TYPE_LABELS[draft.taskType]}</Badge>
            <Badge variant="outline">Origem: Concierge</Badge>
            {hasFilter && <Badge variant="outline">Filtro vinculado</Badge>}
          </div>

          <div className="space-y-1">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => {
                setEditingFields(true);
                setTitle(e.target.value);
              }}
              maxLength={180}
            />
          </div>

          <div className="space-y-1">
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => {
                setEditingFields(true);
                setDescription(e.target.value);
              }}
              rows={3}
              maxLength={2000}
              placeholder="Detalhes sobre a tarefa (opcional)"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as ConciergePriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as ConciergePriority[]).map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Filtro / dado vinculado</Label>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground min-h-[40px] flex items-center">
                {hasFilter
                  ? Object.entries(draft.linkedFilter!).map(([k, v]) => (
                      <span key={k} className="mr-2">
                        <strong>{k}</strong>: {String(v)}
                      </span>
                    ))
                  : "Sem filtro vinculado"}
              </div>
            </div>
          </div>

          <fieldset className="rounded-lg border border-border px-3 pb-3 pt-2">
            <legend className="px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
              <Users className="size-3.5" /> Responsáveis sugeridos
            </legend>
            {suggestQuery.isLoading && (
              <p className="py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Procurando usuários compatíveis…
              </p>
            )}
            {!suggestQuery.isLoading && suggestions.length === 0 && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                Nenhum usuário com responsabilidade compatível encontrado. Você pode criar a tarefa sem responsável e atribuí-la depois.
              </div>
            )}
            {!suggestQuery.isLoading && suggestions.length > 0 && (
              <div className="grid gap-2 max-h-[180px] overflow-y-auto pr-1">
                {suggestions.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={selected.has(u.id)}
                      onCheckedChange={() => toggle(u.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.name || u.email || u.id.slice(0, 8)}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {u.responsibilities.join(" · ")}
                      </p>
                    </div>
                    {selected.has(u.id) && (
                      <CheckCircle2 className="size-4 text-primary" />
                    )}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {selected.size === 0
                ? "Sem responsáveis selecionados — a tarefa será criada sem dono."
                : `${selected.size} responsáve${selected.size > 1 ? "is" : "l"} selecionado${selected.size > 1 ? "s" : ""}.`}
            </p>
          </fieldset>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={createMut.isPending}>
            <X className="size-4 mr-1" /> Cancelar
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || title.trim().length < 3}
          >
            {createMut.isPending ? (
              <><Loader2 className="size-4 animate-spin mr-1" /> Criando…</>
            ) : (
              <>Criar tarefa{selected.size > 1 ? "s" : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}