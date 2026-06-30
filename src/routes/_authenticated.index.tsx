import { createFileRoute } from "@tanstack/react-router";
import { lazy, useCallback, useMemo, useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Alert, Card, MetricCard, PageHeader, StackedBar } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, isOverdue, shouldAppearInCollection, formatBRL } from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { DashboardIntegrityCard } from "@/components/dashboard-integrity-card";
import { DashboardDrilldownModal, type DashboardCardId } from "@/components/dashboard-drilldown-modal";
import { LazySection } from "@/components/lazy-section";

const ClientesSection = lazy(() =>
  import("@/sections/clientes-section").then((m) => ({ default: m.ClientesSection })),
);
const CollectionSection = lazy(() =>
  import("@/sections/collection-section").then((m) => ({ default: m.CollectionSection })),
);
const MGMVSection = lazy(() =>
  import("@/sections/mgmv-section").then((m) => ({ default: m.MGMVSection })),
);
const EquipeSection = lazy(() =>
  import("@/sections/equipe-section").then((m) => ({ default: m.EquipeSection })),
);

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
  if (!el) return;
  el.scrollTo({ top: 0, behavior: "auto" });
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function OnePage() {
  const onScrollTo = useCallback(scrollToSection, []);
  return (
    <AppLayout>
      <DashboardSection onScrollTo={onScrollTo} />
      <LazySection anchorId="clientes">
        <ClientesSection onScrollTo={onScrollTo} />
      </LazySection>
      <LazySection anchorId="equipe">
        <EquipeSection />
      </LazySection>
      <LazySection anchorId="mgmv">
        <MGMVSection onScrollTo={onScrollTo} />
      </LazySection>
      <LazySection anchorId="collection">
        <CollectionSection onScrollTo={onScrollTo} />
      </LazySection>
    </AppLayout>
  );
}

function DashboardSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openImport = useUiStore((s) => s.openImport);
  const [activeCard, setActiveCard] = useState<DashboardCardId | null>(null);
  const openCard = (id: DashboardCardId) => setActiveCard(id);

  const stats = useMemo(() => {
    let reservasAtivas = 0;
    let reservasVencidas = 0;
    let pendencias = 0;
    let pagosAgEnvio = 0;
    let enviados = 0;
    let desistencias = 0;
    let abandonos = 0;
    let aberto = 0;
    let finPago = 0;
    let finReserva = 0;
    let finMGMV = 0;
    let finPend = 0;
    const overdueProducts: typeof products = [];
    for (const p of products) {
      if (p.financialStatus === "Reserva" && p.situation === "Em Aberto") {
        reservasAtivas++;
        if (isOverdue(p.dueDate)) reservasVencidas++;
      }
      if (p.financialStatus === "Pendente" && p.situation === "Em Aberto") pendencias++;
      if (p.financialStatus === "Pago" && p.situation === "Em Aberto") pagosAgEnvio++;
      if (p.situation === "Em Aberto") aberto++;
      if (p.situation === "Enviado") enviados++;
      else if (p.situation === "Desistiu") desistencias++;
      else if (p.situation === "Abandonou") abandonos++;
      if (p.financialStatus === "Pago") finPago++;
      else if (p.financialStatus === "Reserva") finReserva++;
      else if (p.financialStatus === "MGMV") finMGMV++;
      else if (p.financialStatus === "Pendente") finPend++;
      if (shouldAppearInCollection(p)) overdueProducts.push(p);
    }
    return {
      reservasAtivas,
      reservasVencidas,
      pendencias,
      pagosAgEnvio,
      enviados,
      desistencias,
      abandonos,
      aberto,
      finPago,
      finReserva,
      finMGMV,
      finPend,
      overdueProducts,
    };
  }, [products]);

  const { clientesMGMV, mgmvVencidas } = useMemo(() => {
    let cm = 0;
    let mv = 0;
    for (const c of clients) {
      if (c.mgmv) cm++;
      if (c.mgmv) {
        for (const i of c.mgmv.installments) {
          if (!i.paid && isOverdue(i.dueDate)) mv++;
        }
      }
    }
    return { clientesMGMV: cm, mgmvVencidas: mv };
  }, [clients]);

  const {
    reservasAtivas,
    reservasVencidas,
    pendencias,
    pagosAgEnvio,
    enviados,
    desistencias,
    abandonos,
    aberto,
    finPago,
    finReserva,
    finMGMV,
    finPend,
    overdueProducts,
  } = stats;

  const total = products.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <section id="dashboard" data-tour="dashboard-section" className="one-page-section">
      <PageHeader
        title="Dashboard"
        description="Acompanhe os principais indicadores operacionais da Star Games."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total Clientes" value={clients.length} onClick={() => openCard("total-clients")} tooltip="Ver clientes cadastrados" />
        <MetricCard label="Total Produtos" value={products.length} onClick={() => openCard("total-products")} tooltip="Ver produtos cadastrados" />
        <MetricCard label="Reservas Ativas" value={reservasAtivas} status="primary" onClick={() => openCard("active-reservations")} tooltip="Ver reservas ativas" />
        <MetricCard label="Reservas Vencidas" value={reservasVencidas} status="danger" onClick={() => openCard("overdue-reservations")} tooltip="Ver reservas vencidas" />
        <MetricCard label="Pendências" value={pendencias} status="danger" onClick={() => openCard("pending")} tooltip="Ver pendências em aberto" />
        <MetricCard label="Clientes MGMV" value={clientesMGMV} onClick={() => openCard("mgmv-clients")} tooltip="Ver clientes MGMV" />
        <MetricCard label="MGMV Vencidas" value={mgmvVencidas} status="danger" onClick={() => openCard("mgmv-overdue")} tooltip="Ver MGMV vencidas" />
        <MetricCard label="Pagos Ag. Envio" value={pagosAgEnvio} status="success" onClick={() => openCard("paid-awaiting-shipment")} tooltip="Ver pagos aguardando envio" />
        <MetricCard label="Produtos Enviados" value={enviados} onClick={() => openCard("shipped")} tooltip="Ver produtos enviados" />
        <MetricCard label="Desistências" value={desistencias} onClick={() => openCard("withdrawals")} tooltip="Ver desistências" />
        <MetricCard label="Abandonos" value={abandonos} onClick={() => openCard("abandons")} tooltip="Ver abandonos" />
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
                  onClick={() =>
                    openCard(
                      p.financialStatus === "Reserva"
                        ? "overdue-reservations"
                        : "pending",
                    )
                  }
                  tooltip="Abrir lista filtrada"
                />
              );
            })}
            {pagosAgEnvio > 0 && (
              <Alert
                type="success"
                title="Pagos aguardando envio"
                text={`${pagosAgEnvio} pedido(s) prontos para despacho.`}
                onClick={() => openCard("paid-awaiting-shipment")}
                tooltip="Ver pagos aguardando envio"
              />
            )}
            {mgmvVencidas > 0 && (
              <Alert
                type="warning"
                title="Parcelas MGMV vencidas"
                text={`${mgmvVencidas} parcela(s) em atraso.`}
                onClick={() => openCard("mgmv-overdue")}
                tooltip="Ver parcelas MGMV vencidas"
              />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <DashboardIntegrityCard />
      </div>

      <DashboardDrilldownModal
        cardId={activeCard}
        onClose={() => setActiveCard(null)}
        onScrollTo={onScrollTo}
      />
    </section>
  );
}
