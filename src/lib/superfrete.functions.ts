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
  /** Valor efetivamente coberto pelo seguro nesta transportadora (R$). */
  insuredValue: number | null;
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

/**
 * Telefone no formato exigido pela SuperFrete (11 dígitos).
 * Números antigos com 10 dígitos ganham o 9 depois do DDD.
 */
const normalizePhone = (v: string) => {
  let d = digits(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
};
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
        let insured: number | null = null;
        const dims = packages.map((pk) => {
          const d = (pk["dimensions"] as Record<string, unknown> | undefined) ?? {};
          if (pk["insurance_value"] != null) {
            const v = num(pk["insurance_value"]);
            if (Number.isFinite(v)) insured = (insured ?? 0) + v;
          }
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
          insuredValue: insured,
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
      throw friendlyError(e);
    }
  });

export interface SuperfreteSyncResult {
  checked: number;
  updated: number;
  failed: number;
  changes: Array<{ shipmentId: string; status: string; trackingCode: string | null }>;
}

/**
 * Rotina de sincronização periódica: consulta na SuperFrete todas as etiquetas
 * ainda em andamento (não entregues/canceladas) e atualiza status, rastreio e
 * URL da etiqueta no banco. Devolve apenas o que mudou.
 */
export const syncSuperfreteShipments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ limit: z.number().int().min(1).max(50).default(25) })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<SuperfreteSyncResult> => {
    const { superfreteRequest, sanitizeForLog } = await import("@/lib/superfrete.server");
    const { supabase } = context;

    const { data: rows } = await supabase
      .from("shipments")
      .select("id, superfrete_order_id, status, superfrete_status, tracking_code")
      .not("superfrete_order_id", "is", null)
      .not("status", "in", '("Entregue","Cancelado")')
      .order("created_at", { ascending: false })
      .limit(data.limit);

    const result: SuperfreteSyncResult = { checked: 0, updated: 0, failed: 0, changes: [] };

    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const shipmentId = r["id"] as string;
      const orderId = r["superfrete_order_id"] as string | null;
      if (!orderId) continue;
      result.checked += 1;
      try {
        const raw = await superfreteRequest<Record<string, unknown>>(`/order/info/${orderId}`, {
          method: "GET",
        });
        const status = (raw["status"] as string | null) ?? null;
        const internal = mapSuperfreteStatus(status);
        const tracking = (raw["tracking"] as string | null) ?? null;
        const labelUrl =
          ((raw["print"] as Record<string, unknown> | undefined)?.["url"] as string | undefined) ??
          null;

        const unchanged =
          internal === (r["status"] as string | null) &&
          status === (r["superfrete_status"] as string | null) &&
          tracking === (r["tracking_code"] as string | null);
        if (unchanged) continue;

        const patch: Record<string, unknown> = {
          superfrete_status: status,
          status: internal,
          tracking_code: tracking,
          label_url: labelUrl,
          response_order_info: sanitizeForLog(raw) as never,
        };
        const now = new Date().toISOString();
        if (internal === "Postado / Enviado") patch["posted_at"] = now;
        if (internal === "Entregue") patch["delivered_at"] = now;
        if (internal === "Cancelado") patch["cancelled_at"] = now;

        await supabase.from("shipments").update(patch as never).eq("id", shipmentId);
        result.updated += 1;
        result.changes.push({ shipmentId, status: internal, trackingCode: tracking });
      } catch {
        result.failed += 1;
      }
    }

    return result;
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
    phone: normalizePhone(a.phone) || undefined,
    document: digits(a.document) || undefined,
  };
}

/**
 * Valida os dados do destinatário nos mesmos critérios da SuperFrete,
 * devolvendo mensagens em português antes de gastar a chamada de API.
 */
