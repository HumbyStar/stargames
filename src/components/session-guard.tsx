import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimSession, heartbeatSession } from "@/lib/session-guard.functions";
import { useServerFn } from "@tanstack/react-start";
import { getMaintenanceState } from "@/lib/maintenance.functions";
import { useIdle } from "@/lib/use-idle";

export const SESSION_ID_KEY = "sg_active_session_id";

/**
 * Handler de unload isolado, exportado apenas para testes de regressão.
 * Regra dura: durante `beforeunload`/`pagehide` NUNCA disparamos server fns
 * (o bearer token é anexado de forma assíncrona e o unload aborta o fetch,
 * fazendo `requireSupabaseAuth` responder 500). Apenas limpamos estado local.
 */
export type SessionUnloadReason =
  | "beforeunload"
  | "pagehide"
  | "visibilitychange"
  | "freeze";

export function handleSessionUnload(reason: SessionUnloadReason): void {
  try {
    const sessionId =
      typeof localStorage !== "undefined" ? localStorage.getItem(SESSION_ID_KEY) : null;
    // Log estruturado para auditoria — nenhuma RPC é feita aqui de propósito.
    console.info("[session-guard] unload", {
      reason,
      hasSessionId: Boolean(sessionId),
      path: typeof location !== "undefined" ? location.pathname : null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[session-guard] unload logging failed", err);
  }
}

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
  const getMaintenance = useServerFn(getMaintenanceState);
  const maintenanceKickedRef = useRef(false);

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
      // Se não há sessão Supabase ativa, não chame server fns protegidas —
      // elas exigem bearer token e falhariam com 401/500 (ex.: durante logout
      // ou quando o intervalo dispara após navegação para /auth).
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
      } catch {
        return;
      }
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
    const id = window.setInterval(ping, 120_000);
    const onFocus = () => ping();
    window.addEventListener("focus", onFocus);
    const onBeforeUnload = () => handleSessionUnload("beforeunload");
    const onPageHide = () => handleSessionUnload("pagehide");
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        handleSessionUnload("visibilitychange");
      }
    };
    const onFreeze = () => handleSessionUnload("freeze");
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    // `freeze` só existe em navegadores com Page Lifecycle API; addEventListener ignora se não suportado.
    document.addEventListener("freeze", onFreeze);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("freeze", onFreeze);
    };
  }, [navigate]);

  // ---- Modo Manutenção: bloqueia não-admins em tempo real ----
  useEffect(() => {
    let cancelled = false;

    async function checkMaintenance() {
      if (cancelled || maintenanceKickedRef.current) return;
      // Só há motivo de checar se há sessão ativa.
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
      } catch {
        return;
      }
      try {
        const m = await getMaintenance();
        if (!cancelled && m.active && !m.isAdmin && !maintenanceKickedRef.current) {
          maintenanceKickedRef.current = true;
          toast.info("Sistema em manutenção", {
            description:
              "O banco de dados está sendo migrado. Você será redirecionado para a página de manutenção.",
            duration: 8000,
          });
          navigate({ to: "/manutencao", replace: true });
        }
      } catch {
        // erro transient: tenta de novo no próximo ciclo
      }
    }

    void checkMaintenance();
    const id = window.setInterval(checkMaintenance, 120_000);
    const onFocus = () => void checkMaintenance();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [getMaintenance, navigate]);

  return <>{children}</>;
}