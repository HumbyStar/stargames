import type { FinancialStatus, Product } from "@/lib/store";
import { isOpenSituation } from "@/lib/store";

/**
 * Fundo suave por status financeiro do produto — apenas para identificação
 * visual rápida (ex.: separar os pagos na hora de gerar a nota fiscal).
 *
 * Regra: a cor só aparece para itens EM ABERTO. Situações resolvidas
 * (Enviado, Removido, Retirado, Resolvido, ...) ficam sem cor, mesmo pagas,
 * para não confundir cores de status com cores de situação.
 */
export function productStatusTone(
  status: FinancialStatus | string,
  situation?: Product["situation"],
): string {
  if (
    situation !== undefined &&
    !isOpenSituation({ situation, financialStatus: status as FinancialStatus })
  ) {
    return "";
  }
  switch (status) {
    case "Pago":
      return "bg-[color:var(--success)]/10";
    case "Reserva":
      return "bg-[color:var(--warning)]/10";
    case "Pendente":
      return "bg-destructive/10";
    default:
      return "";
  }
}