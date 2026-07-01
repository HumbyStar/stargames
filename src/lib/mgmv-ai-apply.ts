import type { MGMVAgreement, MGMVInstallment } from "@/lib/store";
import type { MgmvAiReviewSuggestion } from "@/lib/mgmv-ai-review.functions";
import { addMonthsClampDay } from "@/sections/import-section";

/**
 * Aplica uma sugestão da IA sobre um acordo MGMV, preservando dueDates e
 * paidAt das parcelas existentes sempre que possível. Função pura — usada
 * tanto na seção MGMV (revisão de acordos já salvos) quanto no preview da
 * importação (pente-fino híbrido), por isso fica isolada deste lado client.
 */
export function applySuggestionToAgreement(
  current: MGMVAgreement,
  s: MgmvAiReviewSuggestion,
): MGMVAgreement {
  const N = Math.max(0, s.installmentsCount ?? current.installments.length);
  const V = s.installmentValue ?? current.installments[0]?.value ?? 0;
  const T = s.totalAgreementValue ?? N * V;
  const P = Math.max(0, Math.min(N, s.paidInstallments ?? 0));

  const existing = current.installments;
  const fallbackDue =
    existing[existing.length - 1]?.dueDate ??
    current.startDate ??
    new Date().toISOString();
  const nowIso = new Date().toISOString();

  // Última parcela paga (com data) — base para recalcular vencimentos das
  // parcelas pendentes: cada uma cai +1 mês em relação à anterior, começando
  // por lastPaidDate + 1 mês.
  let lastPaidNumber = 0;
  let lastPaidDate: Date | null = null;
  for (let n = 1; n <= P; n++) {
    const prior = existing.find((x) => x.number === n);
    const iso = prior?.paidAt ?? prior?.dueDate;
    if (iso) {
      lastPaidNumber = n;
      lastPaidDate = new Date(iso);
    }
  }

  const installments: MGMVInstallment[] = Array.from({ length: N }, (_, i) => {
    const number = i + 1;
    const prior = existing.find((x) => x.number === number);
    const paid = number <= P;
    // Se a IA identificou pagamento parcial nesta parcela, aplica.
    const isPartial =
      !paid &&
      s.partialPaidInstallment === number &&
      typeof s.partialPaidAmount === "number" &&
      s.partialPaidAmount > 0 &&
      s.partialPaidAmount < V;
    // Desconto vindo de pagamento excedente da parcela anterior.
    const discountTarget = s.discountAppliedToInstallment ?? P + 1;
    const discountValue =
      typeof s.nextInstallmentDiscount === "number" && s.nextInstallmentDiscount > 0
        ? s.nextInstallmentDiscount
        : 0;
    const hasDiscount = !paid && number === discountTarget && discountValue > 0;
    const effectiveValue = hasDiscount ? Math.max(0, V - discountValue) : V;
    let dueDate: string;
    if (paid) {
      dueDate = prior?.paidAt ?? prior?.dueDate ?? fallbackDue;
    } else if (lastPaidDate && number > lastPaidNumber) {
      dueDate = addMonthsClampDay(lastPaidDate, number - lastPaidNumber).toISOString();
    } else {
      dueDate = prior?.dueDate ?? fallbackDue;
    }
    return {
      number,
      total: N,
      dueDate,
      value: effectiveValue,
      paid,
      paidAt: paid ? prior?.paidAt ?? nowIso : undefined,
      paidAmount: paid
        ? V
        : isPartial
          ? (s.partialPaidAmount as number)
          : hasDiscount
            ? discountValue
            : prior?.paidAmount,
    };
  });

  return {
    startDate: current.startDate,
    totalDebt: T,
    installments,
  };
}

/**
 * Heurística para decidir se um acordo MGMV recém-extraído pelo parser por
 * regra precisa de auto-revisão pela IA. Usado no pente-fino híbrido: o que
 * ela detecta é revisado automaticamente; o restante fica sob demanda.
 */
export function isMgmvAgreementSuspect(
  agreement: MGMVAgreement,
  rawNotes?: string,
): boolean {
  const N = agreement.installments.length;
  const V = agreement.installments[0]?.value ?? 0;
  if (N === 0) return true;
  if (V <= 0) return true;
  const total = agreement.totalDebt || 0;
  if (total <= 0) return true;
  if (Math.abs(N * V - total) > 0.01) return true;

  if (rawNotes) {
    const lower = rawNotes.toLowerCase();
    const mentionsPaid =
      /\b(\d+)\s*parcelas?\s*pag/i.test(rawNotes) ||
      /pagou\s+(\d+)/i.test(rawNotes) ||
      /parcela\s+paga/i.test(lower);
    const paidCount = agreement.installments.filter((i) => i.paid).length;
    if (mentionsPaid && paidCount === 0) return true;
    // Sinais fortes de pagamento parcial / contagem conflitante nas notas.
    if (/parcial|entrada|sinal/i.test(lower)) return true;
    // "X/Y Parcela" com Y != N: conta declarada difere do parser.
    const frac = rawNotes.match(/(\d+)\s*\/\s*(\d+)\s*parcela/i);
    if (frac) {
      const y = Number(frac[2]);
      if (Number.isFinite(y) && y !== N) return true;
    }
  }
  return false;
}