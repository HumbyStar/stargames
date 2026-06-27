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
  Folder,
  FolderCheck,
  FolderOpen,
  PackageCheck,
  Sparkles,
  Timer,
  Trophy,
  User,
  Zap,
} from "lucide-react";

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

  const startedMs = new Date(state.startedAt).getTime();
  const elapsedMs = Math.max(0, now - startedMs);
  const ratePerSec = processed > 0 && elapsedMs > 0 ? processed / (elapsedMs / 1000) : 0;
  const remaining = Math.max(0, total - processed);
  const etaMs = state.done ? 0 : ratePerSec > 0 ? (remaining / ratePerSec) * 1000 : Infinity;
  const ratePerMin = ratePerSec * 60;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && (state.done || state.resumed)) onClose(); }}>
      <DialogContent className="max-w-xl" onInteractOutside={(e) => { if (!state.done) e.preventDefault(); }}>
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
                : "Importando suas pastas…"}
          </DialogTitle>
          <DialogDescription>
            {state.done
              ? "Tudo certo. Veja o resumo abaixo."
              : state.resumed
                ? <>A última importação de <span className="font-medium text-foreground">{state.zipName}</span> não terminou. Reenvie o ZIP para continuar — duplicatas serão detectadas automaticamente.</>
              : currentFolder
                ? <>Processando <span className="font-medium text-foreground">{currentFolder}</span> — {tip}</>
                : "Preparando a esteira…"}
          </DialogDescription>
        </DialogHeader>

        {/* Esteira animada */}
        <div className="relative h-28 overflow-hidden rounded-lg border bg-gradient-to-b from-muted/40 to-muted/10">
          {/* Trilhos da esteira */}
          <div className="absolute inset-x-0 bottom-3 h-3 rounded bg-foreground/10" />
          <div className="absolute inset-x-0 bottom-3 h-3 overflow-hidden rounded">
            <div
              className="h-full w-[200%] opacity-60"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, hsl(var(--foreground)/0.15) 0 10px, transparent 10px 20px)",
                animation: state.done || state.resumed ? "none" : "conveyor-belt 1.2s linear infinite",
              }}
            />
          </div>

          {/* Carga: pastas que passam */}
          <div className="absolute inset-x-0 bottom-6 flex items-end">
            <div
              className="flex gap-6 px-4 will-change-transform"
              style={{
                animation: state.done || state.resumed ? "none" : "conveyor-load 5s linear infinite",
              }}
            >
              {Array.from({ length: 10 }).map((_, i) => {
                const Icon = i % 3 === 0 ? User : i % 3 === 1 ? Folder : PackageCheck;
                return (
                  <div key={i} className="flex h-12 w-12 items-center justify-center rounded-md bg-card shadow-sm border">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Spotlight da pasta atual */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 text-xs font-medium shadow-sm border">
            {state.done ? (
              <>
                <FolderCheck className="h-4 w-4 text-emerald-500" />
                {total} pasta{total === 1 ? "" : "s"} processada{total === 1 ? "" : "s"}
              </>
            ) : (
              <>
                <FolderOpen className="h-4 w-4 text-primary" />
                {processed} / {total || 1}
              </>
            )}
          </div>
        </div>

        {/* Barra de progresso */}
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{pct}%</span>
            <span>
              {state.stats.createdClients + state.stats.updatedClients} clientes • {state.stats.createdProducts} produtos
            </span>
          </div>
        </div>

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

        <style>{`
          @keyframes conveyor-belt {
            0% { transform: translateX(0); }
            100% { transform: translateX(-20px); }
          }
          @keyframes conveyor-load {
            0% { transform: translateX(100%); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}