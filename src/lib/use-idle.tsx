import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Modo ocioso: pausa polling/realtime quando o usuário para de interagir
 * ou coloca a aba em segundo plano, reduzindo drasticamente o consumo de
 * créditos em abas abertas sem uso.
 */

export interface IdleState {
  /** Verdadeiro quando não há interação recente OU a aba está oculta. */
  idle: boolean;
  /** Motivo atual do estado ocioso. */
  reason: "inactive" | "hidden" | null;
  /** Chamado manualmente para marcar a sessão como ativa novamente. */
  wake: () => void;
}

const IdleContext = createContext<IdleState>({ idle: false, reason: null, wake: () => {} });

const IDLE_THRESHOLD_MS = 5 * 60_000; // 5 minutos
const EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "scroll"] as const;

export function IdleProvider({ children }: { children: ReactNode }) {
  const [idle, setIdle] = useState(false);
  const [reason, setReason] = useState<IdleState["reason"]>(null);
  const lastActivityRef = useRef(Date.now());
  const idleTimerRef = useRef<number | null>(null);
  const hiddenRef = useRef(false);

  const setIdleState = (nextIdle: boolean, nextReason: IdleState["reason"]) => {
    setIdle(nextIdle);
    setReason(nextReason);
  };

  const wake = () => {
    lastActivityRef.current = Date.now();
    hiddenRef.current = false;
    setIdleState(false, null);
  };

  useEffect(() => {
    const checkIdle = () => {
      const now = Date.now();
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      hiddenRef.current = hidden;
      if (hidden) {
        setIdleState(true, "hidden");
        return;
      }
      const elapsed = now - lastActivityRef.current;
      if (elapsed >= IDLE_THRESHOLD_MS) {
        setIdleState(true, "inactive");
      } else {
        setIdleState(false, null);
        // Agenda próxima checagem exatamente no limiar.
        if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(checkIdle, IDLE_THRESHOLD_MS - elapsed);
      }
    };

    const onActivity = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      lastActivityRef.current = Date.now();
      if (idle || hiddenRef.current) {
        setIdleState(false, null);
        hiddenRef.current = false;
      }
      idleTimerRef.current = window.setTimeout(checkIdle, IDLE_THRESHOLD_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        onActivity();
      } else {
        hiddenRef.current = true;
        setIdleState(true, "hidden");
      }
    };

    // Inicia o timer.
    idleTimerRef.current = window.setTimeout(checkIdle, IDLE_THRESHOLD_MS);

    for (const e of EVENTS) {
      window.addEventListener(e, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      for (const e of EVENTS) {
        window.removeEventListener(e, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <IdleContext.Provider value={{ idle, reason, wake }}>{children}</IdleContext.Provider>;
}

export function useIdle(): IdleState {
  return useContext(IdleContext);
}

/** Hook auxiliar para pausar um intervalo quando ocioso. */
export function useIdleAwareInterval(
  callback: () => void,
  intervalMs: number,
  options?: { enabled?: boolean; runOnWake?: boolean },
) {
  const { idle, wake } = useIdle();
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const enabled = options?.enabled ?? true;
  const runOnWake = options?.runOnWake ?? true;

  useEffect(() => {
    if (!enabled || idle) return;
    cbRef.current();
    const id = window.setInterval(() => cbRef.current(), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, idle, intervalMs]);

  // Dispara uma execução imediata ao acordar, se solicitado.
  useEffect(() => {
    if (!enabled || !runOnWake) return;
    if (!idle) {
      cbRef.current();
    }
  }, [enabled, idle, runOnWake]);
}
