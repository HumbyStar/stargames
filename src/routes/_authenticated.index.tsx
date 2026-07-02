import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Alert, Card, MetricCard, PageHeader, StackedBar } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, formatBRL } from "@/lib/store";
import { computeDashboardAggregates } from "@/lib/dashboard-metrics";
import type { DashboardAlertPreview } from "@/lib/dashboard-metrics";
import {
  DashboardPerfBadge,
  reportDashboardPerf,
} from "@/components/dashboard-perf-badge";
import { useUiStore } from "@/lib/ui-store";
import { DashboardIntegrityCard } from "@/components/dashboard-integrity-card";
import type { DashboardCardId } from "@/components/dashboard-drilldown-modal";
import { LazySection } from "@/components/lazy-section";
import { ClientesSection } from "@/sections/clientes-section";

const CollectionSection = lazy(() =>
  import("@/sections/collection-section").then((m) => ({ default: m.CollectionSection })),
);
const MGMVSection = lazy(() =>
  import("@/sections/mgmv-section").then((m) => ({ default: m.MGMVSection })),
);
const EquipeSection = lazy(() =>
  import("@/sections/equipe-section").then((m) => ({ default: m.EquipeSection })),
);
const ImportSection = lazy(() =>
  import("@/sections/import-section").then((m) => ({ default: m.ImportSection })),
);
const DashboardDrilldownModal = lazy(() =>
  import("@/components/dashboard-drilldown-modal").then((m) => ({
    default: m.DashboardDrilldownModal,
  })),
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
  const container = document.querySelector<HTMLElement>(".page-container");
  if (!container) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const top =
    el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  container.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
}

function OnePage() {
  const onScrollTo = useCallback(scrollToSection, []);
  return (
    <AppLayout>
      <DashboardSection onScrollTo={onScrollTo} />
      <div id="clientes">
        <ClientesSection onScrollTo={onScrollTo} />
      </div>
      <LazySection id="equipe">
        <Suspense fallback={null}>
          <EquipeSection />
        </Suspense>
      </LazySection>
      <LazySection id="mgmv">
        <Suspense fallback={null}>
          <MGMVSection onScrollTo={onScrollTo} />
        </Suspense>
      </LazySection>
      <LazySection id="collection">
        <Suspense fallback={null}>
          <CollectionSection onScrollTo={onScrollTo} />
        </Suspense>
      </LazySection>
      <LazySection id="import" minHeight="60vh">
        <Suspense fallback={null}>
          <ImportSection onScrollTo={onScrollTo} />
        </Suspense>
      </LazySection>
    </AppLayout>
  );
}

function DashboardSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  // Assinamos apenas os arrays base — o useMemo abaixo compila tudo o que o
  // Dashboard precisa em uma única varredura. Detalhes ficam por conta do
  // DrilldownModal (montado sob demanda).
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openImport = useUiStore((s) => s.openImport);
  const [activeCard, setActiveCard] = useState<DashboardCardId | null>(null);

  // Callbacks estáveis para não invalidar as props do MetricCard/Alert.
  const openCard = useCallback(
    (id: DashboardCardId) => setActiveCard(id),
    [],
  );
  const closeCard = useCallback(() => setActiveCard(null), []);

  // Fábrica memoizada com um handler por card — evita criar closures novas
  // a cada render. Se surgirem novos DashboardCardId eles não vão quebrar
  // nada (o setter continua funcionando), mas ficam fora deste cache.
  const openHandlers = useMemo(() => {
    const ids: DashboardCardId[] = [
      "total-clients",
      "total-products",
      "active-reservations",
      "overdue-reservations",
      "pending",
      "mgmv-clients",
      "mgmv-overdue",
      "paid-awaiting-shipment",
      "shipped",
      "withdrawals",
      "abandons",
    ];
    return Object.fromEntries(
      ids.map((id) => [id, () => setActiveCard(id)]),
    ) as Record<DashboardCardId, () => void>;
  }, []);

  // AGREGADOS: única varredura, resultado memoizado. Instrumentado com
  // performance.now() para o badge dev-only.
  const aggregates = useMemo(() => {
    const t0 = performance.now();
    const a = computeDashboardAggregates(clients, products);
    reportDashboardPerf({ type: "aggregate", ms: performance.now() - t0 });
    return a;
  }, [clients, products]);

  // Contador de renders p/ o badge (dev-only, sem custo em prod).
  const renderRef = useRef(0);
  renderRef.current++;
  if (import.meta.env.DEV) {
    reportDashboardPerf({ type: "render" });
  }

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
    clientesMGMV,
    mgmvVencidas,
    topAlerts,
    totalClients,
    totalProducts,
  } = aggregates;

  const total = totalProducts || 1;
  const pct = useCallback((n: number) => Math.round((n / total) * 100), [total]);

  const financialSegments = useMemo(
    () => [
      { label: "Pago", percent: pct(finPago), color: "oklch(0.65 0.16 150)" },
      { label: "Reserva", percent: pct(finReserva), color: "oklch(0.78 0.15 75)" },
      { label: "MGMV", percent: pct(finMGMV), color: "oklch(0.55 0.2 260)" },
      { label: "Pendente", percent: pct(finPend), color: "oklch(0.6 0.22 25)" },
    ],
    [pct, finPago, finReserva, finMGMV, finPend],
  );

  const situationSegments = useMemo(
    () => [
      { label: "Em Aberto", percent: pct(aberto), color: "oklch(0.55 0.2 260)" },
      { label: "Enviado", percent: pct(enviados), color: "oklch(0.65 0.16 150)" },
      { label: "Desistiu", percent: pct(desistencias), color: "oklch(0.72 0.16 50)" },
      { label: "Abandonou", percent: pct(abandonos), color: "oklch(0.45 0.2 25)" },
    ],
    [pct, aberto, enviados, desistencias, abandonos],
  );

  const goCollection = useCallback(() => onScrollTo("collection"), [onScrollTo]);
  const goClientes = useCallback(() => onScrollTo("clientes"), [onScrollTo]);

  return (
    <section id="dashboard" data-tour="dashboard-section" className="one-page-section">
      <PageHeader
        title="Dashboard"
        description="Acompanhe os principais indicadores operacionais da Star Games."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total Clientes" value={totalClients} onClick={openHandlers["total-clients"]} tooltip="Ver clientes cadastrados" />
        <MetricCard label="Total Produtos" value={totalProducts} onClick={openHandlers["total-products"]} tooltip="Ver produtos cadastrados" />
        <MetricCard label="Reservas Ativas" value={reservasAtivas} status="primary" onClick={openHandlers["active-reservations"]} tooltip="Ver reservas ativas" />
        <MetricCard label="Reservas Vencidas" value={reservasVencidas} status="danger" onClick={openHandlers["overdue-reservations"]} tooltip="Ver reservas vencidas" />
        <MetricCard label="Pendências" value={pendencias} status="danger" onClick={openHandlers.pending} tooltip="Ver pendências em aberto" />
        <MetricCard label="Clientes MGMV" value={clientesMGMV} onClick={openHandlers["mgmv-clients"]} tooltip="Ver clientes MGMV" />
        <MetricCard label="MGMV Vencidas" value={mgmvVencidas} status="danger" onClick={openHandlers["mgmv-overdue"]} tooltip="Ver MGMV vencidas" />
        <MetricCard label="Pagos Ag. Envio" value={pagosAgEnvio} status="success" onClick={openHandlers["paid-awaiting-shipment"]} tooltip="Ver pagos aguardando envio" />
        <MetricCard label="Produtos Enviados" value={enviados} onClick={openHandlers.shipped} tooltip="Ver produtos enviados" />
        <MetricCard label="Desistências" value={desistencias} onClick={openHandlers.withdrawals} tooltip="Ver desistências" />
        <MetricCard label="Abandonos" value={abandonos} onClick={openHandlers.abandons} tooltip="Ver abandonos" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={openImport}>Importar Dados</Button>
        <Button variant="outline" onClick={goCollection}>Ver Cobranças</Button>
        <Button variant="outline" onClick={goClientes}>Ver Clientes</Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Status Financeiro">
          <StackedBar segments={financialSegments} />
        </Card>
        <Card title="Situação dos Produtos">
          <StackedBar segments={situationSegments} />
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Alertas Operacionais">
          <div className="space-y-3">
            {topAlerts.map((a: DashboardAlertPreview) => (
              <Alert
                key={a.productId}
                type="danger"
                title={
                  a.financialStatus === "Reserva"
                    ? "Cliente com reserva vencida"
                    : "Pendência vencida"
                }
                text={`${a.clientName} — ${a.productName} (${formatBRL(a.remaining)} em aberto).`}
                onClick={
                  a.financialStatus === "Reserva"
                    ? openHandlers["overdue-reservations"]
                    : openHandlers.pending
                }
                tooltip="Abrir lista filtrada"
              />
            ))}
            {pagosAgEnvio > 0 && (
              <Alert
                type="success"
                title="Pagos aguardando envio"
                text={`${pagosAgEnvio} pedido(s) prontos para despacho.`}
                onClick={openHandlers["paid-awaiting-shipment"]}
                tooltip="Ver pagos aguardando envio"
              />
            )}
            {mgmvVencidas > 0 && (
              <Alert
                type="warning"
                title="Parcelas MGMV vencidas"
                text={`${mgmvVencidas} parcela(s) em atraso.`}
                onClick={openHandlers["mgmv-overdue"]}
                tooltip="Ver parcelas MGMV vencidas"
              />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <DashboardIntegrityCard />
      </div>

      {activeCard != null && (
        <Suspense fallback={null}>
          <DashboardDrilldownModal
            cardId={activeCard}
            onClose={closeCard}
            onScrollTo={onScrollTo}
          />
        </Suspense>
      )}

      <DashboardPerfBadge />
    </section>
  );
}
