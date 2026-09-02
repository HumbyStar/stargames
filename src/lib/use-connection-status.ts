import { useEffect, useRef, useState } from "react";
import { isOnline as isBrowserOnline } from "@/lib/local-mode";
import { supabase } from "@/integrations/supabase/client";
import { useIdle } from "@/lib/use-idle";
import { hasActiveSession } from "@/lib/auth-session";

export type ConnectionStatus = "online" | "unstable" | "offline";

/** Acima disso o ping é considerado lento (rede instável). */
const SLOW_PING_MS = 1500;
const NORMAL_INTERVAL = 30_000;
const UNSTABLE_INTERVAL = 10_000;

/**
 * Status de conexão com o sistema: combina o estado do navegador
 * (eventos online/offline) com um ping leve ao backend, medindo latência
 * para detectar instabilidade de rede.
 */
export function useConnectionStatus(): {
  status: ConnectionStatus;
  online: boolean;
  checking: boolean;
  latencyMs: number | null;
} {
  const { idle } = useIdle();
  const [status, setStatus] = useState<ConnectionStatus>("online");
  const [checking, setChecking] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const lastFailedRef = useRef(false);
  const resumedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    function schedule(next: ConnectionStatus) {
      if (cancelled) return;
      window.clearTimeout(timer);
      // Ocioso: não agenda novo ping para economizar créditos.
      if (idle) return;
      timer = window.setTimeout(
        () => void check(),
        next === "online" ? NORMAL_INTERVAL : UNSTABLE_INTERVAL,
      );
    }

    async function check() {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        lastFailedRef.current = true;
        setStatus("offline");
        setChecking(false);
        schedule("offline");
        return;
      }
      if (!isBrowserOnline()) {
        lastFailedRef.current = true;
        setStatus("offline");
        setChecking(false);
        schedule("offline");
        return;
      }
      // Sem sessão o banco recusa a leitura por GRANT — isso não é "offline".
      if (!(await hasActiveSession())) {
        setChecking(false);
        schedule("online");
        return;
      }
      const started = Date.now();
      try {
        const { error } = await supabase
          .from("app_settings")
          .select("id")
          .limit(1);
        if (cancelled) return;
        const elapsed = Date.now() - started;
        setLatencyMs(elapsed);
        let next: ConnectionStatus;
        if (error) {
          next = "offline";
          lastFailedRef.current = true;
        } else if (elapsed > SLOW_PING_MS || lastFailedRef.current) {
          // ping lento ou oscilação recente (falha seguida de sucesso)
          next = "unstable";
          lastFailedRef.current = elapsed > SLOW_PING_MS;
        } else {
          next = "online";
          lastFailedRef.current = false;
        }
        setStatus(next);
        schedule(next);
      } catch {
        if (!cancelled) {
          lastFailedRef.current = true;
          setStatus("offline");
          schedule("offline");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void check();
    const onOnline = () => void check();
    const onOffline = () => {
      lastFailedRef.current = true;
      setStatus("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onOnline);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onOnline);
    };
  }, [idle]);

  // Dispara um único ping ao sair do modo ocioso para verificar conexão real.
  useEffect(() => {
    if (!idle) {
      setChecking(true);
      void (async () => {
        try {
          if (!(await hasActiveSession())) {
            setChecking(false);
            return;
          }
          const started = Date.now();
          const { error } = await supabase.from("app_settings").select("id").limit(1);
          const elapsed = Date.now() - started;
          setLatencyMs(elapsed);
          setStatus(error ? "offline" : elapsed > SLOW_PING_MS ? "unstable" : "online");
        } catch {
          setStatus("offline");
        } finally {
          setChecking(false);
        }
      })();
    }
  }, [idle]);

  return { status, online: status !== "offline", checking, latencyMs };
}