function assertRecipient(a: SuperfreteAddress) {
  const problems: string[] = [];
  if (!a.name.trim()) problems.push("informe o nome do destinatário");
  const doc = digits(a.document);
  if (doc.length !== 11 && doc.length !== 14) {
    problems.push("CPF (11 dígitos) ou CNPJ (14 dígitos) do destinatário está incompleto");
  }
  const phone = normalizePhone(a.phone);
  if (phone.length !== 11) {
    problems.push("o telefone do destinatário deve ter 11 dígitos (DDD + 9 dígitos)");
  }
  if (digits(a.postalCode).length !== 8) problems.push("o CEP do destinatário deve ter 8 dígitos");
  if (!a.street.trim()) problems.push("informe o endereço (rua)");
  if (!a.number.trim()) problems.push("informe o número do endereço");
  if (!a.city.trim()) problems.push("informe a cidade");
  if (a.state.trim().length !== 2) problems.push("informe o estado (UF) com 2 letras");
  if (problems.length > 0) {
    throw new Error(`Dados do destinatário incompletos: ${problems.join("; ")}.`);
  }
}

/** Limites das transportadoras aplicados também no servidor. */
function assertBoxes(boxes: Array<z.infer<typeof ProductSchema>>) {
  const problems: string[] = [];
  boxes.forEach((b, i) => {
    const tag = `Caixa #${i + 1}`;
    if (b.weightKg > 30) problems.push(`${tag}: peso ${b.weightKg}kg acima de 30kg`);
    if (b.weightKg <= 0) problems.push(`${tag}: informe o peso em kg`);
    if (b.lengthCm < 16 || b.widthCm < 11 || b.heightCm < 2) {
      problems.push(`${tag}: medidas mínimas 16×11×2cm`);
    }
    if (Math.max(b.lengthCm, b.widthCm, b.heightCm) > 100) {
      problems.push(`${tag}: nenhum lado pode passar de 100cm`);
    }
    if (b.lengthCm + b.widthCm + b.heightCm > 200) {
      problems.push(`${tag}: soma das medidas acima de 200cm`);
    }
  });
  if (problems.length > 0) throw new Error(problems.join(" · "));
}


/** Criação da etiqueta/pedido — POST /cart. */
export const createSuperfreteCartOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        /** Opcional: quando ausente, o envio só é gravado após a etiqueta existir. */
        shipmentId: z.string().uuid().nullable().default(null),
        from: AddressSchema,
        to: AddressSchema,
        service: z.string().min(1),
        products: z.array(ProductSchema).min(1),
        insuranceValue: z.number().nonnegative().default(0),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { superfreteRequest, SuperfreteError } = await import("@/lib/superfrete.server");
    const { supabase, userId } = context;

    assertRecipient(data.to);
    assertBoxes(data.products);

    // A etiqueta usa exatamente as mesmas caixas da cotação (um volume por caixa),
    // evitando diferença entre o valor cotado e o cobrado.
    const volumes = data.products.map((p) => ({
      height: Math.max(1, p.heightCm),
      width: Math.max(1, p.widthCm),
      length: Math.max(1, p.lengthCm),
      weight: Math.max(0.01, p.weightKg),
    }));

    const payload = {
      from: addressToApi(data.from),
      to: addressToApi(data.to),
      service: Number(data.service),
      products: data.products.map((p) => ({
        name: p.name,
        quantity: p.quantity,
        unitary_value: Number(p.unitaryValue.toFixed(2)),
      })),
      volumes: volumes.length === 1 ? volumes[0] : volumes,

      options: {
        insurance_value: Number(data.insuranceValue.toFixed(2)),
        // Sem esta flag, transportadoras privadas (Jadlog/Loggi) emitem a
        // etiqueta sem o seguro cotado. Mantém a etiqueta igual à cotação.
        use_insurance_value: data.insuranceValue > 0,
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
      // Valor real cobrado pela SuperFrete (pode diferir da cotação).
      const rawPrice = raw["price"] ?? raw["total"] ?? raw["value"];
      const priceCents = rawPrice === undefined || rawPrice === null ? null : toCents(rawPrice);
      // Seguro confirmado pela SuperFrete na etiqueta criada.
      const rawInsurance = raw["insurance_value"];
      const insuredValue =
        rawInsurance === undefined || rawInsurance === null ? null : num(rawInsurance);


      if (data.shipmentId) {
        await supabase
          .from("shipments")
          .update({
            superfrete_order_id: orderId || null,
            superfrete_status: status,
            status: internal,
            ...(priceCents && priceCents > 0 ? { price_cents: priceCents } : {}),
            payload_cart: sanitizeForLog(payload) as never,
            response_cart: sanitizeForLog(raw) as never,
            confirmed_at: new Date().toISOString(),
          })
          .eq("id", data.shipmentId);
      }

      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "etiqueta_criada",
        newStatus: internal,
        message: `Pedido ${orderId} criado na SuperFrete${
          data.insuranceValue > 0
            ? ` · seguro solicitado R$ ${data.insuranceValue.toFixed(2)}${
                insuredValue != null ? ` · confirmado R$ ${insuredValue.toFixed(2)}` : ""
              }`
            : " · sem seguro"
        }`,
        payload,
        response: raw,
      });

      return {
        orderId,
        status,
        internalStatus: internal,
        priceCents,
        insuredValue,
        payloadCartJson: JSON.stringify(sanitizeForLog(payload) ?? null),
        responseCartJson: JSON.stringify(sanitizeForLog(raw) ?? null),
      };


    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "erro_criar_etiqueta",
        message,
        payload,
        response: e instanceof SuperfreteError ? e.body : null,
      });
      throw friendlyError(e);
    }
  });

