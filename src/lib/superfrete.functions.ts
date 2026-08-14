import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SUPERFRETE_SERVICES, mapSuperfreteStatus } from "@/lib/superfrete-status";

export interface SuperfreteQuoteOption {
  id: string;
  name: string;
  company: string;
  priceCents: number;
  deliveryDays: number | null;
  error: string | null;
  packages: Array<{
    weightKg: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
  }>;
}

export interface SuperfreteOrderInfo {
  orderId: string;
  status: string | null;
  internalStatus: string;
  trackingCode: string | null;
  labelUrl: string | null;
  priceCents: number | null;
  serviceName: string | null;
}

const AddressSchema = z.object({
  name: z.string().default(""),
  document: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  postalCode: z.string().default(""),
  street: z.string().default(""),
  number: z.string().default(""),
  complement: z.string().default(""),
  district: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
});
export type SuperfreteAddress = z.infer<typeof AddressSchema>;

const ProductSchema = z.object({
  name: z.string().default("Produto"),
  quantity: z.number().int().min(1).default(1),
  unitaryValue: z.number().nonnegative().default(0),
  weightKg: z.number().nonnegative().default(0.3),
  lengthCm: z.number().nonnegative().default(16),
  widthCm: z.number().nonnegative().default(11),
  heightCm: z.number().nonnegative().default(2),
});

const digits = (v: string) => (v ?? "").replace(/\D/g, "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toCents(v: unknown): number {
  return Math.round(num(v) * 100);
}

/** Mensagem amigável única para qualquer falha da integração. */
const FRIENDLY =
  "Não foi possível concluir a operação com a SuperFrete. Verifique CEP, peso, medidas e tente novamente.";

/** Erro detalhado: mostra o motivo real devolvido pela SuperFrete. */
function friendlyError(e: unknown, fallback = FRIENDLY): Error {
  const err = e as { name?: string; message?: string; status?: number };
  if (err?.name !== "SuperfreteError") return new Error(fallback);
  const detail = (err.message || "").trim();
  const status = err.status ?? 0;
  if (status === 401 || status === 403) {
    return new Error("Token da SuperFrete inválido ou sem permissão para esta operação.");
  }
  if (status === 402 || /saldo|balance|insufficient/i.test(detail)) {
    return new Error(
      "A SuperFrete recusou a liberação por saldo insuficiente na carteira do ambiente atual.",
    );
  }
  if (status === 0) return new Error(detail || "Não foi possível contatar a SuperFrete.");
  return new Error(detail ? `SuperFrete: ${detail}` : fallback);
}

async function logEvent(
  supabase: { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } },
  userId: string,
  entry: {
    shipmentId?: string | null;
    action: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    message?: string | null;
    payload?: unknown;
    response?: unknown;
  },
) {
  const { sanitizeForLog } = await import("@/lib/superfrete.server");
  try {
    await supabase.from("shipment_logs").insert({
      shipment_id: entry.shipmentId ?? null,
      action: entry.action,
      previous_status: entry.previousStatus ?? null,
      new_status: entry.newStatus ?? null,
      message: entry.message ?? null,
      payload: sanitizeForLog(entry.payload ?? null) as never,
      response: sanitizeForLog(entry.response ?? null) as never,
      created_by: userId,
    });
  } catch (e) {
    console.error("[SuperFrete] falha ao gravar log", e);
  }
}

