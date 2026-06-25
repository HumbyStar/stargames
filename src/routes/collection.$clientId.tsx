import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Alert, Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  daysLate,
  formatBRL,
  formatDateBR,
  isOverdue,
  productCollectionStatus,
  useStore,
} from "@/lib/store";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/collection/$clientId")({
  head: () => ({ meta: [{ title: "Cobrança do cliente — Star Games" }] }),
  component: ClientCollectionPage,
  notFoundComponent: () => (
    <AppLayout>
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">Cliente não encontrado.</p>
      </div>
    </AppLayout>
  ),
});

function ClientCollectionPage() {
  const { clientId } = Route.useParams();
  const navigate = useNavigate();
  const {
    clients,
    products,
    registerPayment,
    markResolved,
    updateProductNotes,
    updateClientNotes,
    payMGMVInstallment,
  } = useStore();

  const client = clients.find((c) => c.id === clientId);
  const clientProducts = products.filter((p) => p.clientId === clientId);
  const [noteDraft, setNoteDraft] = useState(client?.notes ?? "");

  if (!client) {
    return (
      <AppLayout>
        <PageHeader title="Cliente não encontrado" />
        <Button asChild variant="outline"><Link to="/collection">Voltar</Link></Button>
      </AppLayout>
    );
  }

  const openProducts = clientProducts.filter((p) => p.situation === "Em Aberto");
  const totalAberto = openProducts.reduce((a, p) => a + (p.totalValue - p.paidValue), 0);
  const totalPago = clientProducts.reduce((a, p) => a + p.paidValue, 0);
  const totalRestante = clientProducts.reduce(
    (a, p) => (p.situation === "Em Aberto" ? a + (p.totalValue - p.paidValue) : a),
    0,
  );
  const proxVenc = openProducts
    .map((p) => p.dueDate)
    .sort()
    .find(() => true);
  const maiorAtraso = Math.max(0, ...openProducts.map((p) => daysLate(p.dueDate)));
  const isInadimplente = openProducts.some((p) => isOverdue(p.dueDate));

  const hasOverdueReserva = openProducts.some(
    (p) => p.financialStatus === "Reserva" && isOverdue(p.dueDate),
  );
  const hasPendencia = openProducts.some((p) => p.financialStatus === "Pendente");

  const quickPayment = (productId: string, remaining: number) => {
    const raw = window.prompt("Valor recebido (R$):", remaining.toFixed(2));
    if (!raw) return;
    const amount = Number(raw.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    registerPayment(productId, amount);
    toast.success("Pagamento registrado");
  };

  const copyMessage = (productName: string, remaining: number) => {
    const msg = `Olá, ${client.name}. Identificamos uma pendência referente ao item ${productName}, no valor restante de ${formatBRL(remaining)}. Podemos regularizar?`;
    navigator.clipboard.writeText(msg);
    toast.success("Mensagem copiada");
  };

  const mgmv = client.mgmv;
  const mgmvPaidCount = mgmv?.installments.filter((i) => i.paid).length ?? 0;
  const mgmvRemaining = mgmv
    ? mgmv.installments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0)
    : 0;
  const mgmvPct = mgmv ? Math.round((mgmvPaidCount / mgmv.installments.length) * 100) : 0;
  const mgmvNext = mgmv?.installments.find((i) => !i.paid);

  return (
    <AppLayout>
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/collection" })}>
          <ArrowLeft className="size-4" /> Voltar para Collection
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
            {isInadimplente && <Tag variant="danger">Inadimplente</Tag>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Telefone: {client.phone}</p>
        </div>
        <Button
          onClick={() => {
            const p = openProducts[0];
            if (!p) return toast.info("Nenhum produto em aberto.");
            quickPayment(p.id, p.totalValue - p.paidValue);
          }}
        >
          Registrar Pagamento
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Total em aberto" value={formatBRL(totalAberto)} status="danger" />
        <MetricCard label="Valor pago" value={formatBRL(totalPago)} status="success" />
        <MetricCard label="Valor restante" value={formatBRL(totalRestante)} />
        <MetricCard label="Produtos em cobrança" value={openProducts.length} />
        <MetricCard label="Próximo vencimento" value={proxVenc ? formatDateBR(proxVenc) : "—"} />
        <MetricCard label="Maior atraso" value={`${maiorAtraso} dias`} status="danger" />
      </div>

      {(hasOverdueReserva || hasPendencia) && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {hasOverdueReserva && (
            <Alert
              type="danger"
              title="Reserva vencida"
              text="Cliente possui produto com reserva vencida."
            />
          )}
          {hasPendencia && (
            <Alert
              type="warning"
              title="Pendência em aberto"
              text="Existe valor restante aguardando regularização."
            />
          )}
        </div>
      )}

      <Card className="mt-6" title="Produtos do cliente">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Produto</th>
                <th className="py-2 pr-3 font-medium">Plataforma</th>
                <th className="py-2 pr-3 font-medium">Total</th>
                <th className="py-2 pr-3 font-medium">Pago</th>
                <th className="py-2 pr-3 font-medium">Restante</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 pr-3 font-medium">Cadastro</th>
                <th className="py-2 pr-3 font-medium">Limite</th>
                <th className="py-2 pr-3 font-medium">Atraso</th>
                <th className="py-2 pr-3 font-medium">Observações</th>
                <th className="py-2 pr-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {clientProducts.map((p) => {
                const remaining = p.totalValue - p.paidValue;
                const status = productCollectionStatus(p);
                const late = daysLate(p.dueDate);
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0 align-top">
                    <td className="py-3 pr-3 font-medium">{p.name}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{p.platform}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatBRL(p.totalValue)}</td>
                    <td className="py-3 pr-3 tabular-nums text-muted-foreground">{formatBRL(p.paidValue)}</td>
                    <td className="py-3 pr-3 tabular-nums font-medium">{formatBRL(remaining)}</td>
                    <td className="py-3 pr-3"><Tag variant={status.variant === "danger" ? "danger" : status.variant === "warning" ? "warning" : "neutral"}>{status.label}</Tag></td>
                    <td className="py-3 pr-3"><Tag>{p.situation}</Tag></td>
                    <td className="py-3 pr-3 text-muted-foreground">{formatDateBR(p.registerDate)}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{formatDateBR(p.dueDate)}</td>
                    <td className="py-3 pr-3">{late > 0 ? <Tag variant="danger">{late} dias</Tag> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-3 pr-3">
                      <input
                        defaultValue={p.notes ?? ""}
                        placeholder="Sem observações"
                        onBlur={(e) => {
                          if (e.target.value !== (p.notes ?? "")) {
                            updateProductNotes(p.id, e.target.value);
                            toast.success("Observação salva");
                          }
                        }}
                        className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs"
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => copyMessage(p.name, remaining)}>Copiar</Button>
                        <Button size="sm" onClick={() => quickPayment(p.id, remaining)} disabled={p.situation !== "Em Aberto"}>Pagar</Button>
                        <Button size="sm" variant="outline" onClick={() => { markResolved(p.id); toast.success("Marcado como resolvido"); }} disabled={p.situation !== "Em Aberto"}>Resolver</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {clientProducts.length === 0 && (
                <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">Sem produtos para este cliente.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {mgmv && (
        <Card className="mt-6" title="Acordo MGMV Ativo">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 text-sm">
              <p><span className="text-muted-foreground">Data do acordo:</span> {formatDateBR(mgmv.startDate)}</p>
              <p><span className="text-muted-foreground">Valor da dívida:</span> {formatBRL(mgmv.totalDebt)}</p>
              <p><span className="text-muted-foreground">Parcelas:</span> {mgmvPaidCount}/{mgmv.installments.length} pagas</p>
              <p><span className="text-muted-foreground">Saldo restante:</span> {formatBRL(mgmvRemaining)}</p>
              <p><span className="text-muted-foreground">Próximo vencimento:</span> {mgmvNext ? formatDateBR(mgmvNext.dueDate) : "—"}</p>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">Progresso</span><span className="font-medium">{mgmvPct}% quitado</span></div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${mgmvPct}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Parcela</th>
                  <th className="py-2 pr-3 font-medium">Vencimento</th>
                  <th className="py-2 pr-3 font-medium">Valor</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Pagamento</th>
                  <th className="py-2 pr-3 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {mgmv.installments.map((i) => {
                  const overdue = !i.paid && isOverdue(i.dueDate);
                  return (
                    <tr key={i.number} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-3 font-medium">{i.number}/{i.total}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{formatDateBR(i.dueDate)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatBRL(i.value)}</td>
                      <td className="py-3 pr-3">
                        {i.paid ? <Tag variant="success">Pago</Tag> : overdue ? <Tag variant="danger">Vencida</Tag> : <Tag variant="warning">Pendente</Tag>}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">{i.paidAt ? formatDateBR(i.paidAt) : "—"}</td>
                      <td className="py-3 pr-3">
                        <Button size="sm" disabled={i.paid} onClick={() => { payMGMVInstallment(client.id, i.number); toast.success("Parcela registrada"); }}>
                          {i.paid ? "Pago" : "Registrar"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-6" title="Observações da Cobrança">
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Adicionar nova observação sobre a cobrança..."
          className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
        />
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() => {
              updateClientNotes(client.id, noteDraft);
              toast.success("Observação salva");
            }}
          >
            Salvar observação
          </Button>
        </div>
      </Card>
    </AppLayout>
  );
}