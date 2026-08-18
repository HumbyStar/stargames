import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSuperfreteBalance, type SuperfreteBalance } from "@/lib/superfrete.functions";

const CACHE_MS = 60_000;
let cache: { at: number; value: SuperfreteBalance } | null = null;
const listeners = new Set<(v: SuperfreteBalance) => void>();

/**
 * Saldo da carteira SuperFrete com cache curto (60s) compartilhado entre telas.
 * `refresh()` força nova leitura (usar após pagar uma etiqueta).
 */
export function useSuperfreteBalance(enabled = true) {
  const run = useServerFn(getSuperfreteBalance);
  const [balance, setBalance] = useState<SuperfreteBalance | null>(cache?.value ?? null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (inflight.current) return;
      if (!force && cache && Date.now() - cache.at < CACHE_MS) {
        setBalance(cache.value);
        return;
      }
      inflight.current = true;
      setLoading(true);
      try {
        const value = await run({ data: {} } as never);
        cache = { at: Date.now(), value };
        listeners.forEach((l) => l(value));
      } catch {
        /* saldo é informativo: falha silenciosa mantém o último valor */
      } finally {
        inflight.current = false;
        setLoading(false);
      }
    },
    [run],
  );

  useEffect(() => {
    const onChange = (v: SuperfreteBalance) => setBalance(v);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled, load]);

  return { balance, loading, refresh: () => load(true) };
}
