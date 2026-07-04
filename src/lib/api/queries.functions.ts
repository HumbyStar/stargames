import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// Lote 0 — Server-side queries paginadas (base para migração progressiva).
//
// Convenções:
// - Todo fetcher retorna { rows, total, page, pageSize } — DTOs planos.
// - Paginação via `range(from, to)` + `count: 'exact'`.
// - Busca textual usa `ilike` em colunas indexadas (pg_trgm em name/phone/product name).
// - Filtros vazios ou `all`/`any` são ignorados.
// - RLS aplicado via `requireSupabaseAuth` (respeita o mesmo usuário logado).
// ============================================================================

export type SortDir = "asc" | "desc";

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

function clampPage(page: unknown): number {
  const n = Number(page);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}
function clampPageSize(pageSize: unknown, fallback = 25, max = 200): number {
  const n = Number(pageSize);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
function sanitizeSearch(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, 120);
}
function escapeIlike(s: string): string {
  // PostgREST `ilike` uses `%` as wildcard. Escape literal % and _ from user input.
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// ============================================================================
// listClients — resumo do cliente (sem produtos).
// ============================================================================

export interface ClientListRow {
  id: string;
  name: string;
  phone: string;
  folder: string | null;
  clientType: string;
  createdAt: string;
}

export interface ListClientsInput {
  page?: number;
  pageSize?: number;
  search?: string;
  clientType?: "common" | "mgmv" | "all";
  folder?: string;
  sortBy?: "name" | "created_at" | "updated_at";
  sortDir?: SortDir;
}

export const listClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListClientsInput) => data ?? {})
  .handler(async ({ data, context }): Promise<Paginated<ClientListRow>> => {
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const search = sanitizeSearch(data.search);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = context.supabase
      .from("clients")
      .select("id,name,phone,folder,client_type,created_at", { count: "exact" });

    if (data.clientType && data.clientType !== "all") {
      q = q.eq("client_type", data.clientType);
    }
    if (data.folder) {
      q = q.eq("folder", data.folder);
    }
    if (search) {
      const pat = `%${escapeIlike(search)}%`;
      q = q.or(`name.ilike.${pat},phone.ilike.${pat}`);
    }

    const sortBy = data.sortBy ?? "name";
    const sortDir = data.sortDir ?? "asc";
    q = q.order(sortBy, { ascending: sortDir === "asc" }).range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(`listClients: ${error.message}`);

    return {
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? "",
        folder: r.folder ?? null,
        clientType: r.client_type ?? "common",
        createdAt: r.created_at,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

// ============================================================================
// listProducts — paginado, filtros server-side.
// ============================================================================

export interface ProductListRow {
  id: string;
  clientId: string;
  clientName: string | null;
  name: string;
  platform: string;
  totalValue: number;
  paidValue: number;
  financialStatus: string;
  situation: string;
  registerDate: string;
  dueDate: string;
  includedInMgmv: boolean;
  collectionEligible: boolean;
}

export interface ListProductsInput {
  page?: number;
  pageSize?: number;
  search?: string;
  clientId?: string;
  financialStatus?: string | string[];
  situation?: string | string[];
  platform?: string;
  includedInMgmv?: boolean;
  collectionEligible?: boolean;
  overdueOnly?: boolean;
  sortBy?: "name" | "due_date" | "register_date" | "total_value" | "paid_value";
  sortDir?: SortDir;
}

export const listProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListProductsInput) => data ?? {})
  .handler(async ({ data, context }): Promise<Paginated<ProductListRow>> => {
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const search = sanitizeSearch(data.search);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = context.supabase
      .from("products")
      .select(
        "id,client_id,name,platform,total_value,paid_value,financial_status,situation,register_date,due_date,included_in_mgmv,collection_eligible,clients(name)",
        { count: "exact" },
      );

    if (data.clientId) q = q.eq("client_id", data.clientId);
    if (data.platform) q = q.eq("platform", data.platform);
    if (typeof data.includedInMgmv === "boolean")
      q = q.eq("included_in_mgmv", data.includedInMgmv);
    if (typeof data.collectionEligible === "boolean")
      q = q.eq("collection_eligible", data.collectionEligible);

    if (data.financialStatus) {
      const arr = Array.isArray(data.financialStatus)
        ? data.financialStatus
        : [data.financialStatus];
      if (arr.length === 1) q = q.eq("financial_status", arr[0]);
      else q = q.in("financial_status", arr);
    }
    if (data.situation) {
      const arr = Array.isArray(data.situation) ? data.situation : [data.situation];
      if (arr.length === 1) q = q.eq("situation", arr[0]);
      else q = q.in("situation", arr);
    }
    if (data.overdueOnly) {
      q = q.lt("due_date", new Date().toISOString());
    }
    if (search) {
      const pat = `%${escapeIlike(search)}%`;
      q = q.ilike("name", pat);
    }

    const sortBy = data.sortBy ?? "due_date";
    const sortDir = data.sortDir ?? "asc";
    q = q.order(sortBy, { ascending: sortDir === "asc" }).range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(`listProducts: ${error.message}`);

    return {
      rows: (rows ?? []).map((r) => {
        const clientRel = (r as unknown as { clients?: { name?: string } }).clients;
        return {
          id: r.id,
          clientId: r.client_id,
          clientName: clientRel?.name ?? null,
          name: r.name,
          platform: r.platform ?? "",
          totalValue: Number(r.total_value) || 0,
          paidValue: Number(r.paid_value) || 0,
          financialStatus: r.financial_status,
          situation: r.situation,
          registerDate: r.register_date,
          dueDate: r.due_date,
          includedInMgmv: !!r.included_in_mgmv,
          collectionEligible: !!r.collection_eligible,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

// ============================================================================
// listCollection — só itens elegíveis a cobrança + vencidos.
// Espelha `shouldAppearInCollection` no SQL.
// ============================================================================

export interface ListCollectionInput {
  page?: number;
  pageSize?: number;
  search?: string;
  financialStatus?: "Reserva" | "Pendente" | "all";
  sortBy?: "due_date" | "name" | "total_value";
  sortDir?: SortDir;
}

export const listCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListCollectionInput) => data ?? {})
  .handler(async ({ data, context }): Promise<Paginated<ProductListRow>> => {
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const search = sanitizeSearch(data.search);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = context.supabase
      .from("products")
      .select(
        "id,client_id,name,platform,total_value,paid_value,financial_status,situation,register_date,due_date,included_in_mgmv,collection_eligible,clients(name,phone)",
        { count: "exact" },
      )
      // Cobrança individual: só Reserva/Pendente em aberto, vencidos, não-MGMV.
      .in("financial_status", ["Reserva", "Pendente"])
      .eq("situation", "Em Aberto")
      .eq("included_in_mgmv", false)
      .lt("due_date", new Date().toISOString());

    if (data.financialStatus && data.financialStatus !== "all") {
      q = q.eq("financial_status", data.financialStatus);
    }
    if (search) {
      const pat = `%${escapeIlike(search)}%`;
      q = q.ilike("name", pat);
    }

    const sortBy = data.sortBy ?? "due_date";
    const sortDir = data.sortDir ?? "asc";
    q = q.order(sortBy, { ascending: sortDir === "asc" }).range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(`listCollection: ${error.message}`);

    return {
      rows: (rows ?? []).map((r) => {
        const clientRel = (r as unknown as { clients?: { name?: string } }).clients;
        return {
          id: r.id,
          clientId: r.client_id,
          clientName: clientRel?.name ?? null,
          name: r.name,
          platform: r.platform ?? "",
          totalValue: Number(r.total_value) || 0,
          paidValue: Number(r.paid_value) || 0,
          financialStatus: r.financial_status,
          situation: r.situation,
          registerDate: r.register_date,
          dueDate: r.due_date,
          includedInMgmv: !!r.included_in_mgmv,
          collectionEligible: !!r.collection_eligible,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

// ============================================================================
// listMgmvAgreements — paginado; parcelas carregam sob demanda.
// ============================================================================

export interface MgmvAgreementRow {
  id: string;
  clientId: string;
  clientName: string | null;
  clientPhone: string | null;
  totalAgreementValue: number;
  installmentsCount: number;
  paidInstallments: number;
  pendingInstallments: number;
  paidValue: number;
  remainingValue: number;
  nextDueDate: string | null;
  status: string;
  createdAt: string;
}

export interface ListMgmvAgreementsInput {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string | "all";
  overdueOnly?: boolean;
  sortBy?: "next_due_date" | "created_at" | "total_agreement_value" | "remaining_value";
  sortDir?: SortDir;
}

export const listMgmvAgreements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListMgmvAgreementsInput) => data ?? {})
  .handler(async ({ data, context }): Promise<Paginated<MgmvAgreementRow>> => {
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const search = sanitizeSearch(data.search);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = context.supabase
      .from("mgmv_agreements")
      .select(
        "id,client_id,client_name,client_phone,total_agreement_value,installments_count,paid_installments,pending_installments,paid_value,remaining_value,next_due_date,status,created_at",
        { count: "exact" },
      );

    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.overdueOnly) q = q.lt("next_due_date", new Date().toISOString());
    if (search) {
      const pat = `%${escapeIlike(search)}%`;
      q = q.or(`client_name.ilike.${pat},client_phone.ilike.${pat}`);
    }

    const sortBy = data.sortBy ?? "next_due_date";
    const sortDir = data.sortDir ?? "asc";
    q = q
      .order(sortBy, { ascending: sortDir === "asc", nullsFirst: false })
      .range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(`listMgmvAgreements: ${error.message}`);

    return {
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        clientId: r.client_id,
        clientName: r.client_name ?? null,
        clientPhone: r.client_phone ?? null,
        totalAgreementValue: Number(r.total_agreement_value) || 0,
        installmentsCount: r.installments_count ?? 0,
        paidInstallments: r.paid_installments ?? 0,
        pendingInstallments: r.pending_installments ?? 0,
        paidValue: Number(r.paid_value) || 0,
        remainingValue: Number(r.remaining_value) || 0,
        nextDueDate: r.next_due_date ?? null,
        status: r.status,
        createdAt: r.created_at,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

// ============================================================================
// listMgmvInstallments — parcelas de UM acordo (sob demanda ao expandir).
// ============================================================================

export interface MgmvInstallmentRow {
  id: string;
  agreementId: string;
  number: number;
  amount: number;
  paidAmount: number | null;
  dueDate: string;
  paidAt: string | null;
  status: string;
}

export const listMgmvInstallments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { agreementId: string }) => {
    if (!data?.agreementId || typeof data.agreementId !== "string")
      throw new Error("agreementId obrigatório");
    return data;
  })
  .handler(async ({ data, context }): Promise<MgmvInstallmentRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("mgmv_installments")
      .select("id,agreement_id,installment_number,amount,paid_amount,due_date,paid_at,status")
      .eq("agreement_id", data.agreementId)
      .order("installment_number", { ascending: true });
    if (error) throw new Error(`listMgmvInstallments: ${error.message}`);
    return (rows ?? []).map((r) => ({
      id: r.id,
      agreementId: r.agreement_id,
      number: r.installment_number,
      amount: Number(r.amount) || 0,
      paidAmount: r.paid_amount == null ? null : Number(r.paid_amount) || 0,
      dueDate: r.due_date ?? "",
      paidAt: r.paid_at ?? null,
      status: r.status,
    }));
  });

// ============================================================================
// getDashboardAggregates — SOMENTE contadores. Não retorna linhas.
// ============================================================================

export interface DashboardAggregates {
  totalClients: number;
  totalProducts: number;
  reservasAtivas: number;
  reservasVencidas: number;
  pendencias: number;
  pendenciasVencidas: number;
  pagosAgEnvio: number;
  enviados: number;
  desistencias: number;
  abandonos: number;
  retirar: number;
  retirados: number;
  removidos: number;
  clientesMGMV: number;
  mgmvVencidas: number;
  cobrancaAtiva: number; // itens elegíveis a cobrança individual (vencidos)
}

// (helper `countRows` removido — as contagens do dashboard usam chamadas
// diretas `supabase.from(...).select('id', { count: 'exact', head: true })`).

export const getDashboardAggregates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardAggregates> => {
    const { supabase } = context;
    const nowIso = new Date().toISOString();

    // Rodamos todas as contagens em paralelo. Cada chamada é `head:true`,
    // então o Postgres retorna apenas o count.
    const [
      totalClients,
      totalProducts,
      reservasAtivas,
      reservasVencidas,
      pendencias,
      pendenciasVencidas,
      pagosAgEnvio,
      enviados,
      desistencias,
      abandonos,
      retirar,
      retirados,
      removidos,
      clientesMGMV,
      mgmvVencidas,
      cobrancaAtiva,
    ] = await Promise.all([
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("financial_status", "Reserva")
        .eq("situation", "Em Aberto"),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("financial_status", "Reserva")
        .eq("situation", "Em Aberto")
        .lt("due_date", nowIso),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("financial_status", "Pendente")
        .eq("situation", "Em Aberto"),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("financial_status", "Pendente")
        .eq("situation", "Em Aberto")
        .lt("due_date", nowIso),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("financial_status", "Pago")
        .eq("situation", "Em Aberto"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("situation", "Enviado"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("situation", "Desistiu"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("situation", "Abandonou"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("situation", "Retirar"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("situation", "Retirado"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("situation", "Removido"),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("client_type", "mgmv"),
      supabase
        .from("mgmv_installments")
        .select("id", { count: "exact", head: true })
        .neq("status", "Paga")
        .lt("due_date", nowIso),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .in("financial_status", ["Reserva", "Pendente"])
        .eq("situation", "Em Aberto")
        .eq("included_in_mgmv", false)
        .lt("due_date", nowIso),
    ]);

    const c = (r: { count: number | null; error: unknown }) => {
      if (r.error) throw new Error(String((r.error as { message?: string })?.message ?? r.error));
      return r.count ?? 0;
    };

    return {
      totalClients: c(totalClients),
      totalProducts: c(totalProducts),
      reservasAtivas: c(reservasAtivas),
      reservasVencidas: c(reservasVencidas),
      pendencias: c(pendencias),
      pendenciasVencidas: c(pendenciasVencidas),
      pagosAgEnvio: c(pagosAgEnvio),
      enviados: c(enviados),
      desistencias: c(desistencias),
      abandonos: c(abandonos),
      retirar: c(retirar),
      retirados: c(retirados),
      removidos: c(removidos),
      clientesMGMV: c(clientesMGMV),
      mgmvVencidas: c(mgmvVencidas),
      cobrancaAtiva: c(cobrancaAtiva),
    };
  });

// ============================================================================
// getClientDetail — cliente + agregados + primeira página de produtos.
// ============================================================================

export interface ClientDetail {
  client: {
    id: string;
    name: string;
    phone: string;
    notes: string | null;
    folder: string | null;
    clientType: string;
  };
  aggregates: {
    totalProducts: number;
    totalPurchased: number;
    totalPaid: number;
    totalOpen: number;
    reservas: number;
    pagoAgEnvio: number;
    pendencias: number;
    enviados: number;
  };
  products: Paginated<ProductListRow>;
}

export const getClientDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId: string; page?: number; pageSize?: number }) => {
    if (!data?.clientId) throw new Error("clientId obrigatório");
    return data;
  })
  .handler(async ({ data, context }): Promise<ClientDetail> => {
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize, 50, 200);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const [clientRes, productsRes] = await Promise.all([
      context.supabase
        .from("clients")
        .select("id,name,phone,notes,folder,client_type")
        .eq("id", data.clientId)
        .maybeSingle(),
      context.supabase
        .from("products")
        .select(
          "id,client_id,name,platform,total_value,paid_value,financial_status,situation,register_date,due_date,included_in_mgmv,collection_eligible",
          { count: "exact" },
        )
        .eq("client_id", data.clientId)
        .order("due_date", { ascending: true })
        .range(from, to),
    ]);

    if (clientRes.error) throw new Error(`getClientDetail:client: ${clientRes.error.message}`);
    if (!clientRes.data) throw new Error("Cliente não encontrado");
    if (productsRes.error) throw new Error(`getClientDetail:products: ${productsRes.error.message}`);

    const rows = productsRes.data ?? [];
    let totalPurchased = 0;
    let totalPaid = 0;
    let reservas = 0;
    let pagoAgEnvio = 0;
    let pendencias = 0;
    let enviados = 0;
    // Agregados usando TODA a coleção do cliente (sem paginação) — chamada leve.
    const { data: allRows, error: allErr } = await context.supabase
      .from("products")
      .select("total_value,paid_value,financial_status,situation")
      .eq("client_id", data.clientId);
    if (allErr) throw new Error(`getClientDetail:aggregates: ${allErr.message}`);
    for (const r of allRows ?? []) {
      totalPurchased += Number(r.total_value) || 0;
      totalPaid += Number(r.paid_value) || 0;
      if (r.financial_status === "Reserva" && r.situation === "Em Aberto") reservas++;
      if (r.financial_status === "Pago" && r.situation === "Em Aberto") pagoAgEnvio++;
      if (r.financial_status === "Pendente" && r.situation === "Em Aberto") pendencias++;
      if (r.situation === "Enviado") enviados++;
    }

    return {
      client: {
        id: clientRes.data.id,
        name: clientRes.data.name,
        phone: clientRes.data.phone ?? "",
        notes: clientRes.data.notes ?? null,
        folder: clientRes.data.folder ?? null,
        clientType: clientRes.data.client_type ?? "common",
      },
      aggregates: {
        totalProducts: allRows?.length ?? 0,
        totalPurchased,
        totalPaid,
        totalOpen: totalPurchased - totalPaid,
        reservas,
        pagoAgEnvio,
        pendencias,
        enviados,
      },
      products: {
        rows: rows.map((r) => ({
          id: r.id,
          clientId: r.client_id,
          clientName: null,
          name: r.name,
          platform: r.platform ?? "",
          totalValue: Number(r.total_value) || 0,
          paidValue: Number(r.paid_value) || 0,
          financialStatus: r.financial_status,
          situation: r.situation,
          registerDate: r.register_date,
          dueDate: r.due_date,
          includedInMgmv: !!r.included_in_mgmv,
          collectionEligible: !!r.collection_eligible,
        })),
        total: productsRes.count ?? 0,
        page,
        pageSize,
      },
    };
  });