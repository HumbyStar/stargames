import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getCurrentBusinessSummary } from "@/lib/backup.functions";
import type { BusinessSummary } from "@/lib/backup.functions";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

function fmt(n: number): string {
  return (n ?? 0).toLocaleString("pt-BR");
}
function money(cents: number): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function DeltaBadge({ delta, invert = false }: { delta: number; invert?: boolean }) {
  if (delta === 0)
    return <span className="text-[10px] text-muted-foreground">=</span>;
  const positive = delta > 0;
  const good = invert ? !positive : positive;
  return (
    <span
      className={cn(
        "ml-1 rounded px-1 text-[10px] font-semibold tabular-nums",
        good
          ? "bg-emerald-500/15 text-emerald-600"
          : "bg-destructive/15 text-destructive",
      )}
    >
      {positive ? "+" : ""}
      {delta.toLocaleString("pt-BR")}
    </span>
  );
}

function DeltaMoney({ delta, invert = false }: { delta: number; invert?: boolean }) {
  if (delta === 0)
    return <span className="text-[10px] text-muted-foreground">=</span>;
  const positive = delta > 0;
  const good = invert ? !positive : positive;
  return (
    <span
      className={cn(
        "ml-1 rounded px-1 text-[10px] font-semibold tabular-nums",
        good
          ? "bg-emerald-500/15 text-emerald-600"
          : "bg-destructive/15 text-destructive",
      )}
    >
      {positive ? "+" : ""}
      {money(delta)}
    </span>
  );
}

function Row({
  label,
  backup,
  current,
  money: isMoney = false,
  invertDelta = false,
}: {
  label: string;
  backup: number;
  current: number;
  money?: boolean;
  invertDelta?: boolean;
}) {
  const delta = backup - current;
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-xs text-muted-foreground">
          Atual: {isMoney ? money(current) : fmt(current)}
        </span>
        <span className="text-sm font-semibold">
          {isMoney ? money(backup) : fmt(backup)}
        </span>
        {isMoney ? (
          <DeltaMoney delta={delta} invert={invertDelta} />
        ) : (
          <DeltaBadge delta={delta} invert={invertDelta} />
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function MapDiff({
  title,
  backup,
  current,
}: {
  title: string;
  backup: Record<string, number>;
  current: Record<string, number>;
}) {
  const keys = Array.from(new Set([...Object.keys(backup), ...Object.keys(current)])).sort();
  if (keys.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        {keys.map((k) => (
          <Row key={k} label={k} backup={backup[k] ?? 0} current={current[k] ?? 0} />
        ))}
      </div>
    </div>
  );
}

export function BackupSummaryModal({
  open,
  onClose,
  backupSummary,
  filename,
}: {
  open: boolean;
  onClose: () => void;
  backupSummary: BusinessSummary | null;
  filename?: string;
}) {
  const getCurrent = useServerFn(getCurrentBusinessSummary);
  const [current, setCurrent] = useState<BusinessSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getCurrent()
      .then(setCurrent)
      .finally(() => setLoading(false));
  }, [open, getCurrent]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resumo do backup</DialogTitle>
          <DialogDescription>
            {filename ? `Arquivo: ${filename}. ` : ""}
            Comparação lado-a-lado com o estado atual do banco.
          </DialogDescription>
        </DialogHeader>

        {!backupSummary ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Este backup foi gerado antes da feature de resumo. Gere um novo backup para
            visualizar as métricas de negócio.
          </div>
        ) : loading || !current ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Calculando estado atual…
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Clientes">
              <Row label="Total" backup={backupSummary.clients.total} current={current.clients.total} />
              <Row
                label="Com ficha completa"
                backup={backupSummary.clients.withFicha}
                current={current.clients.withFicha}
              />
              <Row
                label="Sem ficha"
                backup={backupSummary.clients.withoutFicha}
                current={current.clients.withoutFicha}
                invertDelta
              />
              <Row
                label="Exclusivos MGMV"
                backup={backupSummary.clients.mgmvOnly}
                current={current.clients.mgmvOnly}
              />
            </Section>

            <Section title="Produtos">
              <Row label="Total" backup={backupSummary.products.total} current={current.products.total} />
              <Row
                label="Com NF emitida"
                backup={backupSummary.products.withNf}
                current={current.products.withNf}
              />
              <Row
                label="Sem NF"
                backup={backupSummary.products.withoutNf}
                current={current.products.withoutNf}
              />
              <MapDiff
                title="Por situação"
                backup={backupSummary.products.bySituation}
                current={current.products.bySituation}
              />
              <MapDiff
                title="Por status financeiro"
                backup={backupSummary.products.byFinancialStatus}
                current={current.products.byFinancialStatus}
              />
            </Section>

            <Section title="MGMV">
              <Row
                label="Acordos totais"
                backup={backupSummary.mgmv.agreements}
                current={current.mgmv.agreements}
              />
              <Row
                label="Ativos"
                backup={backupSummary.mgmv.active}
                current={current.mgmv.active}
              />
              <Row
                label="Concluídos"
                backup={backupSummary.mgmv.completed}
                current={current.mgmv.completed}
              />
              <Row
                label="Precisam revisão"
                backup={backupSummary.mgmv.needsReview}
                current={current.mgmv.needsReview}
                invertDelta
              />
              <Row
                label="Parcelas pagas"
                backup={backupSummary.mgmv.installmentsPaid}
                current={current.mgmv.installmentsPaid}
              />
              <Row
                label="Parcelas pendentes"
                backup={backupSummary.mgmv.installmentsPending}
                current={current.mgmv.installmentsPending}
                invertDelta
              />
              <Row
                label="Parcelas vencidas"
                backup={backupSummary.mgmv.installmentsOverdue}
                current={current.mgmv.installmentsOverdue}
                invertDelta
              />
              <Row
                label="Total acordado"
                backup={backupSummary.mgmv.totalAgreedCents}
                current={current.mgmv.totalAgreedCents}
                money
              />
              <Row
                label="Total pago"
                backup={backupSummary.mgmv.totalPaidCents}
                current={current.mgmv.totalPaidCents}
                money
              />
              <Row
                label="Saldo restante"
                backup={backupSummary.mgmv.remainingCents}
                current={current.mgmv.remainingCents}
                money
                invertDelta
              />
            </Section>

            <Section title="Financeiro">
              <Row
                label="Recebido"
                backup={backupSummary.financeiro.receivedCents}
                current={current.financeiro.receivedCents}
                money
              />
              <Row
                label="A receber"
                backup={backupSummary.financeiro.receivableCents}
                current={current.financeiro.receivableCents}
                money
              />
              <Row
                label="Inadimplência"
                backup={backupSummary.financeiro.overdueCents}
                current={current.financeiro.overdueCents}
                money
                invertDelta
              />
            </Section>

            <Section title="Notas Fiscais">
              <Row
                label="Emitidas"
                backup={backupSummary.nfInvoices.total}
                current={current.nfInvoices.total}
              />
              <Row
                label="Valor total"
                backup={backupSummary.nfInvoices.totalCents}
                current={current.nfInvoices.totalCents}
                money
              />
            </Section>

            <Section title="Equipe">
              <Row
                label="Tarefas totais"
                backup={backupSummary.team.tasksTotal}
                current={current.team.tasksTotal}
              />
              <Row
                label="Batidas de ponto (mês)"
                backup={backupSummary.team.punchesThisMonth}
                current={current.team.punchesThisMonth}
              />
              <MapDiff
                title="Tarefas por status"
                backup={backupSummary.team.tasksByStatus}
                current={current.team.tasksByStatus}
              />
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}