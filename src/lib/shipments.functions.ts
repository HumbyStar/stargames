import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ShipmentItem {
  productId: string;
  name: string;
  platform: string;
  value: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ShipmentRecipient {
  fullName: string;
  cpfCnpj: string;
  phone: string;
  email: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface ShipmentRow {
  id: string;
  clientId: string;
  clientName: string;
  carrier: string;
  service: string;
  etaDays: number | null;
  priceCents: number;
  totalWeightKg: number;
  items: ShipmentItem[];
  recipient: ShipmentRecipient | null;
  notes: string | null;
  createdAt: string;
  status: string;
  superfreteOrderId: string | null;
  superfreteStatus: string | null;
  selectedServiceId: string | null;
  selectedServiceName: string | null;
  trackingCode: string | null;
  labelUrl: string | null;
}

const ItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  platform: z.string().default(""),
  value: z.number().nonnegative().default(0),
  weightKg: z.number().nonnegative().default(0),
  lengthCm: z.number().nonnegative().default(0),
  widthCm: z.number().nonnegative().default(0),
  heightCm: z.number().nonnegative().default(0),
});

const RecipientSchema = z.object({
  fullName: z.string().default(""),
  cpfCnpj: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  cep: z.string().default(""),
  street: z.string().default(""),
  number: z.string().default(""),
  complement: z.string().default(""),
  neighborhood: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
});

const CreateSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string().min(1),
  carrier: z.string().min(1),
  service: z.string().default(""),
  etaDays: z.number().int().nonnegative().nullable().default(null),
  priceCents: z.number().int().nonnegative().default(0),
  totalWeightKg: z.number().nonnegative().default(0),
  items: z.array(ItemSchema).min(1),
  recipient: RecipientSchema,
  notes: z.string().nullable().default(null),
  selectedServiceId: z.string().nullable().default(null),
  selectedServiceName: z.string().nullable().default(null),
  payloadQuote: z.unknown().nullable().default(null),
  responseQuote: z.unknown().nullable().default(null),
});

function mapRow(r: Record<string, unknown>): ShipmentRow {
  return {
    id: r["id"] as string,
    clientId: r["client_id"] as string,
    clientName: (r["client_name"] as string) ?? "",
    carrier: (r["carrier"] as string) ?? "",
    service: (r["service"] as string) ?? "",
    etaDays: (r["eta_days"] as number | null) ?? null,
    priceCents: Number(r["price_cents"] ?? 0),
    totalWeightKg: Number(r["total_weight_kg"] ?? 0),
    items: (r["items"] as ShipmentItem[]) ?? [],
    recipient: (r["recipient"] as ShipmentRecipient | null) ?? null,
    notes: (r["notes"] as string | null) ?? null,
    createdAt: r["created_at"] as string,
    status: (r["status"] as string) ?? "Rascunho",
    superfreteOrderId: (r["superfrete_order_id"] as string | null) ?? null,
    superfreteStatus: (r["superfrete_status"] as string | null) ?? null,
    selectedServiceId: (r["selected_service_id"] as string | null) ?? null,
    selectedServiceName: (r["selected_service_name"] as string | null) ?? null,
    trackingCode: (r["tracking_code"] as string | null) ?? null,
    labelUrl: (r["label_url"] as string | null) ?? null,
  };
}

/** Registra um envio no histórico. Os produtos são marcados pelo cliente. */
export const createShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateSchema.parse(data))
  .handler(async ({ data, context }): Promise<ShipmentRow> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("shipments")
      .insert({
        client_id: data.clientId,
        client_name: data.clientName,
        carrier: data.carrier,
        service: data.service,
        eta_days: data.etaDays,
        price_cents: data.priceCents,
        total_weight_kg: data.totalWeightKg,
        items: data.items as unknown as never,
        recipient: data.recipient as unknown as never,
        product_ids: data.items.map((i) => i.productId),
        notes: data.notes,
        created_by: userId,
        status: "Etiqueta pendente de pagamento",
        selected_service_id: data.selectedServiceId,
        selected_service_name: data.selectedServiceName,
        estimated_delivery_days: data.etaDays,
        payload_quote: (data.payloadQuote ?? null) as never,
        response_quote: (data.responseQuote ?? null) as never,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row as Record<string, unknown>);
  });

/** Histórico de envios do ambiente atual (mais recentes primeiro). */
export const listShipments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId?: string; limit?: number }) =>
    z
      .object({ clientId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<ShipmentRow[]> => {
    let q = context.supabase
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => mapRow(r as Record<string, unknown>));
  });