import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Alert, Card, MetricCard, PageHeader, StackedBar } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/store";
import { getDashboardAggregates } from "@/lib/api/queries.functions";
import {
  DashboardPerfBadge,
  reportDashboardPerf,
} from "@/components/dashboard-perf-badge";
import { useUiStore } from "@/lib/ui-store";
import { DashboardIntegrityCard } from "@/components/dashboard-integrity-card";
import { LazySection } from "@/components/lazy-section";
import { ClientesSection } from "@/sections/clientes-section";
import { scrollToSection } from "@/lib/scroll-to-section";
import { setUiValue } from "@/lib/db-sync";
import { useListExpansionStore, type ListSection } from "@/lib/list-expansion";
import { useSandbox } from "@/lib/use-sandbox";
import type { DashboardAggregates } from "@/lib/api/queries.functions";
import { handleUnauthorized, isUnauthorizedError } from "@/lib/unauthorized";


// Cache local dos últimos agregados por ambiente: ao recarregar, a tela abre
// com os últimos números conhecidos (nunca com zeros falsos) e só atualiza
// quando a consulta responde.
const AGG_CACHE_PREFIX = "sg_dashboard_aggregates:";

function readAggregatesCache(env: string): DashboardAggregates | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(AGG_CACHE_PREFIX + env);
    return raw ? (JSON.parse(raw) as DashboardAggregates) : null;
  } catch {
    return null;
  }
}

function writeAggregatesCache(env: string, data: DashboardAggregates) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AGG_CACHE_PREFIX + env, JSON.stringify(data));
  } catch {
    /* quota cheia: cache é apenas otimização */
  }
}

const CollectionSection = lazy(() =>
  import("@/sections/collection-section").then((m) => ({ default: m.CollectionSection })),
);
const EnvioSection = lazy(() =>
  import("@/sections/envio-section").then((m) => ({ default: m.EnvioSection })),
);
const MGMVSection = lazy(() =>
  import("@/sections/mgmv-section").then((m) => ({ default: m.MGMVSection })),
);
const HistoryModal = lazy(() =>
  import("@/components/history-modal").then((m) => ({ default: m.HistoryModal })),
);

export function OnePageBody() {
  const onScrollTo = useCallback(scrollToSection, []);
  const historyOpen = useUiStore((s) => s.historyContext !== null);
  return (
    <>
      <DashboardSection onScrollTo={onScrollTo} />
      <div id="clientes">
        <ClientesSection onScrollTo={onScrollTo} />
      </div>
      <LazySection id="mgmv" delayMs={0}>
        <Suspense fallback={null}>
          <MGMVSection onScrollTo={onScrollTo} />
        </Suspense>
      </LazySection>
      <LazySection id="envio" delayMs={80}>
        <Suspense fallback={null}>
          <EnvioSection onScrollTo={onScrollTo} />
        </Suspense>
      </LazySection>
      <LazySection id="collection" delayMs={120}>
        <Suspense fallback={null}>
          <CollectionSection onScrollTo={onScrollTo} />
        </Suspense>
      </LazySection>
      {historyOpen && (
        <Suspense fallback={null}>
          <HistoryModal />
        </Suspense>
      )}
    </>
  );
}

function DashboardSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  // Dashboard agora consulta agregados diretamente no banco — nenhuma
  // lista completa é carregada no front. Os cards continuam clicáveis:
  // cada clique aplica o filtro correspondente na seção-alvo, expande a
  // lista e faz scroll até lá.
  const aggregatesFn = useServerFn(getDashboardAggregates);
  const { state: sandboxState } = useSandbox();
  const env = sandboxState.active ? "sandbox" : "producao";
  const cachedRef = useRef<DashboardAggregates | null>(null);
  if (cachedRef.current === null) cachedRef.current = readAggregatesCache(env);
  const aggregatesQuery = useQuery({
    queryKey: ["dashboard-aggregates"],
    queryFn: async () => {
      try {
        return await aggregatesFn();
      } catch (error) {
        // Sessão expirada: redireciona para /auth em vez de quebrar a tela.
        if (handleUnauthorized(error)) return cachedRef.current;
        throw error;
      }
    },
    retry: (count, error) => !isUnauthorizedError(error) && count < 2,
    staleTime: 30_000,
  });

  const openImport = useUiStore((s) => s.openImport);
  const openHistory = useUiStore((s) => s.openHistory);

  // Mapa card → (seção destino, chave da chip persistida, valor da chip).
  // Ao clicar, gravamos a chip via db-sync (`setUiValue`), expandimos a
  // lista da seção e fazemos scroll — a seção reage ao chip e já mostra
  // o subconjunto filtrado.
  const drillTo = useCallback(
    (target: { section: ListSection; scrollId: string; chipKey: string; chipValue: string }) => {
      setUiValue(target.chipKey, target.chipValue);
      useListExpansionStore.getState().setPreferred(target.section, true);
      onScrollTo(target.scrollId);
    },
    [onScrollTo],
  );

  const openHandlers = useMemo(() => {
    const c = (chipValue: string) =>
      () => drillTo({ section: "clients", scrollId: "clientes", chipKey: "clientes.chip", chipValue });
    const col = (chipValue: string) =>
      () => drillTo({ section: "collection", scrollId: "collection", chipKey: "collection.filter", chipValue });
    const m = (chipValue: string) =>
      () => drillTo({ section: "mgmv", scrollId: "mgmv", chipKey: "mgmv.chip", chipValue });
    return {
      "total-clients": () => openHistory("clientes-todos"),
      "active-reservations": col("em_aberto"),
      "overdue-reservations": col("reserva_vencida"),
      pending: col("pendente_vencido"),
      "mgmv-clients": () => openHistory("mgmv-todos"),
      "mgmv-overdue": m("em_atraso"),
      "paid-awaiting-shipment": c("pago_aguardando"),
      withdrawals: () => openHistory("desistiu"),
      abandons: () => openHistory("abandonou"),
    } as const;
  }, [drillTo, openHistory]);

  // Instrumentamos o badge com o tempo do fetch server-side (round-trip).
  const perfStartRef = useRef<number>(performance.now());
  const cached = cachedRef.current;
  const aggregates: DashboardAggregates = aggregatesQuery.data ??
    cached ?? {
    totalClients: 0,
    totalProducts: 0,
    reservasAtivas: 0,
    reservasVencidas: 0,
    pendencias: 0,
    pendenciasVencidas: 0,
    pagosAgEnvio: 0,
    enviados: 0,
    desistencias: 0,
    abandonos: 0,
    retirar: 0,
    retirados: 0,
    removidos: 0,
    clientesMGMV: 0,
    mgmvVencidas: 0,
    cobrancaAtiva: 0,
    aberto: 0,
    finPago: 0,
    finReserva: 0,
    finMGMV: 0,
    finPend: 0,
    topAlerts: [] as Array<{
      productId: string;
      clientId: string;
      clientName: string;
      productName: string;
      remaining: number;
      financialStatus: string;
    }>,
  };
  // Sem dados reais nem cache → placeholders (nunca zeros falsos).
  const metricsLoading = !aggregatesQuery.data && !cached;
  const isSuccess = aggregatesQuery.isSuccess;

  // Persiste o último resultado para a próxima abertura do sistema.
  useEffect(() => {
    if (aggregatesQuery.data) writeAggregatesCache(env, aggregatesQuery.data);
  }, [aggregatesQuery.data, env]);

  // IMPORTANTE: reportar métricas SEMPRE em efeito (nunca durante o render).
  // Emitir durante o render atualiza o estado do badge no meio da fase de
  // render e faz o React reiniciar a renderização em loop infinito
  // ("Maximum update depth exceeded"), derrubando a página inteira.
  useEffect(() => {
    if (isSuccess && perfStartRef.current > 0) {
      reportDashboardPerf({ type: "aggregate", ms: performance.now() - perfStartRef.current });
      perfStartRef.current = 0;
    }
  }, [isSuccess]);

  // Contador de renders p/ o badge (dev-only, sem custo em prod).
  useEffect(() => {
    if (import.meta.env.DEV) reportDashboardPerf({ type: "render" });
  });

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
        <MetricCard loading={metricsLoading} label="Total Clientes" value={totalClients} onClick={openHandlers["total-clients"]} tooltip="Ver clientes cadastrados" />
        <MetricCard loading={metricsLoading} label="Reservas Ativas" value={reservasAtivas} status="primary" onClick={openHandlers["active-reservations"]} tooltip="Ver reservas ativas" />
        <MetricCard loading={metricsLoading} label="Reservas Vencidas" value={reservasVencidas} status="danger" onClick={openHandlers["overdue-reservations"]} tooltip="Ver reservas vencidas" />
        <MetricCard loading={metricsLoading} label="Pendências" value={pendencias} status="danger" onClick={openHandlers.pending} tooltip="Ver pendências em aberto" />
        <MetricCard loading={metricsLoading} label="Clientes MGMV" value={clientesMGMV} onClick={openHandlers["mgmv-clients"]} tooltip="Ver clientes MGMV" />
        <MetricCard loading={metricsLoading} label="MGMV Vencidas" value={mgmvVencidas} status="danger" onClick={openHandlers["mgmv-overdue"]} tooltip="Ver MGMV vencidas" />
        <MetricCard loading={metricsLoading} label="Pagos Ag. Envio" value={pagosAgEnvio} status="success" onClick={openHandlers["paid-awaiting-shipment"]} tooltip="Ver pagos aguardando envio" />
        <MetricCard loading={metricsLoading} label="Desistências" value={desistencias} onClick={openHandlers.withdrawals} tooltip="Ver desistências" />
        <MetricCard loading={metricsLoading} label="Abandonos" value={abandonos} onClick={openHandlers.abandons} tooltip="Ver abandonos" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={openImport}>Importar Dados</Button>
        <Button variant="outline" onClick={goCollection}>Ver Cobranças</Button>
        <Button variant="outline" onClick={goClientes}>Ver Clientes</Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Status Financeiro">
          <StackedBar segments={financialSegments} loading={metricsLoading} />
        </Card>
        <Card title="Situação dos Produtos">
          <StackedBar segments={situationSegments} loading={metricsLoading} />
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Alertas Operacionais">
          <div className="space-y-3">
            {metricsLoading && (
              <div className="h-14 w-full animate-pulse rounded-lg bg-muted" aria-hidden />
            )}
            {!metricsLoading && topAlerts.map((a) => (
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
            {!metricsLoading && pagosAgEnvio > 0 && (
              <Alert
                type="success"
                title="Pagos aguardando envio"
                text={`${pagosAgEnvio} pedido(s) prontos para despacho.`}
                onClick={openHandlers["paid-awaiting-shipment"]}
                tooltip="Ver pagos aguardando envio"
              />
            )}
            {!metricsLoading && mgmvVencidas > 0 && (
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

      <DashboardPerfBadge />
    </section>
  );
}
