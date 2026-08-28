import { useCallback, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { syncSuperfreteShipments, type SuperfreteSyncResult } from "@/lib/superfrete.functions";
import { useIdle } from "@/lib/use-idle";

/** Intervalo padrão entre sincronizações automáticas (3 min). */
const DEFAULT_INTERVAL_MS = 900_000;

/**
 * Mantém os status das etiquetas SuperFrete atualizados em segundo plano.
 * Roda ao montar, a cada intervalo e quando a aba volta a ficar visível.
 * `onUpdated` só é chamado quando algo realmente mudou no banco.
 */
export function useSuperfreteSync(
  onUpdated: () => void,
  options?: { enabled?: boolean; intervalMs?: number },
) {
  const enabled = options?.enabled ?? true;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const { idle } = useIdle();
  const sync = useServerFn(syncSuperfreteShipments);
  const running = useRef(false);
  const cb = useRef(onUpdated);
  cb.current = onUpdated;

  const runSync = useCallback(async (): Promise<SuperfreteSyncResult | null> => {
    if (running.current) return null;
    running.current = true;
    try {
      const res = await sync({ data: { limit: 25 } });
      if (res.updated > 0) cb.current();
      return res;
    } catch {
      return null; // silencioso: rotina de fundo
    } finally {
      running.current = false;
    }
  }, [sync]);

  useEffect(() => {
    if (!enabled || idle) return;
    void runSync();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void runSync();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, idle, intervalMs, runSync]);

  return { runSync };
}
