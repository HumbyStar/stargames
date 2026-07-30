import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  FlaskConical,
  Copy,
  Trash2,
  LogIn,
  LogOut,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSandbox, reloadAppData } from "@/lib/use-sandbox";
import { cloneProductionToSandbox, resetSandbox } from "@/lib/sandbox.functions";
import { cn } from "@/lib/utils";

const TABLE_LABELS: Record<string, string> = {
  clients: "Clientes",
  products: "Produtos",
  mgmv_agreements: "Acordos MGMV",
  mgmv_installments: "Parcelas MGMV",
  nf_invoices: "Notas fiscais",
  import_history: "Importações",
  team_tasks: "Tarefas",
  team_task_comments: "Comentários",
  team_task_activity: "Atividades",
  team_punch_entries: "Pontos",
  saved_filters: "Filtros salvos",
  ai_automations: "Automações",
  app_settings: "Configurações",
  ai_training_profile: "Treino da IA",
};

export function SandboxSettingsCard() {
  const { state, loading, refresh, setActive } = useSandbox();
  const navigate = useNavigate();
  const clone = useServerFn(cloneProductionToSandbox);
  const reset = useServerFn(resetSandbox);

  const [busy, setBusy] = useState<null | "enter" | "exit" | "clone" | "reset">(null);
  const [confirmEnter, setConfirmEnter] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const totalRows = Object.values(state.counts ?? {}).reduce((sum, n) => sum + n, 0);
  const empty = totalRows === 0;

  if (!loading && !state.isAdmin) {
    return (
      <Card>
        <div className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          O ambiente de teste está disponível apenas para administradores.
        </div>
      </Card>
    );
  }

  const runClone = async () => {
    setBusy("clone");
    try {
      const result = await clone();
      const copied = Object.values(result.copied).reduce((s, n) => s + n, 0);
      if (result.errors.length > 0) {
        toast.warning(`Clonagem concluída com avisos (${result.errors.length}).`, {
          description: result.errors.slice(0, 3).join(" · "),
        });
      } else {
        toast.success(`Sandbox atualizado com ${copied} registros da produção.`);
      }
      await refresh();
      if (state.active) reloadAppData();
    } catch (error) {
      toast.error("Falha ao clonar a produção.", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const runReset = async () => {
    setBusy("reset");
    try {
      await reset();
      toast.success("Sandbox limpo.");
      await refresh();
      if (state.active) reloadAppData();
    } catch (error) {
      toast.error("Falha ao limpar o sandbox.", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  };

  const toggle = async (active: boolean) => {
    setBusy(active ? "enter" : "exit");
    try {
      await setActive(active);
      toast.success(active ? "Modo Teste ativado." : "De volta à produção.");
    } catch (error) {
      toast.error("Não foi possível alternar o ambiente.", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
      setConfirmEnter(false);
    }
  };

  return (
    <>
      <Card>
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl",
                  state.active
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-primary/10 text-primary",
                )}
              >
                <FlaskConical className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Ambiente de Teste (Sandbox)</h3>
                <p className="max-w-prose text-xs text-muted-foreground">
                  Uma cópia do sistema com os mesmos dados. Tudo que você fizer aqui —
                  importar, editar, apagar, gerar backup — não altera a produção.
                </p>
              </div>
            </div>
            <Badge variant={state.active ? "default" : "secondary"}>
              {loading ? "Carregando…" : state.active ? "Modo Teste" : "Produção"}
            </Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Registros no sandbox
              </p>
              <p className="text-lg font-semibold tabular-nums">{totalRows}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Última clonagem
              </p>
              <p className="text-lg font-semibold">
                {state.clonedAt
                  ? new Date(state.clonedAt).toLocaleString("pt-BR")
                  : "Nunca"}
              </p>
            </div>
          </div>

          {totalRows > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(state.counts)
                .filter(([, n]) => n > 0)
                .map(([table, n]) => (
                  <Badge key={table} variant="outline" className="font-normal">
                    {TABLE_LABELS[table] ?? table}: <span className="ml-1 tabular-nums">{n}</span>
                  </Badge>
                ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {state.active ? (
              <Button
                onClick={async () => {
                  await toggle(false);
                  void navigate({ to: "/" });
                }}
                disabled={busy !== null}
              >
                {busy === "exit" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                Sair do Modo Teste
              </Button>
            ) : (
              <Button onClick={() => setConfirmEnter(true)} disabled={busy !== null || loading}>
                <LogIn className="size-4" />
                Abrir Modo Teste
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void runClone()}
              disabled={busy !== null}
            >
              {busy === "clone" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Copy className="size-4" />
              )}
              {empty ? "Clonar dados de produção" : "Reclonar produção"}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmReset(true)}
              disabled={busy !== null || empty}
            >
              <Trash2 className="size-4" />
              Resetar sandbox
            </Button>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Usuários, papéis, log de auditoria e backups não são copiados. Os arquivos HTML
            originais continuam sendo lidos do acervo real (somente leitura).
          </p>
        </div>
      </Card>

      <Dialog open={confirmEnter} onOpenChange={(open) => !open && setConfirmEnter(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entrar no Modo Teste?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  A partir de agora todas as seções (Clientes, MGMV, Cobrança, Finanças,
                  Equipe, Importação e Backups) passam a mostrar apenas os dados de teste.
                  A produção fica intacta.
                </p>
                {empty && (
                  <p className="rounded-lg border border-border bg-muted/40 p-2">
                    O sandbox está vazio. Recomendamos clonar a produção antes de entrar.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnter(false)} disabled={busy !== null}>
              Cancelar
            </Button>
            {empty && (
              <Button variant="outline" onClick={() => void runClone()} disabled={busy !== null}>
                {busy === "clone" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Copy className="size-4" />
                )}
                Clonar agora
              </Button>
            )}
            <Button
              onClick={() => {
                setConfirmEnter(false);
                void navigate({ to: "/sandbox" });
              }}
              disabled={busy !== null}
            >
              <LogIn className="size-4" />
              Abrir página de teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={(open) => !open && setConfirmReset(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar o sandbox?</DialogTitle>
            <DialogDescription>
              Todos os dados de teste serão apagados. A produção não é afetada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmReset(false)} disabled={busy !== null}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void runReset()} disabled={busy !== null}>
              {busy === "reset" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Apagar dados de teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}