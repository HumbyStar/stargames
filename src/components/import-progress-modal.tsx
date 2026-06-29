import { useEffect, useRef, useState } from "react";
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
  Copy,
  FolderOpen,
  PackageCheck,
  PhoneCall,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trophy,
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
}: {
  state: ImportProgressState | null;
  open: boolean;
  onClose: () => void;
  onDiscard?: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state || state.done || state.resumed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.done, state?.resumed, state?.fileHash]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state?.messages.length]);

  if (!state) return null;

  const total = state.folders.length;
  const idx = state.currentIdx;
  const processed = state.done ? total : Math.max(idx, 0);
  const pct = total === 0 ? 100 : Math.min(100, Math.round((processed / total) * 100));
  const currentFolder = idx >= 0 && idx < total ? state.folders[idx] : null;
  const tip = FUN_TIPS[(Math.max(idx, 0)) % FUN_TIPS.length];
  const conveyorState: "processing" | "done" | "cancelled" =
    state.done ? "done" : state.resumed ? "cancelled" : "processing";
  const running = !state.done && !state.resumed;

  const startedMs = new Date(state.startedAt).getTime();
  const elapsedMs = Math.max(0, now - startedMs);
  const ratePerSec = processed > 0 && elapsedMs > 0 ? processed / (elapsedMs / 1000) : 0;
  const remaining = Math.max(0, total - processed);
  const etaMs = state.done ? 0 : ratePerSec > 0 ? (remaining / ratePerSec) * 1000 : Infinity;
  const ratePerMin = ratePerSec * 60;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && (state.done || state.resumed)) onClose(); }}>
      <DialogContent className="max-w-3xl" onInteractOutside={(e) => { if (!state.done) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.done ? (
              <Trophy className="h-5 w-5 text-amber-500" />
            ) : state.resumed ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
            )}
            {state.done
              ? "Importação concluída!"
              : state.resumed
                ? "Importação interrompida"
                : "Processando em lotes…"}
          </DialogTitle>
          <DialogDescription>
            {state.done
              ? "Tudo certo."
              : state.resumed
                ? <>A última importação de <span className="font-medium text-foreground">{state.zipName}</span> não terminou. Reenvie o ZIP para continuar — duplicatas serão detectadas automaticamente.</>
              : currentFolder
                ? <>Lote atual: <span className="font-medium text-foreground">{currentFolder}</span> — {tip}</>
                : "Preparando a esteira…"}
          </DialogDescription>
        </DialogHeader>

        {/* Esteira animada contínua */}
        <ImportConveyor running={running} state={conveyorState} />

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

        {/* Log de mensagens */}
        <div
          ref={logRef}
          className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs font-mono space-y-1"
        >
          {state.messages.length === 0 ? (
            <div className="text-muted-foreground">Iniciando…</div>
          ) : (
            state.messages.map((m, i) => (
              <div key={i} className="animate-fade-in">{m}</div>
            ))
          )}
          {state.errors.length > 0 && (
            <div className="mt-2 border-t border-destructive/30 pt-2 space-y-1">
              {state.errors.map((e, i) => (
                <div key={i} className="text-destructive">⚠️ {e}</div>
              ))}
            </div>
          )}
        </div>

        {(state.done || state.resumed) && (
          <DialogFooter>
            {state.resumed && !state.done && onDiscard && (
              <Button variant="ghost" onClick={onDiscard}>Descartar progresso</Button>
            )}
            <Button onClick={onClose}>Fechar</Button>
          </DialogFooter>
        )}

      </DialogContent>
    </Dialog>
  );
}