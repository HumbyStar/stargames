import type { MGMVAgreement, MGMVInstallment } from "@/lib/store";

/** Soma `months` mantendo o mesmo dia; clampa ao último dia do mês destino. */
function addMonthsClampDay(base: Date, months: number): Date {
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