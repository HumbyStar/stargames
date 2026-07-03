import type { MGMVAgreement, MGMVInstallment } from "@/lib/store";

/** Soma `months` mantendo o mesmo dia; clampa ao último dia do mês destino. */
export function addMonthsClampDay(base: Date, months: number): Date {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  const target = new Date(y, m + months, 1, 12, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return target;
}

/**
 * Recalcula os vencimentos das parcelas PENDENTES com base na última parcela
 * paga (usando `paidAt`, ou `dueDate` como fallback). Cada parcela pendente
 * subsequente cai +1 mês em relação à anterior, começando por
 * `lastPaidDate + 1 mês`.
 *
 * Parcelas já pagas não são alteradas.
 */
export function recalcPendingDueDates(agreement: MGMVAgreement): MGMVAgreement {
  const installments = [...agreement.installments].sort(
    (a, b) => a.number - b.number,
  );
  let lastPaidNumber = 0;
  let lastPaidDate: Date | null = null;
  for (const i of installments) {
    if (i.paid) {
      const iso = i.paidAt ?? i.dueDate;
      if (iso) {
        lastPaidNumber = i.number;
        lastPaidDate = new Date(iso);
      }
    }
  }
  if (!lastPaidDate) return agreement;
  const next: MGMVInstallment[] = installments.map((i) => {
    if (i.paid || i.number <= lastPaidNumber) return i;
    const dueDate = addMonthsClampDay(
      lastPaidDate!,
      i.number - lastPaidNumber,
    ).toISOString();
    return { ...i, dueDate };
  });
  return { ...agreement, installments: next };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RebalanceOptions {
  /** Nova contagem TOTAL de parcelas (pagas + pendentes). */
  targetInstallmentsCount?: number;
  /** Piso da parcela pendente. Aumenta N automaticamente se necessário. */
  minInstallmentValue?: number;
  /** Novo `totalDebt`. Usado quando produto é removido do acordo. */
  newTotalDebt?: number;
  /** Dia do mês para as parcelas pendentes (1..31). */
  dueDay?: number;
}

export interface RebalanceResult {
  agreement: MGMVAgreement;
  /** True quando o piso mínimo aumentou N acima do solicitado. */
  bumpedInstallments: boolean;
  /** Valor uniforme calculado para as parcelas pendentes. */
  pendingValue: number;
  /** Saldo restante que foi redistribuído. */
  remaining: number;
}

/**
 * Redistribui o saldo restante do acordo entre as parcelas PENDENTES,
 * preservando as parcelas já pagas (número, `paidAt`, `paidAmount`, `dueDate`).
 *
 * - Se `targetInstallmentsCount` é passado, ajusta o total de parcelas.
 * - Se `minInstallmentValue` é passado e o valor uniforme cai abaixo dele,
 *   aumenta N até `paidCount + ceil(remaining / min)`.
 * - Se `newTotalDebt` é passado, usa-o como novo total (para remoção de produto).
 * - Datas das pendentes: última paga + 1, 2, … meses (ou `startDate` se
 *   nenhuma paga), aplicando `dueDay` quando fornecido.
 */
export function rebalanceAgreement(
  current: MGMVAgreement,
  opts: RebalanceOptions = {},
): RebalanceResult {
  const sorted = [...current.installments].sort((a, b) => a.number - b.number);
  const paid = sorted.filter((i) => i.paid);
  const paidCount = paid.length;
  const paidValue = paid.reduce(
    (s, i) => s + (i.paidAmount ?? i.value ?? 0),
    0,
  );
  const partialPaidAmount = sorted
    .filter((i) => !i.paid)
    .reduce(
      (s, i) => s + Math.max(0, Math.min(i.value, i.paidAmount ?? 0)),
      0,
    );

  const totalDebt =
    typeof opts.newTotalDebt === "number" && opts.newTotalDebt > 0
      ? opts.newTotalDebt
      : current.totalDebt;
  const remaining = Math.max(0, round2(totalDebt - paidValue - partialPaidAmount));

  // N alvo (pagas + pendentes).
  let targetN =
    opts.targetInstallmentsCount ??
    Math.max(paidCount + (remaining > 0 ? 1 : 0), sorted.length);
  targetN = Math.max(paidCount + (remaining > 0 ? 1 : 0), Math.min(targetN, 60));

  let pendingCount = Math.max(0, targetN - paidCount);
  let bumped = false;
  if (
    typeof opts.minInstallmentValue === "number" &&
    opts.minInstallmentValue > 0 &&
    pendingCount > 0 &&
    remaining > 0
  ) {
    const uniform = remaining / pendingCount;
    if (uniform < opts.minInstallmentValue - 0.005) {
      const adjustedPending = Math.ceil(remaining / opts.minInstallmentValue);
      if (adjustedPending !== pendingCount) {
        pendingCount = Math.min(60 - paidCount, Math.max(1, adjustedPending));
        bumped = true;
      }
    }
  }
  const N = paidCount + pendingCount;

  const pendingValue = pendingCount > 0 ? round2(remaining / pendingCount) : 0;

  // Base para as datas pendentes.
  const lastPaid = [...paid].sort((a, b) => a.number - b.number).pop();
  const baseIso =
    lastPaid?.paidAt ??
    lastPaid?.dueDate ??
    current.startDate ??
    new Date().toISOString();
  const base = new Date(baseIso);
  if (opts.dueDay && opts.dueDay >= 1 && opts.dueDay <= 31) {
    const clampDay = Math.min(
      opts.dueDay,
      new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate(),
    );
    base.setDate(clampDay);
  }

  const installments: MGMVInstallment[] = [];
  paid.forEach((i, idx) => {
    installments.push({ ...i, number: idx + 1, total: N });
  });

  // Soma acumulada para ajustar centavos na última pendente.
  let acc = 0;
  for (let k = 0; k < pendingCount; k++) {
    const num = paidCount + k + 1;
    const isLast = k === pendingCount - 1;
    let value = pendingValue;
    if (isLast) value = round2(remaining - acc);
    else acc = round2(acc + pendingValue);
    installments.push({
      number: num,
      total: N,
      dueDate: addMonthsClampDay(base, k + 1).toISOString(),
      value: Math.max(0, value),
      paid: false,
    });
  }

  return {
    agreement: {
      ...current,
      totalDebt,
      installments,
    },
    bumpedInstallments: bumped,
    pendingValue,
    remaining,
  };
}