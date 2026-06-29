import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimSession, heartbeatSession, releaseSession } from "@/lib/session-guard.functions";

export const SESSION_ID_KEY = "sg_active_session_id";

function generateSessionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Mantém o heartbeat da sessão e expulsa caso outro login assuma a conta. */
export function SessionGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const evictedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function evict(message: string) {
      if (evictedRef.current || cancelled) return;
      evictedRef.current = true;
      toast.error("Sessão encerrada", { description: message, duration: 8000 });
      try {
        localStorage.removeItem(SESSION_ID_KEY);
      } catch {}
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    }

    async function ping() {
      if (cancelled) return;
      let sessionId: string | null = null;
      try {
        sessionId = localStorage.getItem(SESSION_ID_KEY);
      } catch {}
      if (!sessionId) {
        // Sessão pré-existente sem identificador local — reivindica em vez de expulsar.
        const newId = generateSessionId();
        try {
          const res = await claimSession({ data: { sessionId: newId, force: true } });
          if (res.ok) {
            try {
              localStorage.setItem(SESSION_ID_KEY, newId);
            } catch {}
            return;
          }
          if (res.reason === "no_internal_access") {
            await evict(
              "Sua conta não tem acesso interno. Procure um administrador para liberar.",
            );
          }
        } catch {
          // Rede instável — tenta de novo no próximo ciclo.
        }
        return;
      }
      try {
        const res = await heartbeatSession({ data: { sessionId } });
        if (!res.valid) {
          if (res.reason === "replaced") {
            await evict(
              "Sua conta foi usada para entrar em outro dispositivo. Apenas uma sessão ativa por vez é permitida.",
            );
          } else {
            await evict(
              "Seu acesso interno foi removido. Procure um administrador para liberar novamente.",
            );
          }
        }
      } catch {
        // Falhas de rede não devem expulsar — o próximo heartbeat tenta de novo.
      }
    }

    ping();
    const id = window.setInterval(ping, 30_000);
    const onFocus = () => ping();
    window.addEventListener("focus", onFocus);
    const onUnload = () => {
      try {
        const sessionId = localStorage.getItem(SESSION_ID_KEY);
        if (sessionId) releaseSession({ data: { sessionId } }).catch(() => {});
      } catch {}
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [navigate]);

  return <>{children}</>;
}