export interface SuperfreteBalance {
  balanceCents: number | null;
  environment: string;
  fetchedAt: string;
  error: string | null;
}

/** Saldo da carteira SuperFrete (somente leitura). */
export const getSuperfreteBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SuperfreteBalance> => {
    const { fetchSuperfreteBalanceCents, getSuperfreteConfig } = await import(
      "@/lib/superfrete.server"
    );
    let environment = "production";
    try {
      environment = getSuperfreteConfig().environment;
    } catch {
      return {
        balanceCents: null,
        environment,
        fetchedAt: new Date().toISOString(),
        error: "Integração da SuperFrete não configurada.",
      };
    }
    try {
      const balanceCents = await fetchSuperfreteBalanceCents();
      return { balanceCents, environment, fetchedAt: new Date().toISOString(), error: null };
    } catch (e) {
      return {
        balanceCents: null,
        environment,
        fetchedAt: new Date().toISOString(),
        error: friendlyError(e).message,
      };
    }
  });

/** Liberação/pagamento da etiqueta — POST /checkout (produção ou sandbox). */
export const checkoutSuperfreteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ shipmentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { superfreteRequest, SuperfreteError, getSuperfreteConfig, fetchSuperfreteBalanceCents } =
      await import("@/lib/superfrete.server");
    const { supabase, userId } = context;
    let environment = "production";
    try {
      environment = getSuperfreteConfig().environment;
    } catch {
      /* token ausente é tratado abaixo pela chamada */
    }

    const { data: row } = await supabase
      .from("shipments")
      .select("id, superfrete_order_id, status, price_cents")
      .eq("id", data.shipmentId)
      .maybeSingle();
    const orderId = (row as Record<string, unknown> | null)?.["superfrete_order_id"] as
      | string
      | undefined;
    if (!orderId) throw new Error("Este envio ainda não tem etiqueta criada na SuperFrete.");

    const payload = { orders: [orderId] };
    const previousStatus = (row as Record<string, unknown> | null)?.["status"] as string | null;
    const priceCents = Number((row as Record<string, unknown> | null)?.["price_cents"] ?? 0) || 0;

    // Confere o saldo antes de chamar a API: evita erro genérico e informa o valor exato.
    let balanceBefore: number | null = null;
    try {
      balanceBefore = await fetchSuperfreteBalanceCents();
    } catch {
      balanceBefore = null;
    }
    if (balanceBefore !== null && priceCents > 0 && balanceBefore < priceCents) {
      const missing = ((priceCents - balanceBefore) / 100).toFixed(2).replace(".", ",");
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "saldo_insuficiente",
        previousStatus,
        newStatus: previousStatus,
        message: `Saldo insuficiente na carteira SuperFrete (${environment}): saldo ${balanceBefore} centavos, etiqueta ${priceCents} centavos`,
        payload,
      });
      throw new Error(
        `Saldo insuficiente na carteira SuperFrete — faltam R$ ${missing} para pagar esta etiqueta.`,
      );
    }
    try {
      const raw = await superfreteRequest<Record<string, unknown>>("/checkout", {
        method: "POST",
        body: payload,
      });

      // A SuperFrete pode aceitar a chamada e ainda devolver a etiqueta pendente
      // (pagamento não concluído). Nesse caso não marcamos como liberada.
      const orders = Array.isArray((raw as Record<string, unknown>)?.["orders"])
        ? ((raw as Record<string, unknown>)["orders"] as Array<Record<string, unknown>>)
        : [];
      const remoteStatus = String(
        orders[0]?.["status"] ?? (raw as Record<string, unknown>)?.["status"] ?? "released",
      ).toLowerCase();
      const isPending = /pending|pendente|waiting|aguard|process/.test(remoteStatus);

      if (isPending) {
        const internalPending = "Etiqueta aguardando liberação (pagamento pendente)";
        await supabase
          .from("shipments")
          .update({ status: internalPending, superfrete_status: remoteStatus })
          .eq("id", data.shipmentId);
        await logEvent(supabase as never, userId, {
          shipmentId: data.shipmentId,
          action: "etiqueta_pendente",
          previousStatus,
          newStatus: internalPending,
          message: `Checkout aceito mas etiqueta ${orderId} segue pendente na SuperFrete (${environment}); status remoto: ${remoteStatus}`,
          payload,
          response: raw,
        });
        return {
          internalStatus: internalPending,
          pending: true,
          remoteStatus,
          balanceCents: balanceBefore,
          priceCents,
        };
      }

      const internal = "Etiqueta liberada / aguardando postagem";
      await supabase
        .from("shipments")
        .update({
          status: internal,
          superfrete_status: remoteStatus || "released",
          released_at: new Date().toISOString(),
        })
        .eq("id", data.shipmentId);

      let balanceAfter: number | null = null;
      try {
        balanceAfter = await fetchSuperfreteBalanceCents();
      } catch {
        balanceAfter = null;
      }
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "etiqueta_paga",
        previousStatus,
        newStatus: internal,
        message: `Etiqueta ${orderId} paga com saldo da carteira (${environment}). Saldo antes: ${
          balanceBefore ?? "—"
        } centavos; depois: ${balanceAfter ?? "—"} centavos.`,
        payload,
        response: raw,
      });
      return {
        internalStatus: internal,
        pending: false,
        remoteStatus,
        balanceCents: balanceAfter,
        priceCents,
      };
    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      const status = e instanceof SuperfreteError ? e.status : 0;
      try {
        await supabase
          .from("shipments")
          .update({ superfrete_status: "checkout_failed" })
          .eq("id", data.shipmentId);
      } catch {
        /* status remoto é informativo; a falha já é registrada no log */
      }
      await logEvent(supabase as never, userId, {
        shipmentId: data.shipmentId,
        action: "erro_liberar_etiqueta",
        previousStatus,
        newStatus: previousStatus,
        message: `Falha ao liberar etiqueta ${orderId} (${environment}, HTTP ${status}): ${message}`,
        payload,
        response: e instanceof SuperfreteError ? e.body : null,
      });
      throw friendlyError(e);
    }
  });

