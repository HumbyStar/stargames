import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fichaFromTextWithDefaults } from "@/lib/ficha-parse";
import type { MetaLead, MetaLeadFicha } from "@/lib/meta-export-format";

/**
 * Extração de leads para campanhas no Meta Business.
 *
 * Uma única chamada devolve a base agregada (cliente + métricas de produtos +
 * ficha já parseada). Os filtros são aplicados no navegador, o que evita
 * dezenas de consultas ao banco a cada ajuste de filtro.
 */

const PAGE = 1000;

async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function emptyFicha(): MetaLeadFicha {
  return {
    fullName: "",
    cpfCnpj: "",
    email: "",
    phone: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  };
}

export const fetchMetaLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ leads: MetaLead[]; generatedAt: string }> => {
    const supabase = context.supabase;

    const [{ data: isAdmin }, { data: isMaster }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: context.userId, _role: "admin_master" }),
    ]);
    if (!isAdmin && !isMaster) {
      throw new Error("Acesso restrito: apenas admin e admin master podem extrair dados Meta.");
    }

    type ClientRow = {
      id: string;
      name: string | null;
      phone: string | null;
      client_type: string | null;
      customer_data: string | null;
      folder: string | null;
      created_at: string;
    };
    type ProductRow = {
      client_id: string;
      total_value: number | null;
      paid_value: number | null;
      financial_status: string | null;
      situation: string | null;
      platform: string | null;
      register_date: string | null;
    };

    const clients = await pageAll<ClientRow>((from, to) =>
      supabase
        .from("clients")
        .select("id,name,phone,client_type,customer_data,folder,created_at")
        .order("created_at", { ascending: true })
        .range(from, to),
    );

    const products = await pageAll<ProductRow>((from, to) =>
      supabase
        .from("products")
        .select("client_id,total_value,paid_value,financial_status,situation,platform,register_date")
        .order("client_id", { ascending: true })
        .range(from, to),
    );

    const shipments = await pageAll<{ client_id: string }>((from, to) =>
      supabase.from("shipments").select("client_id").range(from, to),
    );

    const agreements = await pageAll<{ client_id: string; status: string | null }>((from, to) =>
      supabase.from("mgmv_agreements").select("client_id,status").range(from, to),
    );

    const shipped = new Set(shipments.map((s) => s.client_id));
    const mgmvStatus = new Map<string, string>();
    for (const a of agreements) {
      const cur = mgmvStatus.get(a.client_id);
      const next = a.status ?? "";
      // "Ativo" prevalece sobre "Quitado"
      if (!cur || next === "Ativo") mgmvStatus.set(a.client_id, next);
    }

    interface Agg {
      count: number;
      total: number;
      paid: number;
      platforms: Set<string>;
      situations: Set<string>;
      financial: Set<string>;
      first: string | null;
      last: string | null;
    }
    const agg = new Map<string, Agg>();
    for (const p of products) {
      let a = agg.get(p.client_id);
      if (!a) {
        a = {
          count: 0,
          total: 0,
          paid: 0,
          platforms: new Set(),
          situations: new Set(),
          financial: new Set(),
          first: null,
          last: null,
        };
        agg.set(p.client_id, a);
      }
      a.count += 1;
      a.total += Number(p.total_value ?? 0);
      a.paid += Number(p.paid_value ?? 0);
      if (p.platform) a.platforms.add(p.platform);
      if (p.situation) a.situations.add(p.situation);
      if (p.financial_status) a.financial.add(p.financial_status);
      const d = p.register_date;
      if (d) {
        if (!a.first || d < a.first) a.first = d;
        if (!a.last || d > a.last) a.last = d;
      }
    }

    const leads: MetaLead[] = clients.map((c) => {
      const a = agg.get(c.id);
      const parsed = fichaFromTextWithDefaults(c.customer_data, { phone: c.phone ?? "" });
      const ficha: MetaLeadFicha = { ...emptyFicha() };
      for (const key of Object.keys(ficha) as (keyof MetaLeadFicha)[]) {
        const v = parsed[key];
        ficha[key] = typeof v === "string" ? v : "";
      }
      const total = a ? a.total : 0;
      const paid = a ? a.paid : 0;
      const count = a ? a.count : 0;
      return {
        id: c.id,
        name: c.name ?? "",
        phone: c.phone ?? "",
        clientType: c.client_type === "mgmv" ? "mgmv" : "common",
        createdAt: c.created_at,
        folder: c.folder ?? "",
        productCount: count,
        totalValue: Math.round(total * 100) / 100,
        paidValue: Math.round(paid * 100) / 100,
        openValue: Math.round(Math.max(total - paid, 0) * 100) / 100,
        avgTicket: count ? Math.round((total / count) * 100) / 100 : 0,
        firstPurchase: a?.first ?? null,
        lastPurchase: a?.last ?? null,
        platforms: a ? Array.from(a.platforms).sort() : [],
        situations: a ? Array.from(a.situations).sort() : [],
        financialStatuses: a ? Array.from(a.financial).sort() : [],
        hasShipment: shipped.has(c.id),
        mgmvStatus: mgmvStatus.get(c.id) ?? "",
        ficha,
      };
    });

    return { leads, generatedAt: new Date().toISOString() };
  });

const LogInput = z.object({
  format: z.string().min(1).max(40),
  rows: z.number().int().min(0),
  hashed: z.boolean(),
  includeIncomplete: z.boolean(),
  filters: z.string().max(2000),
});

/** Registra no log de auditoria quem exportou dados sensíveis e com quais filtros. */
export const logMetaExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LogInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const claimsEmail = (context.claims as { email?: string } | null)?.email ?? null;
    await supabaseAdmin.from("audit_log").insert({
      table_name: "meta_export",
      action: "INSERT",
      row_id: null,
      user_id: context.userId,
      user_email: claimsEmail,
      new_data: {
        format: data.format,
        rows: data.rows,
        hashed: data.hashed,
        includeIncomplete: data.includeIncomplete,
        filters: data.filters,
      },
    });
    return { ok: true };
  });
