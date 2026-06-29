import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LogIn, LogOut, Coffee, Utensils, Smile, Frown } from "lucide-react";
import { punchClock, listMyPunch, type PunchKind, type PunchEntry } from "@/lib/punch.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const KIND_META: Record<PunchKind, { label: string; icon: any; tone: string }> = {
  in: { label: "Entrada", icon: LogIn, tone: "bg-success/15 text-success border-success/30" },
  lunch_out: { label: "Saída p/ almoço", icon: Utensils, tone: "bg-warning/15 text-warning-foreground border-warning/30" },
  lunch_in: { label: "Volta do almoço", icon: Coffee, tone: "bg-primary/15 text-primary border-primary/30" },
  out: { label: "Saída final", icon: LogOut, tone: "bg-destructive/15 text-destructive border-destructive/30" },
};
const ORDER: PunchKind[] = ["in", "lunch_out", "lunch_in", "out"];

export function TeamPunch() {
  const qc = useQueryClient();
  const punchFn = useServerFn(punchClock);
  const listFn = useServerFn(listMyPunch);

  const q = useQuery({
    queryKey: ["my-punch"],
    queryFn: () => listFn(),
    staleTime: 15_000,
  });

  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const today = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(new Date());
  })();
  const todays = (q.data ?? []).filter((p) => p.day === today);
  const doneKinds = new Set(todays.map((p) => p.kind));
  const next = ORDER.find((k) => !doneKinds.has(k)) ?? null;

  const punch = async (kind: PunchKind) => {
    if (kind === "out") {
      setFeedbackOpen(true);
      return;
    }
    try {
      await punchFn({ data: { kind } });
      toast.success(`${KIND_META[kind].label} registrada`);
      qc.invalidateQueries({ queryKey: ["my-punch"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  // Agrupa por dia
  const byDay = new Map<string, PunchEntry[]>();
  for (const e of q.data ?? []) {
    const arr = byDay.get(e.day) ?? [];
    arr.push(e); byDay.set(e.day, arr);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Ponto de hoje</h3>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
          </div>
          {next ? (
            <Button onClick={() => punch(next)} size="sm">
              Bater {KIND_META[next].label.toLowerCase()}
            </Button>
          ) : (
            <Badge variant="outline">Jornada completa ✓</Badge>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {ORDER.map((k) => {
            const Meta = KIND_META[k];
            const entry = todays.find((p) => p.kind === k);
            return (
              <div
                key={k}
                className={cn(
                  "rounded-xl border p-3 flex flex-col gap-1",
                  entry ? Meta.tone : "bg-muted/30 border-dashed text-muted-foreground",
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Meta.icon className="size-3.5" /> {Meta.label}
                </div>
                <div className="text-base font-mono">
                  {entry
                    ? new Date(entry.punched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                    : "--:--"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-2">Histórico</h3>
        {byDay.size === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nenhuma batida registrada ainda.</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {Array.from(byDay.entries()).map(([day, entries]) => (
              <div key={day} className="border-l-2 border-primary/40 pl-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {new Date(day + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {entries.map((e) => (
                    <Badge key={e.id} variant="outline" className={cn("gap-1", KIND_META[e.kind].tone)}>
                      {KIND_META[e.kind].label}: {new Date(e.punched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </Badge>
                  ))}
                </div>
                {entries.find((e) => e.kind === "out" && e.feedback_optimization) && (
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    💬 {entries.find((e) => e.kind === "out")?.feedback_optimization}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onDone={() => qc.invalidateQueries({ queryKey: ["my-punch"] })}
      />
    </div>
  );
}

function FeedbackDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const punchFn = useServerFn(punchClock);
  const [mood, setMood] = useState(0);
  const [env, setEnv] = useState(0);
  const [opt, setOpt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!mood || !env || opt.trim().length < 3) {
      toast.error("Preencha humor, ambiente e sugestão de otimização.");
      return;
    }
    setBusy(true);
    try {
      await punchFn({
        data: {
          kind: "out",
          feedback: { mood, environment: env, optimization: opt.trim(), notes: notes.trim() || undefined },
        },
      });
      toast.success("Saída registrada. Bom descanso!");
      setMood(0); setEnv(0); setOpt(""); setNotes("");
      onDone(); onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Feedback do dia</DialogTitle>
          <DialogDescription>
            Antes de bater a saída final, conte rapidinho como foi o dia. Leva 20 segundos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Rating label="Como você está se sentindo?" leftIcon={Frown} rightIcon={Smile} value={mood} onChange={setMood} />
          <Rating label="Como avalia o ambiente hoje?" value={env} onChange={setEnv} />
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Sugestão para otimizar o trabalho amanhã *
            </label>
            <Textarea value={opt} onChange={(e) => setOpt(e.target.value)} rows={3} maxLength={1500}
              placeholder="Ex: pré-separar pedidos ao chegar para acelerar a primeira hora." />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Observações (opcional)</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Registrando…" : "Bater ponto de saída"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Rating({
  label, value, onChange, leftIcon: L, rightIcon: R,
}: { label: string; value: number; onChange: (v: number) => void; leftIcon?: any; rightIcon?: any }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label} *</label>
      <div className="mt-1 flex items-center gap-2">
        {L && <L className="size-4 text-muted-foreground" />}
        <div className="flex gap-1 flex-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={cn(
                "flex-1 h-9 rounded-md border text-sm font-medium transition-colors",
                value >= n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground border-border",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {R && <R className="size-4 text-muted-foreground" />}
      </div>
    </div>
  );
}
