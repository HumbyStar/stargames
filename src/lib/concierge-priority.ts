import { useMemo } from "react";
import {
  hasIncludedInMgmv,
  isOverdue,
  shouldAppearInCollection,
  useStore,
} from "@/lib/store";
import type { DashboardCardId } from "@/components/dashboard-drilldown-modal";

export type PriorityAlert = {
  count: number;
  tone: "danger" | "warning" | "success" | "neutral";
  message: string;
  cardId: DashboardCardId | null;
};

/**
 * Calcula o alerta operacional prioritário do momento (mesma ordem usada
 * pelo balão do Concierge). Retorna count=0 quando nada crítico.
 */
export function usePriorityAlert(): PriorityAlert {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);

  return useMemo<PriorityAlert>(() => {
    // 1. Cobranças vencidas hoje ou atrasadas (pendentes vencidas)
    const overduePending = products.filter(
      (p) =>
        p.financialStatus === "Pendente" &&
        p.situation === "Em Aberto" &&
        !hasIncludedInMgmv(p, clients) &&
        isOverdue(p.dueDate),
    ).length;
    if (overduePending > 0) {
      return {
        count: overduePending,
        tone: "danger",
        message: `Você tem ${overduePending} cobrança${overduePending > 1 ? "s" : ""} vencida${overduePending > 1 ? "s" : ""}. Quer abrir agora?`,
        cardId: "pending",
      };
    }

    // 2. Reservas vencidas (remarcadas vencendo hoje)
    const overdueReservas = products.filter(
      (p) =>
        shouldAppearInCollection(p) &&
        p.financialStatus === "Reserva" &&
        !hasIncludedInMgmv(p, clients),
    ).length;
    if (overdueReservas > 0) {
      return {
        count: overdueReservas,
        tone: "danger",
        message: `${overdueReservas} reserva${overdueReservas > 1 ? "s" : ""} vencida${overdueReservas > 1 ? "s" : ""} precisa${overdueReservas > 1 ? "m" : ""} de atenção.`,
        cardId: "overdue-reservations",
      };
    }

    // 3. MGMV com parcela vencida
    const mgmvOverdue = clients.filter((c) =>
      c.mgmv?.installments.some((i) => !i.paid && isOverdue(i.dueDate)),
    ).length;
    if (mgmvOverdue > 0) {
      return {
        count: mgmvOverdue,
        tone: "warning",
        message: `${mgmvOverdue} acordo${mgmvOverdue > 1 ? "s" : ""} MGMV com parcela vencida.`,
        cardId: "mgmv-overdue",
      };
    }

    // 4. Produtos pagos aguardando envio
    const paidAwaiting = products.filter(
      (p) => p.financialStatus === "Pago" && p.situation === "Em Aberto",
    ).length;
    if (paidAwaiting > 0) {
      return {
        count: paidAwaiting,
        tone: "success",
        message: `${paidAwaiting} produto${paidAwaiting > 1 ? "s" : ""} pago${paidAwaiting > 1 ? "s" : ""} aguardando envio.`,
        cardId: "paid-awaiting-shipment",
      };
    }

    return {
      count: 0,
      tone: "neutral",
      message: "Tudo em dia por aqui. Bom trabalho!",
      cardId: null,
    };
  }, [clients, products]);
}

const DISMISSED_DATE_KEY = "conciergeAutoOpenDismissedDate";
const DISABLED_KEY = "conciergeAutoOpenDisabled";
const LAST_OPENED_KEY = "conciergeLastOpenedAt";

export const conciergePrefs = {
  isAutoOpenAllowed(): boolean {
    if (typeof window === "undefined") return false;
    try {
      if (localStorage.getItem(DISABLED_KEY) === "true") return false;
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(DISMISSED_DATE_KEY) === today) return false;
      return true;
    } catch {
      return true;
    }
  },
  dismissToday() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(DISMISSED_DATE_KEY, today);
    } catch {}
  },
  disableForever() {
    try {
      localStorage.setItem(DISABLED_KEY, "true");
    } catch {}
  },
  enableAgain() {
    try {
      localStorage.removeItem(DISABLED_KEY);
      localStorage.removeItem(DISMISSED_DATE_KEY);
    } catch {}
  },
  isDisabled(): boolean {
    try {
      return localStorage.getItem(DISABLED_KEY) === "true";
    } catch {
      return false;
    }
  },
  markOpened() {
    try {
      localStorage.setItem(LAST_OPENED_KEY, new Date().toISOString());
    } catch {}
  },
};