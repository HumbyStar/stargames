import { useStore, type Client, type MGMVAgreement } from "@/lib/store";
import { extractMGMVAgreementFromNotes } from "@/sections/import-section";

/**
 * Um acordo é considerado "protegido" quando já foi tocado pelo usuário
 * ou pela IA — reprocessar a partir das observações destruiria essas
 * edições. Nesses casos o reprocess ignora o cliente por completo.
 */
function isAgreementProtected(
  current: MGMVAgreement | undefined,
  parsed: MGMVAgreement,
): boolean {
  if (!current) return false;
  if (
    current.reviewStatus === "manually_reviewed" ||
    current.reviewStatus === "ai_reviewed" ||
    current.aiReviewed === true
  ) {
    return true;
  }
  // Qualquer sinal de pagamento/edição manual em parcelas
  const touched = current.installments.some((i) => {
    const anyI = i as unknown as {
      paid?: boolean;
      paidAmount?: number | null;
      manualPartial?: boolean;
      shortPaid?: boolean;
      recalculatedAt?: string | null;
    };
    return (
      anyI.paid === true ||
      (anyI.paidAmount != null && anyI.paidAmount > 0) ||
      anyI.manualPartial === true ||
      anyI.shortPaid === true ||
      !!anyI.recalculatedAt
    );
  });
  if (touched) return true;
  // Divergência estrutural entre o acordo atual e o que sairia das notes:
  // total ou número de parcelas diferentes indicam ajuste manual do total.
  if (current.installments.length !== parsed.installments.length) return true;
  const roundedCurrent = Math.round((current.totalDebt || 0) * 100);
  const roundedParsed = Math.round((parsed.totalDebt || 0) * 100);
  if (roundedCurrent !== roundedParsed) return true;
  return false;
}

export type ReprocessResult = {
  updatedIds: string[];
  skippedIds: string[];
};

/**
 * Reprocessa acordos MGMV a partir das observações dos clientes,
 * preservando edições manuais / IA (ver `isAgreementProtected`).
 */
export function reprocessMGMVFromNotes(clientIds?: string[]): ReprocessResult {
  const state = useStore.getState();
  const setMGMVAgreement = state.setMGMVAgreement;
  const clients: Client[] = clientIds
    ? state.clients.filter((c) => clientIds.includes(c.id))
    : state.clients;
  const updatedIds: string[] = [];
  const skippedIds: string[] = [];
  for (const c of clients) {
    if (!c.notes) continue;
    const parsed = extractMGMVAgreementFromNotes(c.notes);
    if (!parsed) continue;
    if (isAgreementProtected(c.mgmv, parsed)) {
      skippedIds.push(c.id);
      continue;
    }
    const next: MGMVAgreement = {
      ...parsed,
      startDate: c.mgmv?.startDate ?? parsed.startDate,
    };
    if (c.mgmv) {
      next.installments = next.installments.map((ni) => {
        const prev = c.mgmv!.installments.find((p) => p.number === ni.number);
        if (!prev) return ni;
        if (prev.paid && !ni.paid) {
          return { ...ni, paid: true, paidAt: prev.paidAt };
        }
        if (ni.paid && !ni.paidAt && prev.paidAt) {
          return { ...ni, paidAt: prev.paidAt };
        }
        return ni;
      });
    }
    const isSame =
      c.mgmv != null && JSON.stringify(c.mgmv) === JSON.stringify(next);
    if (isSame) continue;
    setMGMVAgreement(c.id, next);
    updatedIds.push(c.id);
  }
  return { updatedIds, skippedIds };
}