import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Alert, Card, MetricCard, PageHeader, StackedBar } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, isOverdue, shouldAppearInCollection, formatBRL } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Star Games" },
      { name: "description", content: "Indicadores operacionais da Star Games." },
      { property: "og:title", content: "Dashboard — Star Games" },
      { property: "og:description", content: "Indicadores operacionais." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const { clients, products } = useStore();

  const overdueProducts = products.filter(shouldAppearInCollection);
  const reservasAtivas = products.filter(
    (p) => p.financialStatus === "Reserva" && p.situation === "Em Aberto",
  ).length;
  const reservasVencidas = products.filter(
    (p) => p.financialStatus === "Reserva" && p.situation === "Em Aberto" && isOverdue(p.dueDate),
  ).length;
  const pendencias = products.filter(
    (p) => p.financialStatus === "Pendente" && p.situation === "Em Aberto",
  ).length;
  const clientesMGMV = clients.filter((c) => c.mgmv).length;
  const mgmvVencidas = clients.reduce(
    (acc, c) =>
      acc + (c.mgmv?.installments.filter((i) => !i.paid && isOverdue(i.dueDate)).length ?? 0),
    0,
  );
  const pagosAgEnvio = products.filter(
    (p) => p.financialStatus === "Pago" && p.situation === "Em Aberto",
  ).length;
  const enviados = products.filter((p) => p.situation === "Enviado").length;
  const desistencias = products.filter((p) => p.situation === "Desistiu").length;
  const abandonos = products.filter((p) => p.situation === "Abandonou").length;

  const total = products.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const finPago = products.filter((p) => p.financialStatus === "Pago").length;
  const finReserva = products.filter((p) => p.financialStatus === "Reserva").length;
  const finMGMV = products.filter((p) => p.financialStatus === "MGMV").length;
  const finPend = products.filter((p) => p.financialStatus === "Pendente").length;

  const aberto = products.filter((p) => p.situation === "Em Aberto").length;

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        description="Acompanhe os principais indicadores operacionais da Star Games."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total Clientes" value={clients.length} />
        <MetricCard label="Reservas Ativas" value={reservasAtivas} status="primary" />
        <MetricCard label="Reservas Vencidas" value={reservasVencidas} status="danger" />
        <MetricCard label="Pendências" value={pendencias} status="danger" />
        <MetricCard label="Clientes MGMV" value={clientesMGMV} />
        <MetricCard label="MGMV Vencidas" value={mgmvVencidas} status="danger" />
        <MetricCard label="Pagos Ag. Envio" value={pagosAgEnvio} status="success" />
        <MetricCard label="Produtos Enviados" value={enviados} />
        <MetricCard label="Desistências" value={desistencias} />
        <MetricCard label="Abandonos" value={abandonos} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => navigate({ to: "/import" })}>Importar Dados</Button>
        <Button variant="outline" onClick={() => navigate({ to: "/collection" })}>
          Ver Cobranças
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/collection", search: { filter: "mgmv_vencido" } as never })}
        >
          Ver MGMV Vencido
        </Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Status Financeiro">
          <StackedBar
            segments={[
              { label: "Pago", percent: pct(finPago), color: "oklch(0.65 0.16 150)" },
              { label: "Reserva", percent: pct(finReserva), color: "oklch(0.78 0.15 75)" },
              { label: "MGMV", percent: pct(finMGMV), color: "oklch(0.55 0.2 260)" },
              { label: "Pendente", percent: pct(finPend), color: "oklch(0.6 0.22 25)" },
            ]}
          />
        </Card>
        <Card title="Situação dos Produtos">
          <StackedBar
            segments={[
              { label: "Em Aberto", percent: pct(aberto), color: "oklch(0.55 0.2 260)" },
              { label: "Enviado", percent: pct(enviados), color: "oklch(0.65 0.16 150)" },
              { label: "Desistiu", percent: pct(desistencias), color: "oklch(0.72 0.16 50)" },
              { label: "Abandonou", percent: pct(abandonos), color: "oklch(0.45 0.2 25)" },
            ]}
          />
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Alertas Operacionais">
          <div className="space-y-3">
            {overdueProducts.slice(0, 3).map((p) => {
              const client = clients.find((c) => c.id === p.clientId);
              return (
                <Alert
                  key={p.id}
                  type="danger"
                  title={
                    p.financialStatus === "Reserva"
                      ? "Cliente com reserva vencida"
                      : "Pendência vencida"
                  }
                  text={`${client?.name ?? "Cliente"} — ${p.name} (${formatBRL(
                    p.totalValue - p.paidValue,
                  )} em aberto).`}
                />
              );
            })}
            {pagosAgEnvio > 0 && (
              <Alert
                type="success"
                title="Pagos aguardando envio"
                text={`${pagosAgEnvio} pedido(s) prontos para despacho.`}
              />
            )}
            {mgmvVencidas > 0 && (
              <Alert
                type="warning"
                title="Parcelas MGMV vencidas"
                text={`${mgmvVencidas} parcela(s) em atraso.`}
              />
            )}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