/** Cotação de frete — POST /calculator. */
export const calculateSuperfreteQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        from: AddressSchema,
        to: AddressSchema,
        products: z.array(ProductSchema).min(1),
        insuranceValue: z.number().nonnegative().default(0),
        services: z.string().default(SUPERFRETE_SERVICES),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ options: SuperfreteQuoteOption[] }> => {
    const { superfreteRequest, SuperfreteError } = await import("@/lib/superfrete.server");

    const fromCep = digits(data.from.postalCode);
    const toCep = digits(data.to.postalCode);
    if (fromCep.length !== 8) throw new Error("Informe o CEP de origem nas configurações de envio.");
    if (toCep.length !== 8) throw new Error("Complete os dados do destinatário antes de calcular o frete.");

    const payload = {
      from: { postal_code: fromCep },
      to: { postal_code: toCep },
      services: data.services,
      options: {
        own_hand: false,
        receipt: false,
        insurance_value: Number(data.insuranceValue.toFixed(2)),
        use_insurance_value: data.insuranceValue > 0,
      },
      products: data.products.map((p) => ({
        name: p.name,
        quantity: p.quantity,
        unitary_value: Number(p.unitaryValue.toFixed(2)),
        weight: Math.max(0.01, p.weightKg),
        length: Math.max(1, p.lengthCm),
        width: Math.max(1, p.widthCm),
        height: Math.max(1, p.heightCm),
      })),
    };

    try {
      const raw = await superfreteRequest<unknown[]>("/calculator", { method: "POST", body: payload });
      const options: SuperfreteQuoteOption[] = (Array.isArray(raw) ? raw : []).map((item) => {
        const r = item as Record<string, unknown>;
        const company = (r["company"] as Record<string, unknown> | undefined) ?? {};
        const packages = Array.isArray(r["packages"]) ? (r["packages"] as Record<string, unknown>[]) : [];
        const dims = packages.map((pk) => {
          const d = (pk["dimensions"] as Record<string, unknown> | undefined) ?? {};
          return {
            weightKg: pk["weight"] != null ? num(pk["weight"]) : null,
            lengthCm: d["length"] != null ? num(d["length"]) : null,
            widthCm: d["width"] != null ? num(d["width"]) : null,
            heightCm: d["height"] != null ? num(d["height"]) : null,
          };
        });
        return {
          id: String(r["id"] ?? ""),
          name: String(r["name"] ?? ""),
          company: String(company["name"] ?? ""),
          priceCents: toCents(r["price"]),
          deliveryDays: r["delivery_time"] != null ? num(r["delivery_time"]) : null,
          error: typeof r["error"] === "string" ? (r["error"] as string) : null,
          packages: dims,
        };
      });

      await logEvent(context.supabase as never, context.userId, {
        action: "cotacao_calculada",
        message: `${options.filter((o) => !o.error).length} opção(ões) retornadas`,
        payload,
        response: raw,
      });

      return { options };
    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      await logEvent(context.supabase as never, context.userId, {
        action: "erro_cotacao",
        message,
        payload,
        response: e instanceof SuperfreteError ? e.body : null,
      });
      throw new Error(FRIENDLY);
    }
  });

function addressToApi(a: SuperfreteAddress) {
  return {
    name: a.name,
    address: a.street,
    complement: a.complement,
    number: a.number,
    district: a.district,
    city: a.city,
    country_id: "BR",
    postal_code: digits(a.postalCode),
    state_abbr: a.state.toUpperCase().slice(0, 2),
    email: a.email || undefined,
    phone: digits(a.phone) || undefined,
    document: digits(a.document) || undefined,
  };
}

/** Criação da etiqueta/pedido — POST /cart. */
export const createSuperfreteCartOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        shipmentId: z.string().uuid(),
        from: AddressSchema,
        to: AddressSchema,
        service: z.string().min(1),
        products: z.array(ProductSchema).min(1),
        volumes: z.object({
          weightKg: z.number().positive(),
          lengthCm: z.number().positive(),
          widthCm: z.number().positive(),
          heightCm: z.number().positive(),
        }),
        insuranceValue: z.number().nonnegative().default(0),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { superfreteRequest, SuperfreteError } = await import("@/lib/superfrete.server");
    const { supabase, userId } = context;

    const payload = {
      from: addressToApi(data.from),
      to: addressToApi(data.to),
      service: Number(data.service),
      products: data.products.map((p) => ({
        name: p.name,
        quantity: p.quantity,
        unitary_value: Number(p.unitaryValue.toFixed(2)),
      })),
      volumes: {
        height: Math.max(1, data.volumes.heightCm),
        width: Math.max(1, data.volumes.widthCm),
        length: Math.max(1, data.volumes.lengthCm),
        weight: Math.max(0.01, data.volumes.weightKg),
      },
      options: {
        insurance_value: Number(data.insuranceValue.toFixed(2)),
        receipt: false,
        own_hand: false,
        reverse: false,
        non_commercial: true,
        platform: "Star Games",
      },
    };

    try {
      const raw = await superfreteRequest<Record<string, unknown>>("/cart", {
        method: "POST",
        body: payload,
      });
      const orderId = String(raw["id"] ?? "");
      const status = (raw["status"] as string | undefined) ?? "pending";
      const internal = mapSuperfreteStatus(status);
      const { sanitizeForLog } = await import("@/lib/superfrete.server");

      await supabase
        .from("shipments")
        .update({
          superfrete_order_id: orderId || null,
          superfrete_status: status,
          status: internal,
          payload_cart: sanitizeForLog(payload) as never,
          response_cart: sanitizeForLog(raw) as never,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", data.shipmentId);

      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "etiqueta_criada",
        newStatus: internal,
        message: `Pedido ${orderId} criado na SuperFrete`,
        payload,
        response: raw,
      });

      return { orderId, status, internalStatus: internal };
    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "erro_criar_etiqueta",
        message,
        payload,
        response: e instanceof SuperfreteError ? e.body : null,
      });
      throw new Error(FRIENDLY);
    }
  });

