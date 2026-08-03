import type { FinancialStatus, Product } from "@/lib/store";
import { isOpenSituation, isOverdue } from "@/lib/store";

type ToneInput = Pick<Product, "financialStatus" | "situation" | "dueDate">;

/** Classificação única usada pelo fundo, pelo texto e pela Tag do status. */
export type StatusTone = "closed" | "paid" | "overdue" | "reserva" | "none";

export function productToneKind(p: ToneInput): StatusTone {
  if (!isOpenSituation({ situation: p.situation, financialStatus: p.financialStatus })) {
    return "closed";
  }
  if (p.financialStatus === "Pendente") return "overdue";
  if (p.financialStatus === "Reserva") {
    return p.dueDate && isOverdue(p.dueDate) ? "overdue" : "reserva";
  }
  if (p.financialStatus === "Pago") return "paid";
  return "none";
}

/**
 * Fundo suave por status financeiro do produto.
 *
 * Regras:
 * - Situação fechada (Enviado, Removido, Retirado, Resolvido, ...) -> cinza,
 *   mesmo que o item esteja pago ou vencido.
 * - Pago em aberto -> verde.
 * - Pendente ou Reserva vencida -> vermelho.
 * - Reserva dentro do prazo -> amarelo.
 */
export function productStatusTone(p: ToneInput): string {
  switch (productToneKind(p)) {
    case "closed":
      return "bg-muted/40 text-muted-foreground";
    case "paid":
      return "bg-[color:var(--success)]/10";
    case "reserva":
      return "bg-[color:var(--warning)]/10";
    case "overdue":
      return "bg-destructive/10";
    default:
      return "";
  }
}

/** Cor do rótulo do status (a "letra"), no mesmo critério do fundo. */
export function productStatusTextTone(p: ToneInput): string {
  switch (productToneKind(p)) {
    case "closed":
      return "text-muted-foreground";
    case "overdue":
      return "text-destructive font-semibold";
    default:
      return "";
  }
}

/** Variante da <Tag> do status, alinhada às cores da legenda. */
export function productStatusVariant(
  p: ToneInput,
): "neutral" | "success" | "danger" | "warning" {
  switch (productToneKind(p)) {
    case "closed":
      return "neutral";
    case "paid":
      return "success";
    case "reserva":
      return "warning";
    case "overdue":
      return "danger";
    default:
      return "neutral";
  }
}

export type { FinancialStatus };