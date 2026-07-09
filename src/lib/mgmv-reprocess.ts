import { useStore, type MGMVAgreement } from "@/lib/store";
import { extractMGMVAgreementFromNotes } from "@/sections/import-section";

/**
 * Reprocessa acordos MGMV a partir das observações dos clientes.
 * Extraído para ser reutilizado tanto pelo botão manual na seção MGMV
 * quanto automaticamente ao final de cada confirmação de importação —
 * assim o usuário não precisa mais clicar em "Reprocessar MGMV por
 * observações" toda vez que importa um lote.
 *
 * Retorna a lista de clientIds que tiveram acordo efetivamente atualizado.
 */
export function reprocessMGMVFromNotes(clientIds?: string[]): string[] {
  const state = useStore.getState();
  const setMGMVAgreement = state.setMGMVAgreement;
  const clients = clientIds
    ? state.clients.filter((c) => clientIds.includes(c.id))
    : state.clients;
  const updatedIds: string[] = [];
  for (const c of clients) {
    if (!c.notes) continue;
    const parsed = extractMGMVAgreementFromNotes(c.notes);
    if (!parsed) continue;
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
  return updatedIds;
}