export interface SuperfreteBatchCheckoutResult {
  paid: string[];
  pending: string[];
  failed: Array<{ shipmentId: string; reason: string }>;
  balanceCents: number | null;
  totalPaidCents: number;
}

/** Pagamento em lote das etiquetas com o saldo da carteira — POST /checkout. */
export const checkoutSuperfreteOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ shipmentIds: z.array(z.string().uuid()).min(1).max(30) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<SuperfreteBatchCheckoutResult> => {
    const { superfreteRequest, SuperfreteError, getSuperfreteConfig, fetchSuperfreteBalanceCents } =
      await import("@/lib/superfrete.server");
    const { supabase, userId } = context;
    let environment = "production";
    try {
      environment = getSuperfreteConfig().environment;
    } catch {
      /* tratado pela chamada */
    }

    const { data: rows } = await supabase
      .from("shipments")
      .select("id, superfrete_order_id, status, price_cents")
      .in("id", data.shipmentIds);

    const list = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      shipmentId: String(r["id"]),
      orderId: (r["superfrete_order_id"] as string | null) ?? null,
      status: (r["status"] as string | null) ?? null,
      priceCents: Number(r["price_cents"] ?? 0) || 0,
    }));

    const failed: Array<{ shipmentId: string; reason: string }> = [];
    const payable = list.filter((r) => {
      if (!r.orderId) {
        failed.push({ shipmentId: r.shipmentId, reason: "Envio sem etiqueta criada." });
        return false;
      }
      return true;
    });
    if (payable.length === 0) {
      return { paid: [], pending: [], failed, balanceCents: null, totalPaidCents: 0 };
    }

    const total = payable.reduce((acc, r) => acc + r.priceCents, 0);
    let balanceBefore: number | null = null;
    try {
      balanceBefore = await fetchSuperfreteBalanceCents();
    } catch {
      balanceBefore = null;
    }
    if (balanceBefore !== null && total > 0 && balanceBefore < total) {
      const missing = ((total - balanceBefore) / 100).toFixed(2).replace(".", ",");
      throw new Error(
        `Saldo insuficiente na carteira SuperFrete — faltam R$ ${missing} para pagar as ${payable.length} etiqueta(s) selecionada(s).`,
      );
    }

    const payload = { orders: payable.map((r) => r.orderId as string) };
    let raw: Record<string, unknown>;
    try {
      raw = await superfreteRequest<Record<string, unknown>>("/checkout", {
        method: "POST",
        body: payload,
      });
    } catch (e) {
      const message = e instanceof SuperfreteError ? e.message : String(e);
      for (const r of payable) {
        await logEvent(supabase as never, userId, {
          shipmentId: r.shipmentId,
          action: "erro_liberar_etiqueta",
          previousStatus: r.status,
          newStatus: r.status,
          message: `Falha no pagamento em lote (${environment}): ${message}`,
          payload,
          response: e instanceof SuperfreteError ? e.body : null,
        });
      }
      throw friendlyError(e);
    }

    const orders = Array.isArray(raw?.["orders"])
      ? (raw["orders"] as Array<Record<string, unknown>>)
      : [];
    const statusByOrder = new Map<string, string>();
    for (const o of orders) {
      const id = String(o["id"] ?? o["order_id"] ?? "");
      if (id) statusByOrder.set(id, String(o["status"] ?? "released").toLowerCase());
    }

    const paid: string[] = [];
    const pending: string[] = [];
    let totalPaidCents = 0;

    for (const r of payable) {
      const remoteStatus =
        statusByOrder.get(r.orderId as string) ??
        String(raw?.["status"] ?? "released").toLowerCase();
      const isPending = /pending|pendente|waiting|aguard|process/.test(remoteStatus);
      const internal = isPending
        ? "Etiqueta aguardando liberação (pagamento pendente)"
        : "Etiqueta liberada / aguardando postagem";
      await supabase
        .from("shipments")
        .update({
          status: internal,
          superfrete_status: remoteStatus,
          ...(isPending ? {} : { released_at: new Date().toISOString() }),
        })
        .eq("id", r.shipmentId);
      await logEvent(supabase as never, userId, {
        shipmentId: r.shipmentId,
        action: isPending ? "etiqueta_pendente" : "etiqueta_paga",
        previousStatus: r.status,
        newStatus: internal,
        message: isPending
          ? `Etiqueta ${r.orderId} segue pendente após pagamento em lote (${environment}).`
          : `Etiqueta ${r.orderId} paga com saldo em lote (${environment}). Saldo antes: ${
              balanceBefore ?? "—"
            } centavos.`,
        payload,
        response: raw,
      });
      if (isPending) pending.push(r.shipmentId);
      else {
        paid.push(r.shipmentId);
        totalPaidCents += r.priceCents;
      }
    }

    let balanceAfter: number | null = null;
    try {
      balanceAfter = await fetchSuperfreteBalanceCents();
    } catch {
      balanceAfter = null;
    }

    return { paid, pending, failed, balanceCents: balanceAfter, totalPaidCents };
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
      throw friendlyError(e);
    }
  });
