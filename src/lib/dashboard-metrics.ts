// Agregados leves do Dashboard.
//
// Contrato: retorna apenas CONTAGENS e um pequeno preview de alertas
// (no máximo 3 itens, com um subconjunto mínimo de campos). Nenhuma
// referência ao Product/Client original é exposta — evita re-renderizar
// consumidores quando qualquer campo interno da lista for atualizado.
//
// Consumido por: Dashboard (route index) via useMemo. Ver dashboard-metrics.test.ts.

import { isOverdue, shouldAppearInCollection } from "./store";
import type { Client, FinancialStatus, Product } from "./store";

export interface DashboardAlertPreview {
  productId: string;
  clientId: string;
  clientName: string;
  productName: string;
  remaining: number;
  financialStatus: FinancialStatus;
}

export interface DashboardAggregates {
  totalClients: number;
  totalProducts: number;
  reservasAtivas: number;
  reservasVencidas: number;
  pendencias: number;
  pagosAgEnvio: number;
  enviados: number;
  desistencias: number;
  abandonos: number;
  aberto: number;
  finPago: number;
  finReserva: number;
  finMGMV: number;
  finPend: number;
  clientesMGMV: number;
  mgmvVencidas: number;
  /** Total de produtos elegíveis a cobrança (não somente os 3 do preview). */
  overdueTotal: number;
  /** Preview mínimo (máx. 3) para o banner de alertas. */
  topAlerts: DashboardAlertPreview[];
}

const ALERT_LIMIT = 3;

/**
 * Percorre listas UMA única vez para calcular todos os agregados do
 * Dashboard. Complexidade O(P + C + Ic) onde Ic ≪ P.
 */
export function computeDashboardAggregates(
  clients: readonly Client[],
  products: readonly Product[],
): DashboardAggregates {
  let reservasAtivas = 0;
  let reservasVencidas = 0;
  let pendencias = 0;
  let pagosAgEnvio = 0;
  let enviados = 0;
  let desistencias = 0;
  let abandonos = 0;
  let aberto = 0;
  let finPago = 0;
  let finReserva = 0;
  let finMGMV = 0;
  let finPend = 0;
  let overdueTotal = 0;
  const topAlerts: DashboardAlertPreview[] = [];

  // index de clientes para lookup O(1) durante alerts
  const clientById = new Map<string, Client>();
  for (const c of clients) clientById.set(c.id, c);

  for (const p of products) {
    if (p.financialStatus === "Reserva" && p.situation === "Em Aberto") {
      reservasAtivas++;
      if (isOverdue(p.dueDate)) reservasVencidas++;
    }
    if (p.financialStatus === "Pendente" && p.situation === "Em Aberto") pendencias++;
    if (p.financialStatus === "Pago" && p.situation === "Em Aberto") pagosAgEnvio++;
    if (p.situation === "Em Aberto") aberto++;
    if (p.situation === "Enviado") enviados++;
    else if (p.situation === "Desistiu") desistencias++;
    else if (p.situation === "Abandonou") abandonos++;
    if (p.financialStatus === "Pago") finPago++;
    else if (p.financialStatus === "Reserva") finReserva++;
    else if (p.financialStatus === "MGMV") finMGMV++;
    else if (p.financialStatus === "Pendente") finPend++;
    if (shouldAppearInCollection(p)) {
      overdueTotal++;
      if (topAlerts.length < ALERT_LIMIT) {
        const c = clientById.get(p.clientId);
        topAlerts.push({
          productId: p.id,
          clientId: p.clientId,
          clientName: c?.name ?? "Cliente",
          productName: p.name,
          remaining: p.totalValue - p.paidValue,
          financialStatus: p.financialStatus,
        });
      }
    }
  }

  let clientesMGMV = 0;
  let mgmvVencidas = 0;
  for (const c of clients) {
    if (!c.mgmv) continue;
    clientesMGMV++;
    for (const i of c.mgmv.installments) {
      if (!i.paid && isOverdue(i.dueDate)) mgmvVencidas++;
    }
  }

  return {
    totalClients: clients.length,
    totalProducts: products.length,
    reservasAtivas,
    reservasVencidas,
    pendencias,
    pagosAgEnvio,
    enviados,
    desistencias,
    abandonos,
    aberto,
    finPago,
    finReserva,
    finMGMV,
    finPend,
    clientesMGMV,
    mgmvVencidas,
    overdueTotal,
    topAlerts,
  };
}

/** Chaves permitidas em cada alerta — usado por testes de regressão. */
export const ALERT_PREVIEW_KEYS: ReadonlyArray<keyof DashboardAlertPreview> = [
  "productId",
  "clientId",
  "clientName",
  "productName",
  "remaining",
  "financialStatus",
];