import { useCallback, useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  scanDataIntegrity,
  applyIntegrityFix,
  type IntegrityFinding,
  type ScanResult,
} from "@/lib/data-integrity.functions";

type Props = {
  open: boolean;
  onClose: () => void;
};

const SEVERITY: Record<IntegrityFinding["severity"], { label: string; wrap: string; icon: typeof AlertTriangle }> = {
  danger: { label: "Crítico", wrap: "border-rose-300/60 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10", icon: AlertTriangle },
  warning: { label: "Atenção", wrap: "border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10", icon: AlertTriangle },
  info: { label: "Aviso", wrap: "border-border bg-background", icon: ShieldCheck },
};

export function DataIntegrityPanel({ open, onClose }: Props) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const scan = useServerFn(scanDataIntegrity);
  const applyFix = useServerFn(applyIntegrityFix);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const r = (await scan()) as ScanResult;
      setResult(r);
      setResolved({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao validar dados");
    } finally {
      setScanning(false);
    }
  }, [scan]);

  useEffect(() => {
    if (open && !result && !scanning) void runScan();
  }, [open, result, scanning, runScan]);

  useEffect(() => {
    if (!open) {
      // mantém último resultado, só reseta resolvidos quando fechar
      setApplying({});
    }
  }, [open]);

  const handleApply = async (f: IntegrityFinding) => {
    if (!f.fixLabel) return;
    if (!confirm(`Aplicar correção?\n\n${f.title}\n${f.fixLabel}`)) return;
    setApplying((s) => ({ ...s, [f.id]: true }));
    try {
      const r = await applyFix({ data: { type: f.type as any, targetId: f.targetId } });
      if ((r as any).ok) {
        toast.success((r as any).message || "Correção aplicada");
        setResolved((s) => ({ ...s, [f.id]: true }));
      } else {
        toast.error((r as any).error || "Não foi possível aplicar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao aplicar correção");
    } finally {
      setApplying((s) => ({ ...s, [f.id]: false }));
    }
  };

  const findings = result?.findings ?? [];
  const pending = findings.filter((f) => !resolved[f.id]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-[61] flex flex-col bg-background text-foreground shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "inset-0 w-screen h-[100dvh] max-w-none rounded-none border-0",
            "md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2",
            "md:w-[94vw] md:max-w-3xl md:h-auto md:max-h-[88vh] md:rounded-3xl md:border md:border-border",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Validação assistida de dados</DialogPrimitive.Title>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-2xl border border-border bg-background/80 text-muted-foreground hover:bg-accent"
          >
            <X className="size-5" />
          </button>

          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-8 md:px-8">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="size-6" />
              </span>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">Validação assistida</h2>
                <p className="text-sm text-muted-foreground">
                  A IA varre os dados, mostra os problemas e aplica correções só com sua confirmação.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={() => void runScan()} disabled={scanning} variant="outline" size="sm">
                {scanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {scanning ? "Validando…" : "Revalidar"}
              </Button>
              {result && (
                <span className="text-xs text-muted-foreground">
                  {pending.length} pendente(s) • última verificação{" "}
                  {new Date(result.scannedAt).toLocaleTimeString("pt-BR")}
                </span>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-3">
              {scanning && !result && (
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  Analisando integridade dos dados…
                </div>
              )}

              {!scanning && result && pending.length === 0 && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/60 bg-emerald-50 p-5 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-300" />
                  <p className="font-medium">Tudo certo. Nenhum problema de dados detectado.</p>
                </div>
              )}

              {pending.map((f) => {
                const sev = SEVERITY[f.severity];
                const Icon = sev.icon;
                const busy = !!applying[f.id];
                return (
                  <article key={f.id} className={cn("rounded-2xl border p-4", sev.wrap)}>
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background/60 text-foreground">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          {sev.label}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold">{f.title}</p>
                        <p className="mt-1 text-[13px] text-foreground/80">{f.detail}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {f.fixLabel ? (
                            <Button
                              size="sm"
                              onClick={() => void handleApply(f)}
                              disabled={busy}
                            >
                              {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                              {f.fixLabel}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Sem correção automática — revisar manualmente.
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setResolved((s) => ({ ...s, [f.id]: true }))}
                          >
                            Ignorar
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}