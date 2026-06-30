import { useEffect, useState } from "react";
import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  AlertOctagon,
  Box,
  CheckCircle2,
  Copy,
  FolderOpen,
  Lock,
  PhoneCall,
  RefreshCcw,
  RotateCw,
  Upload,
  ShieldCheck,
  Sparkles,
  Timer,
  UserPlus,
  Zap,
} from "lucide-react";
import { ImportCard, ImportCardsGrid } from "@/components/import-cards";
import { ImportConveyor } from "@/components/import-conveyor";

export type ImportProgressState = {
  fileHash: string;
  zipName: string;
  startedAt: string; // ISO
  folders: string[];
  currentIdx: number; // -1 = aguardando, folders.length = concluído
  messages: string[];
  errors: string[];
  stats: {
    createdClients: number;
    updatedClients: number;
    createdProducts: number;
    createdAgreements: number;
    replacedAgreements: number;
    ignoredDuplicates: number;
    errorEntries: number;
    skippedAfterCorrection: number;
  };
  ignoredItems?: Array<{
    client: string;
    product: string;
    date: string;
    folder: string;
  }>;
  recordsTotal?: number;
  recordsProcessed?: number;
  currentBatchSize?: number;
  currentBatchProcessed?: number;
  retrying?: { attempt: number; reason: string } | null;
  done: boolean;
  resumed?: boolean; // carregado do banco após reload
};

const FUN_TIPS = [
  "Empacotando clientes com carinho…",
  "Conferindo telefones um por um…",
  "Carimbando produtos no histórico…",
  "Atravessando a esteira de pastas…",
  "Polindo os acordos MGMV…",
  "Quase lá, mais uma pastinha…",
];

