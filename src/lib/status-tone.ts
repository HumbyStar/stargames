import type { FinancialStatus } from "@/lib/store";

/**
 * Fundo suave por status financeiro do produto — apenas para identificação
 * visual rápida (ex.: separar os pagos na hora de gerar a nota fiscal).
 */
export function productStatusTone(status: FinancialStatus | string): string {
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