import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import {
  isSectionMountRequested,
  onSectionMountRequest,
} from "@/lib/scroll-to-section";

type Strategy = "post-hydration" | "viewport";

interface LazySectionProps {
  id: string;
  children: ReactNode;
  /**
   * "post-hydration" (default): monta assim que o store hidrata + rIC,
   *   com um pequeno atraso opcional (`delayMs`) para escalonar a cascata
   *   entre seções. Não usa IntersectionObserver, não reserva altura fake.
   * "viewport": mantém o comportamento antigo baseado em IO (útil só se
   *   uma seção específica for muito pesada e não puder ser pré-aquecida).
   */
  strategy?: Strategy;
  /** Só usado em `post-hydration`: atraso escalonado após rIC. */
  delayMs?: number;
  /** Só usado em `viewport`. */
  minHeight?: string;
  /** Só usado em `viewport`. */
  rootSelector?: string;
}

/** rIC com fallback para setTimeout em browsers/motores que não o suportam. */
function scheduleIdle(cb: () => void, timeout = 800): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const ric = (window as unknown as {
    requestIdleCallback?: (
      cb: (deadline: IdleDeadline) => void,
      opts?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    const handle = ric(() => cb(), { timeout });
    return () => {
      const cic = (window as unknown as {
        cancelIdleCallback?: (id: number) => void;
      }).cancelIdleCallback;
      if (typeof cic === "function") cic(handle);
    };
  }
  const t = window.setTimeout(cb, 0);
  return () => window.clearTimeout(t);
}

/**
 * Wrapper de seção da one-page. O `id` fica sempre no DOM, então a navbar
 * consegue rolar até aqui mesmo antes do conteúdo estar montado.
 *
 * Por padrão, monta o conteúdo assim que o store hidrata e o browser fica
 * ocioso — sem IntersectionObserver e sem placeholder de altura, evitando
 * o "salto" que acontecia quando o `min-height:80vh` colapsava para a
 * altura real. Como o splash de hidratação também pré-baixa os chunks
 * lazy, o primeiro paint da seção acontece instantaneamente.
 */
export function LazySection({
  id,
  children,
  strategy = "post-hydration",
  delayMs = 0,
  minHeight = "80vh",
  rootSelector = ".page-container",
}: LazySectionProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const hydrated = useStore((s) => s.hydrated);

  // Navegação direta para a seção (navbar/atalho) monta na hora, sem
  // esperar o agendamento ocioso nem o IntersectionObserver.
  useEffect(() => {
    if (mounted) return;
    if (isSectionMountRequested(id)) {
      setMounted(true);
      return;
    }
    return onSectionMountRequest(id, () => setMounted(true));
  }, [id, mounted]);

  useEffect(() => {
    if (strategy !== "post-hydration" || mounted || !hydrated) return;
    let cancelled = false;
    let cancelIdle: (() => void) | null = null;
    const delayTimer = window.setTimeout(() => {
      if (cancelled) return;
      cancelIdle = scheduleIdle(() => {
        if (!cancelled) setMounted(true);
      });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(delayTimer);
      cancelIdle?.();
    };
  }, [strategy, mounted, hydrated, delayMs]);

  useEffect(() => {
    if (strategy !== "viewport" || mounted) return;
    const el = ref.current;
    if (!el) return;
    const root = document.querySelector<HTMLElement>(rootSelector) ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          io.disconnect();
        }
      },
      { root, rootMargin: "100% 0px 100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [strategy, mounted, rootSelector]);

  const style =
    strategy === "viewport" && !mounted ? { minHeight } : undefined;

  return (
    <div id={id} ref={ref} style={style}>
      {mounted ? children : null}
    </div>
  );
}