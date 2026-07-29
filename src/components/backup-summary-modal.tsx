import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCurrentBusinessSummary } from "@/lib/backup.functions";
import type { BusinessSummary } from "@/lib/backup.functions";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Users,
  Package,
  Handshake,
  Wallet,
  FileText,
  UsersRound,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  FileArchive,
} from "lucide-react";

function fmt(n: number): string {
  return (n ?? 0).toLocaleString("pt-BR");
}
function money(cents: number): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function DeltaPill({
  delta,
  isMoney = false,
  invert = false,
}: {
  delta: number;
  isMoney?: boolean;
  invert?: boolean;
}) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Minus className="size-3" />
        sem alteração
      </span>
    );
  }
  const positive = delta > 0;
  const good = invert ? !positive : positive;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
        good
          ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
          : "bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="size-3" />
      {positive ? "+" : ""}
      {isMoney ? money(delta) : delta.toLocaleString("pt-BR")}
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
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Atual: {isMoney ? money(current) : fmt(current)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {isMoney ? money(backup) : fmt(backup)}
        </span>
        <DeltaPill delta={delta} isMoney={isMoney} invert={invertDelta} />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  accent = "primary",
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "primary" | "success" | "warning" | "destructive";
  children: React.ReactNode;
}) {
  const iconStyles = {
    primary: "bg-primary/10 text-primary",
    success: "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    warning: "bg-[color:var(--warning)]/25 text-[color:var(--warning-foreground)]",
    destructive: "bg-destructive/10 text-destructive",
  }[accent];
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", iconStyles)}>
          <Icon className="size-4" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="divide-y divide-border/40 p-1.5">{children}</div>
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
    <div className="mt-3 rounded-lg border border-dashed border-border/60 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0 flex flex-col gap-0 sm:!flex sm:!flex-col sm:!gap-0 sm:!p-0">
        <DialogHeader className="border-b border-border bg-gradient-to-br from-primary/5 via-card to-card px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileArchive className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg">Resumo do backup</DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                Comparação lado a lado do snapshot com o estado atual do banco.
              </DialogDescription>
              {filename ? (
                <span className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <FileArchive className="size-3 shrink-0" />
                  <span className="truncate">{filename}</span>
                </span>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {!backupSummary ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              Este backup foi gerado antes da feature de resumo. Gere um novo backup
              para visualizar as métricas de negócio.
            </div>
          ) : loading || !current ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Calculando estado atual…
            </div>
          ) : (
            <Tabs defaultValue="clientes" className="w-full">
              <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
                <TabsTrigger value="clientes" className="gap-1.5">
                  <Users className="size-3.5" /> Clientes
                </TabsTrigger>
                <TabsTrigger value="produtos" className="gap-1.5">
                  <Package className="size-3.5" /> Produtos
                </TabsTrigger>
                <TabsTrigger value="mgmv" className="gap-1.5">
                  <Handshake className="size-3.5" /> MGMV
                </TabsTrigger>
                <TabsTrigger value="financeiro" className="gap-1.5">
                  <Wallet className="size-3.5" /> Financeiro
                </TabsTrigger>
                <TabsTrigger value="nf" className="gap-1.5">
                  <FileText className="size-3.5" /> Notas Fiscais
                </TabsTrigger>
                <TabsTrigger value="equipe" className="gap-1.5">
                  <UsersRound className="size-3.5" /> Equipe
                </TabsTrigger>
              </TabsList>

              <TabsContent value="clientes" className="mt-0">
                <SectionCard title="Clientes" icon={Users} accent="primary">
                  <Row label="Total" backup={backupSummary.clients.total} current={current.clients.total} />
                  <Row label="Com ficha completa" backup={backupSummary.clients.withFicha} current={current.clients.withFicha} />
                  <Row label="Sem ficha" backup={backupSummary.clients.withoutFicha} current={current.clients.withoutFicha} invertDelta />
                  <Row label="Exclusivos MGMV" backup={backupSummary.clients.mgmvOnly} current={current.clients.mgmvOnly} />
                </SectionCard>
              </TabsContent>

              <TabsContent value="produtos" className="mt-0">
                <SectionCard title="Produtos" icon={Package} accent="primary">
                  <Row label="Total" backup={backupSummary.products.total} current={current.products.total} />
                  <Row label="Com NF emitida" backup={backupSummary.products.withNf} current={current.products.withNf} />
                  <Row label="Sem NF" backup={backupSummary.products.withoutNf} current={current.products.withoutNf} />
                  <MapDiff title="Por situação" backup={backupSummary.products.bySituation} current={current.products.bySituation} />
                  <MapDiff title="Por status financeiro" backup={backupSummary.products.byFinancialStatus} current={current.products.byFinancialStatus} />
                </SectionCard>
              </TabsContent>

              <TabsContent value="mgmv" className="mt-0 space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title="Acordos" icon={Handshake} accent="primary">
                    <Row label="Acordos totais" backup={backupSummary.mgmv.agreements} current={current.mgmv.agreements} />
                    <Row label="Ativos" backup={backupSummary.mgmv.active} current={current.mgmv.active} />
                    <Row label="Concluídos" backup={backupSummary.mgmv.completed} current={current.mgmv.completed} />
                    <Row label="Precisam revisão" backup={backupSummary.mgmv.needsReview} current={current.mgmv.needsReview} invertDelta />
                  </SectionCard>
                  <SectionCard title="Parcelas" icon={Wallet} accent="warning">
                    <Row label="Pagas" backup={backupSummary.mgmv.installmentsPaid} current={current.mgmv.installmentsPaid} />
                    <Row label="Pendentes" backup={backupSummary.mgmv.installmentsPending} current={current.mgmv.installmentsPending} invertDelta />
                    <Row label="Vencidas" backup={backupSummary.mgmv.installmentsOverdue} current={current.mgmv.installmentsOverdue} invertDelta />
                  </SectionCard>
                </div>
                <SectionCard title="Valores" icon={Wallet} accent="success">
                  <Row label="Total acordado" backup={backupSummary.mgmv.totalAgreedCents} current={current.mgmv.totalAgreedCents} money />
                  <Row label="Total pago" backup={backupSummary.mgmv.totalPaidCents} current={current.mgmv.totalPaidCents} money />
                  <Row label="Saldo restante" backup={backupSummary.mgmv.remainingCents} current={current.mgmv.remainingCents} money invertDelta />
                </SectionCard>
              </TabsContent>

              <TabsContent value="financeiro" className="mt-0">
                <SectionCard title="Financeiro" icon={Wallet} accent="success">
                  <Row label="Recebido" backup={backupSummary.financeiro.receivedCents} current={current.financeiro.receivedCents} money />
                  <Row label="A receber" backup={backupSummary.financeiro.receivableCents} current={current.financeiro.receivableCents} money />
                  <Row label="Inadimplência" backup={backupSummary.financeiro.overdueCents} current={current.financeiro.overdueCents} money invertDelta />
                </SectionCard>
              </TabsContent>

              <TabsContent value="nf" className="mt-0">
                <SectionCard title="Notas Fiscais" icon={FileText} accent="primary">
                  <Row label="Emitidas" backup={backupSummary.nfInvoices.total} current={current.nfInvoices.total} />
                  <Row label="Valor total" backup={backupSummary.nfInvoices.totalCents} current={current.nfInvoices.totalCents} money />
                </SectionCard>
              </TabsContent>

              <TabsContent value="equipe" className="mt-0">
                <SectionCard title="Equipe" icon={UsersRound} accent="primary">
                  <Row label="Tarefas totais" backup={backupSummary.team.tasksTotal} current={current.team.tasksTotal} />
                  <Row label="Batidas de ponto (mês)" backup={backupSummary.team.punchesThisMonth} current={current.team.punchesThisMonth} />
                  <MapDiff title="Tarefas por status" backup={backupSummary.team.tasksByStatus} current={current.team.tasksByStatus} />
                </SectionCard>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}