/** Liberação/pagamento da etiqueta no Sandbox — POST /checkout. */
export const checkoutSuperfreteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ shipmentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { superfreteRequest, SuperfreteError } = await import("@/lib/superfrete.server");
    const { supabase, userId } = context;

    const { data: row } = await supabase
      .from("shipments")
      .select("id, superfrete_order_id, status")
      .eq("id", data.shipmentId)
      .maybeSingle();
    const orderId = (row as Record<string, unknown> | null)?.["superfrete_order_id"] as
      | string
      | undefined;
    if (!orderId) throw new Error("Este envio ainda não tem etiqueta criada na SuperFrete.");

    const payload = { orders: [orderId] };
    try {
      const raw = await superfreteRequest<Record<string, unknown>>("/checkout", {
        method: "POST",
        body: payload,
      });
      const internal = "Etiqueta liberada / aguardando postagem";
      await supabase
        .from("shipments")
        .update({
          status: internal,
          superfrete_status: "released",
          released_at: new Date().toISOString(),
        })
        .eq("id", data.shipmentId);

      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "etiqueta_liberada",
        previousStatus: (row as Record<string, unknown> | null)?.["status"] as string | null,
        newStatus: internal,
        message: `Etiqueta ${orderId} liberada no ambiente Sandbox`,
        payload,
        response: raw,
      });
      return { internalStatus: internal };
    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "erro_liberar_etiqueta",
        message,
        payload,
        response: e instanceof SuperfreteError ? e.body : null,
      });
      throw new Error(FRIENDLY);
    }
  });

/** Consulta da etiqueta — GET /order/info/{id}. */
export const getSuperfreteOrderInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ shipmentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<SuperfreteOrderInfo> => {
    const { superfreteRequest, SuperfreteError, sanitizeForLog } = await import(
      "@/lib/superfrete.server"
    );
    const { supabase, userId } = context;

    const { data: row } = await supabase
      .from("shipments")
      .select("id, superfrete_order_id, status")
      .eq("id", data.shipmentId)
      .maybeSingle();
    const orderId = (row as Record<string, unknown> | null)?.["superfrete_order_id"] as
      | string
      | undefined;
    if (!orderId) throw new Error("Este envio ainda não tem etiqueta criada na SuperFrete.");

    try {
      const raw = await superfreteRequest<Record<string, unknown>>(`/order/info/${orderId}`, {
        method: "GET",
      });
      const status = (raw["status"] as string | null) ?? null;
      const internal = mapSuperfreteStatus(status);
      const tracking = (raw["tracking"] as string | null) ?? null;
      const labelUrl =
        (raw["print"] as Record<string, unknown> | undefined)?.["url"] as string | undefined;

      const patch: Record<string, unknown> = {
        superfrete_status: status,
        status: internal,
        tracking_code: tracking,
        label_url: labelUrl ?? null,
        response_order_info: sanitizeForLog(raw) as never,
      };
      const now = new Date().toISOString();
      if (internal === "Postado / Enviado") patch["posted_at"] = now;
      if (internal === "Entregue") patch["delivered_at"] = now;
      if (internal === "Cancelado") patch["cancelled_at"] = now;

      await supabase.from("shipments").update(patch as never).eq("id", data.shipmentId);
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "consulta_etiqueta",
        previousStatus: (row as Record<string, unknown> | null)?.["status"] as string | null,
        newStatus: internal,
        message: `Status na SuperFrete: ${status ?? "desconhecido"}`,
        response: raw,
      });

      return {
        orderId,
        status,
        internalStatus: internal,
        trackingCode: tracking,
        labelUrl: labelUrl ?? null,
        priceCents: raw["price"] != null ? Math.round(num(raw["price"]) * 100) : null,
        serviceName: (raw["service_name"] as string | null) ?? null,
      };
    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "erro_consulta_etiqueta",
        message,
        response: e instanceof SuperfreteError ? e.body : null,
      });
      throw new Error(FRIENDLY);
    }
  });
