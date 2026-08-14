/** Mapeamento dos status da SuperFrete para os status internos do Star Games. */
export type ShipmentInternalStatus =
  | "Rascunho"
  | "Etiqueta pendente de pagamento"
  | "Etiqueta liberada / aguardando postagem"
  | "Postado / Enviado"
  | "Entregue"
  | "Cancelado";

export function mapSuperfreteStatus(raw: string | null | undefined): ShipmentInternalStatus {
  const s = (raw ?? "").toLowerCase().trim();
  if (s === "pending") return "Etiqueta pendente de pagamento";
  if (s === "released" || s === "paid") return "Etiqueta liberada / aguardando postagem";
  if (s === "posted") return "Postado / Enviado";
  if (s === "delivered") return "Entregue";
  if (s === "cancelled" || s === "canceled") return "Cancelado";
  return "Rascunho";
}

/** Só um envio efetivamente postado permite marcar o produto como "Enviado". */
export function allowsMarkAsSent(status: ShipmentInternalStatus): boolean {
  return status === "Postado / Enviado" || status === "Entregue";
}

/** Serviços usados na cotação inicial (ids oficiais da SuperFrete). */
export const SUPERFRETE_SERVICES = "1,2,17,3,31,33";
