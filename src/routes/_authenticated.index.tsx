import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { AppLayout } from "@/components/app-layout";
import { Alert, Card, MetricCard, PageHeader, StackedBar } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, isOverdue, shouldAppearInCollection, formatBRL } from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { ClientesSection } from "@/sections/clientes-section";
import { CollectionSection } from "@/sections/collection-section";
import { MGMVSection } from "@/sections/mgmv-section";
import { DashboardIntegrityCard } from "@/components/dashboard-integrity-card";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Star Games — Gestão Operacional" },
      { name: "description", content: "Dashboard, clientes, cobranças e importação em uma única página." },
      { property: "og:title", content: "Star Games — Gestão Operacional" },
      { property: "og:description", content: "Sistema operacional one-page." },
    ],
  }),
  component: OnePage,
});

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function OnePage() {
  const onScrollTo = useCallback(scrollToSection, []);
  return (
    <AppLayout>
      <DashboardSection onScrollTo={onScrollTo} />
      <ClientesSection onScrollTo={onScrollTo} />
      <MGMVSection onScrollTo={onScrollTo} />
      <CollectionSection onScrollTo={onScrollTo} />
    </AppLayout>
  );
}

function DashboardSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const { clients, products } = useStore();
  const openImport = useUiStore((s) => s.openImport);

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
    <section id="dashboard" data-tour="dashboard-section" className="one-page-section">
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
        <Button onClick={openImport}>Importar Dados</Button>
        <Button variant="outline" onClick={() => onScrollTo("collection")}>Ver Cobranças</Button>
        <Button variant="outline" onClick={() => onScrollTo("clientes")}>Ver Clientes</Button>
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

      <div className="mt-6">
        <DashboardIntegrityCard />
      </div>
    </section>
  );
}