function fmtDuration(ms: number) {
  if (!isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function ImportProgressModal({
  state,
  open,
  onClose,
  onDiscard,
  onResume,
}: {
  state: ImportProgressState | null;
  open: boolean;
  onClose: () => void;
  onDiscard?: () => void;
  onResume?: (file: File) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [countdown, setCountdown] = useState<number | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const running = !!(state && !state.done && !state.resumed);

  // Aviso de reload/fechar aba é gerido pelo router via useBlocker no parent.

  useEffect(() => {
    if (!state || state.done || state.resumed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.done, state?.resumed, state?.fileHash]);

  // Auto-close em 5s quando concluído com sucesso (sem ser retomado)
  useEffect(() => {
    // Se há duplicatas ou erros para revisar, não auto-fecha — usuário decide.
    const hasReviewItems =
      !!state && (
        (state.ignoredItems?.length ?? 0) > 0 ||
        state.stats.errorEntries > 0 ||
        state.errors.length > 0
      );
    if (!state?.done || state.resumed || hasReviewItems) {
      setCountdown(null);
      return;
    }
    setCountdown(5);
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          clearInterval(id);
          onClose();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state?.done, state?.resumed, state?.fileHash, onClose]);

  if (!state) return null;

  // Tela de sucesso dedicada
  if (state.done && !state.resumed) {
    const s = state.stats;
    const totalClients = s.createdClients + s.updatedClients;
    const successItems = ([
      { label: "Clientes novos", value: s.createdClients, tone: "ok" as const },
      { label: "Clientes atualizados", value: s.updatedClients, tone: "info" as const },
      { label: "Produtos importados", value: s.createdProducts, tone: "ok" as const },
      { label: "Acordos MGMV criados", value: s.createdAgreements, tone: "ok" as const },
      { label: "Acordos MGMV substituídos", value: s.replacedAgreements, tone: "info" as const },
      { label: "Telefones auto-corrigidos", value: s.skippedAfterCorrection, tone: "info" as const },
    ]).filter((i) => i.value > 0);
    const softAlerts = ([
      {
        label: "Duplicatas ignoradas",
        value: s.ignoredDuplicates,
        tone: "warn" as const,
        hint: "Produtos já existentes (mesmo cliente, nome e data) — não foram reprocessados.",
      },
      {
        label: "Entradas com erro",
        value: s.errorEntries,
        tone: "danger" as const,
        hint: "Linhas que não puderam ser importadas por dados inválidos ou ausentes.",
      },
    ]).filter((i) => i.value > 0);
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
 <DialogContent className="border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 via-background to-emerald-500/5">
          <DialogHeader className="sr-only">
            <DialogTitle>Importação concluída</DialogTitle>
            <DialogDescription>Resumo da importação</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-5 py-2 text-center">
            <div className="relative grid h-20 w-20 place-items-center rounded-full bg-emerald-500/15 ring-8 ring-emerald-500/10 animate-scale-in">
              <CheckCircle2 className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
              <span className="absolute inset-0 rounded-full ring-2 ring-emerald-500/40 animate-ping" />
            </div>
            <div className="space-y-1 animate-fade-in">
              <h2 className="text-2xl font-semibold text-emerald-700 dark:text-emerald-300">
                Tudo certo! 🎉
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Sua importação de <span className="font-medium text-foreground">{state.zipName}</span> foi concluída com sucesso e os dados já estão atualizados na sua operação.
              </p>
            </div>
            <div className="grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Clientes</div>
                <div className="font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-300">{totalClients}</div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Produtos</div>
                <div className="font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-300">{s.createdProducts}</div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Acordos</div>
                <div className="font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-300">{s.createdAgreements}</div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pastas</div>
                <div className="font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-300">{state.folders.length}</div>
              </div>
            </div>

            {(successItems.length > 0 || softAlerts.length > 0) && (
              <div className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" /> Importado com sucesso
                  </div>
                  {successItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Nenhum item novo desta vez.</div>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {successItems.map((i) => (
                        <li key={i.label} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{i.label}</span>
                          <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-300">{i.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" /> Alertas suaves
                  </div>
                  {softAlerts.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Sem duplicatas nem erros — importação 100% limpa.</div>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {softAlerts.map((i) => (
                        <li key={i.label} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className={i.tone === "danger" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}>{i.label}</span>
                            <span className={`font-mono font-semibold ${i.tone === "danger" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>{i.value}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{i.hint}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {(state.ignoredItems?.length ?? 0) > 0 && (
              <details className="w-full max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-left">
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                  <span className="flex items-center gap-2">
                    <Copy className="h-4 w-4" /> Ver duplicatas ignoradas ({state.ignoredItems!.length})
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Critérios: cliente + produto + data</span>
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Estes itens já existiam na sua base e <span className="font-medium text-foreground">não foram reprocessados</span>. A detecção compara, para cada produto, o cliente (por telefone), o nome do produto e a data de cadastro — combinação exata = duplicata.
                  </p>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-amber-500/20 bg-background/50">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 font-medium">Cliente</th>
                          <th className="px-2 py-1 font-medium">Produto</th>
                          <th className="px-2 py-1 font-medium">Data</th>
                          <th className="px-2 py-1 font-medium">Pasta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.ignoredItems!.slice(0, 200).map((it, i) => (
                          <tr key={i} className="border-t border-amber-500/10">
                            <td className="px-2 py-1 truncate max-w-[14ch]">{it.client}</td>
                            <td className="px-2 py-1 truncate max-w-[20ch]">{it.product}</td>
                            <td className="px-2 py-1 font-mono">{it.date || "—"}</td>
                            <td className="px-2 py-1 truncate max-w-[16ch] text-muted-foreground">{it.folder}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {state.ignoredItems!.length > 200 && (
                    <div className="text-[11px] text-muted-foreground">
                      Mostrando 200 de {state.ignoredItems!.length}. Os demais seguem o mesmo critério.
                    </div>
                  )}
                </div>
              </details>
            )}

            {countdown !== null && (
              <div className="text-xs text-muted-foreground">
                Fechando em <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{countdown}</span>s…
              </div>
            )}
            <Button
              onClick={onClose}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Ver agora
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const total = state.folders.length;
  const idx = state.currentIdx;
  const processed = state.done ? total : Math.max(idx, 0);
  const pct = total === 0 ? 100 : Math.min(100, Math.round((processed / total) * 100));
  const currentFolder = idx >= 0 && idx < total ? state.folders[idx] : null;
  const tip = FUN_TIPS[(Math.max(idx, 0)) % FUN_TIPS.length];
  const conveyorState: "processing" | "done" | "cancelled" =
    state.done ? "done" : state.resumed ? "cancelled" : "processing";

  const startedMs = new Date(state.startedAt).getTime();
  const elapsedMs = Math.max(0, now - startedMs);
  const ratePerSec = processed > 0 && elapsedMs > 0 ? processed / (elapsedMs / 1000) : 0;
  const remaining = Math.max(0, total - processed);
  const etaMs = state.done ? 0 : ratePerSec > 0 ? (remaining / ratePerSec) * 1000 : Infinity;
  const ratePerMin = ratePerSec * 60;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && (state.done || state.resumed)) onClose(); }}>
      <DialogContent
        hideClose={running}
        onInteractOutside={(e) => { if (!state.done) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (running) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (running) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.resumed ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : running ? (
              <Lock className="h-5 w-5 text-primary" />
            ) : (
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
            )}
            {state.resumed ? "Retomar importação" : "Importação em andamento — não feche esta tela"}
          </DialogTitle>
          <DialogDescription>
            {state.resumed
              ? (
                <>
                  A importação anterior de <span className="font-medium text-foreground">{state.zipName}</span> ficou pendente.{" "}
                  Reenvie <span className="font-medium text-foreground">exatamente o mesmo ZIP</span> e continuaremos de onde parou —{" "}
                  <span className="font-medium text-foreground">{state.stats.createdClients + state.stats.updatedClients}</span> cliente(s) e{" "}
                  <span className="font-medium text-foreground">{state.stats.createdProducts}</span> produto(s) já foram processados e serão{" "}
                  <span className="font-medium text-foreground">pulados automaticamente</span> pela detecção de duplicatas (cliente + produto + data).
                </>
              )
              : currentFolder
                ? <>Lote atual: <span className="font-medium text-foreground">{currentFolder}</span> — {tip} A tela fica travada até concluir, processando 100% dos arquivos sem limites.</>
                : "Preparando a esteira…"}
          </DialogDescription>
        </DialogHeader>

        {/* Esteira animada contínua (maior) */}
        <ImportConveyor running={running} state={conveyorState} height="h-40" />

        {/* Barra de progresso */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Lote {Math.min(processed + (state.done ? 0 : 1), Math.max(total, 1))} de {Math.max(total, 1)}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Cards de métricas */}
        <ImportCardsGrid className="lg:grid-cols-4 xl:grid-cols-4">
          <ImportCard icon={FolderOpen} title="Pastas" value={total} hint={`${processed} processadas`} tone="info" />
          <ImportCard icon={UserPlus} title="Clientes novos" value={state.stats.createdClients} tone="common" />
          <ImportCard icon={RefreshCcw} title="Atualizados" value={state.stats.updatedClients} tone="neutral" />
          <ImportCard icon={Box} title="Produtos" value={state.stats.createdProducts} tone="common" />
          <ImportCard icon={ShieldCheck} title="Acordos MGMV" value={state.stats.createdAgreements} hint={state.stats.replacedAgreements ? `${state.stats.replacedAgreements} substituídos` : undefined} tone="mgmv" />
          <ImportCard icon={Copy} title="Duplicatas" value={state.stats.ignoredDuplicates} tone="warning" />
          <ImportCard icon={PhoneCall} title="Telefones corrigidos" value={state.stats.skippedAfterCorrection} tone="success" />
          <ImportCard icon={AlertOctagon} title="Erros" value={state.stats.errorEntries} tone={state.stats.errorEntries > 0 ? "danger" : "neutral"} />
        </ImportCardsGrid>

        {/* Métricas: tempo decorrido, taxa, ETA */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Timer className="h-3 w-3" /> Decorrido
            </div>
            <div className="mt-0.5 font-mono text-sm">{fmtDuration(elapsedMs)}</div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Zap className="h-3 w-3" /> Taxa
            </div>
            <div className="mt-0.5 font-mono text-sm">
              {ratePerMin > 0 ? `${ratePerMin.toFixed(1)}/min` : "—"}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Restante
            </div>
            <div className="mt-0.5 font-mono text-sm">
              {state.done ? "0s" : fmtDuration(etaMs)}
            </div>
          </div>
        </div>

        {state.errors.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1">
            {state.errors.slice(-5).map((e, i) => (
              <div key={i} className="text-destructive">⚠️ {e}</div>
            ))}
          </div>
        )}

        {state.resumed && (
          <DialogFooter>
            {onResume && (
              <>
                <input
                  ref={resumeInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onResume(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  onClick={() => resumeInputRef.current?.click()}
                  className="gap-2"
                >
                  <RotateCw className="h-4 w-4" />
                  Reenviar o mesmo ZIP e retomar
                </Button>
              </>
            )}
            {onDiscard && (
              <Button variant="ghost" onClick={onDiscard}>Descartar progresso</Button>
            )}
            <Button onClick={onClose}>Fechar</Button>
          </DialogFooter>
        )}

      </DialogContent>
    </Dialog>
  );
}