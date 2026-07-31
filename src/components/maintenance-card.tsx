import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wrench, Loader2, ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMaintenanceState, setMaintenanceMode } from "@/lib/maintenance.functions";
import { cn } from "@/lib/utils";

export function MaintenanceCard() {
  const getState = useServerFn(getMaintenanceState);
  const setState = useServerFn(setMaintenanceMode);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<null | "on" | "off">(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await getState();
      setActive(s.active);
      setStartedAt(s.startedAt);
      setMessage(s.message);
      setIsAdmin(s.isAdmin);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (!loading && !isAdmin) {
    return (
      <Card>
        <div className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          O modo manutenção é gerenciado apenas por administradores.
        </div>
      </Card>
    );
  }

  const toggle = async (nextActive: boolean, msg: string) => {
    setBusy(true);
    try {
      const s = await setState({ data: { active: nextActive, message: msg } });
      setActive(s.active);
      setStartedAt(s.startedAt);
      setMessage(s.message);
      toast.success(
        nextActive ? "Modo manutenção ativado." : "Modo manutenção desativado.",
        {
          description: nextActive
            ? "Usuários comuns foram bloqueados e verão a página de manutenção."
            : "O sistema voltou ao normal para todos os usuários.",
        },
      );
    } catch (error) {
      toast.error("Não foi possível alterar o modo manutenção.", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
      setConfirmToggle(null);
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
                  active
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-primary/10 text-primary",
                )}
              >
                <Wrench className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Modo Manutenção</h3>
                <p className="max-w-prose text-xs text-muted-foreground">
                  Bloqueia o acesso de usuários comuns enquanto o banco de dados é
                  migrado para a nova conta Supabase. Admins e Admin Master
                  continuam com acesso total.
                </p>
              </div>
            </div>
            <Badge variant={active ? "default" : "secondary"}>
              {loading ? "Carregando…" : active ? "Ativo" : "Inativo"}
            </Badge>
          </div>

          {active && startedAt && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Manutenção em andamento desde{" "}
                {new Date(startedAt).toLocaleString("pt-BR")}
              </p>
              {message ? (
                <p className="mt-1 text-muted-foreground">{message}</p>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="maintenance-message">Mensagem exibida aos usuários (opcional)</Label>
            <Input
              id="maintenance-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ex.: Migração do banco em andamento. Voltamos em instantes."
              maxLength={500}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {active ? (
              <Button
                onClick={() => setConfirmToggle("off")}
                disabled={busy || loading}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Lock className="size-4" />
                )}
                Desativar manutenção
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => setConfirmToggle("on")}
                disabled={busy || loading}
              >
                <Wrench className="size-4" />
                Ativar modo manutenção
              </Button>
            )}
            <Button variant="outline" onClick={() => void refresh()} disabled={busy || loading}>
              Atualizar
            </Button>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Ao ativar, usuários comuns são redirecionados para a página de
            manutenção em até 30 segundos. O próximo passo é gerar o pacote de
            migração e importar na nova conta Supabase.
          </p>
        </div>
      </Card>

      <Dialog
        open={confirmToggle !== null}
        onOpenChange={(open) => !open && setConfirmToggle(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="size-5" />
              {confirmToggle === "on"
                ? "Ativar modo manutenção?"
                : "Desativar modo manutenção?"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {confirmToggle === "on" ? (
                  <>
                    <p>
                      Todos os usuários que não sejam admin ou admin master serão
                      bloqueados e verão a página de manutenção. Certifique-se de
                      que a migração está pronta para começar.
                    </p>
                    {message.trim() && (
                      <p className="rounded-lg border border-border bg-muted/40 p-2">
                        Mensagem: “{message}”
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    O sistema voltará ao normal para todos os usuários. Apenas faça
                    isso depois de validar a migração.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmToggle(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            {confirmToggle === "on" ? (
              <Button
                variant="destructive"
                onClick={() => void toggle(true, message)}
                disabled={busy}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                Ativar e bloquear usuários
              </Button>
            ) : (
              <Button onClick={() => void toggle(false, "")} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
                Desativar e liberar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
