import { useEffect, useState } from "react";

/**
 * Seções monitoradas — todas iniciam compactas e só a "ativa" expande.
 * A ativa é a seção cujo topo está mais próximo (acima) de uma linha
 * fixa do viewport (~30% da altura), com histerese para evitar flicker.
 */
const MONITORED = ["clientes", "collection"] as const;
type MonitoredId = (typeof MONITORED)[number];

let activeId: MonitoredId | null = null;
const listeners = new Set<(id: MonitoredId | null) => void>();
let rafId = 0;
let initialized = false;

function getScroller(): HTMLElement | Window {
  return (
    document.querySelector<HTMLElement>(".page-container") ?? window
  );
}

function computeActive(): MonitoredId | null {
  const scroller = getScroller();
  const scrollTop =
    scroller instanceof Window ? scroller.scrollY : scroller.scrollTop;
  const viewportH =
    scroller instanceof Window ? scroller.innerHeight : scroller.clientHeight;
  const probe = scrollTop + viewportH * 0.3;
  let current: MonitoredId | null = null;
  let bestTop = -Infinity;
  for (const id of MONITORED) {
    const el = document.getElementById(id);
    if (!el) continue;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    // só considera ativa se a linha de prova já entrou na seção
    if (probe >= top && probe < bottom && top > bestTop) {
      bestTop = top;
      current = id;
    }
  }
  return current;
}

function schedule() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const next = computeActive();
    if (next !== activeId) {
      activeId = next;
      listeners.forEach((l) => l(activeId));
    }
  });
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const scroller = getScroller();
  scroller.addEventListener("scroll", schedule, { passive: true } as AddEventListenerOptions);
  window.addEventListener("resize", schedule);
  // primeira medição após o layout assentar
  requestAnimationFrame(schedule);
}

/**
 * Lista compacta por padrão; expande apenas quando o usuário está
 * visualizando aquela seção. Sem loops de IntersectionObserver — a
 * decisão é baseada na posição do scroll relativa ao layout original.
 */
export function useSectionCompact(
  sectionId: MonitoredId,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [compact, setCompact] = useState<boolean>(true);

  useEffect(() => {
    ensureInit();
    const update = (id: MonitoredId | null) => setCompact(id !== sectionId);
    listeners.add(update);
    // aplica estado atual imediatamente
    update(activeId);
    schedule();
    return () => {
      listeners.delete(update);
    };
  }, [sectionId]);

  return [compact, setCompact];
}