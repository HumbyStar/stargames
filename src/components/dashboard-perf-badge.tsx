import { useEffect, useRef, useState } from "react";

/**
 * Overlay flutuante (apenas em DEV) que expõe métricas de performance do
 * Dashboard sem depender do React DevTools:
 *  - contagem de renders da seção
 *  - último tempo de agregação (ms)
 *  - último tempo de build da drilldown (ms)
 *
 * Instrumentação estritamente client-side e sem side-effects na store.
 */

type PerfEvent =
  | { type: "render" }
  | { type: "aggregate"; ms: number }
  | { type: "drilldown"; ms: number; rows: number };

type Metrics = {
  renders: number;
  lastAggregateMs: number | null;
  lastDrilldownMs: number | null;
  lastDrilldownRows: number | null;
};

const listeners = new Set<(m: Metrics) => void>();
let state: Metrics = {
  renders: 0,
  lastAggregateMs: null,
  lastDrilldownMs: null,
  lastDrilldownRows: null,
};

// A notificação é coalescida em um frame: contar renders com `setState`
// síncrono a cada render do Dashboard realimenta o ciclo de render do React
// ("Maximum update depth exceeded"). Guardamos o estado imediatamente e
// avisamos os assinantes no máximo uma vez por frame.
let flushScheduled = false;
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    const snapshot = state;
    for (const l of listeners) l(snapshot);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function emit(next: Metrics) {
  state = next;
  scheduleFlush();
}

export function reportDashboardPerf(ev: PerfEvent) {
  if (!import.meta.env.DEV) return;
  if (ev.type === "render") {
    emit({ ...state, renders: state.renders + 1 });
  } else if (ev.type === "aggregate") {
    emit({ ...state, lastAggregateMs: ev.ms });
  } else if (ev.type === "drilldown") {
    emit({ ...state, lastDrilldownMs: ev.ms, lastDrilldownRows: ev.rows });
  }
}

export function DashboardPerfBadge() {
  const [metrics, setMetrics] = useState<Metrics>(state);
  const [collapsed, setCollapsed] = useState(true);
  const mounted = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    mounted.current = true;
    const fn = (m: Metrics) => setMetrics(m);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  if (!import.meta.env.DEV) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-3 right-3 z-[1000] select-none rounded-md border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-mono shadow-lg backdrop-blur"
      data-testid="dashboard-perf-badge"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        aria-label={collapsed ? "Expandir métricas" : "Recolher métricas"}
      >
        <span className="inline-block size-2 rounded-full bg-primary" />
        <span>perf</span>
        <span className="tabular-nums">r{metrics.renders}</span>
      </button>
      {!collapsed && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt>renders</dt>
          <dd className="text-right tabular-nums">{metrics.renders}</dd>
          <dt>agg</dt>
          <dd className="text-right tabular-nums">
            {metrics.lastAggregateMs != null
              ? `${metrics.lastAggregateMs.toFixed(2)}ms`
              : "—"}
          </dd>
          <dt>drilldown</dt>
          <dd className="text-right tabular-nums">
            {metrics.lastDrilldownMs != null
              ? `${metrics.lastDrilldownMs.toFixed(2)}ms`
              : "—"}
          </dd>
          <dt>rows</dt>
          <dd className="text-right tabular-nums">
            {metrics.lastDrilldownRows ?? "—"}
          </dd>
        </dl>
      )}
    </div>
  );
}