import { supabase } from "@/integrations/supabase/client";
import type {
  Client,
  Product,
  ImportHistoryEntry,
  SystemPreferences,
  OperationalRules,
  SecuritySettings,
  MGMVAgreement,
  MGMVInstallment,
  FinancialStatus,
  Situation,
  ImportSource,
  ImportStatus,
} from "./store";

// ============= Row <-> State mappers =============

import type { Json } from "@/integrations/supabase/types";

export interface DbClientRow {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  folder: string | null;
  mgmv: Json;
  client_type?: string;
}

export interface DbProductRow {
  id: string;
  client_id: string;
  name: string;
  platform: string;
  total_value: number;
  paid_value: number;
  financial_status: string;
  situation: string;
  register_date: string;
  due_date: string;
  notes: string | null;
}

export interface DbImportHistoryRow {
  id: string;
  date: string;
  source: string;
  file: string;
  clients_created: number;
  products_added: number;
  errors: number;
  status: string;
  file_hash: string | null;
  agreements_created: number | null;
  agreements_replaced: number | null;
  skipped_duplicates: number | null;
  duration_ms: number | null;
}

export function rowToClient(r: DbClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    notes: r.notes ?? undefined,
    folder: r.folder ?? undefined,
    mgmv: (r.mgmv as MGMVAgreement | null) ?? undefined,
    clientType: r.client_type === "mgmv" ? "mgmv" : "common",
  };
}

export function clientToRow(c: Client): DbClientRow {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    notes: c.notes ?? null,
    folder: c.folder ?? null,
    mgmv: (c.mgmv as unknown as Json) ?? null,
    client_type: c.clientType ?? (c.mgmv ? "mgmv" : "common"),
  };
}

export function rowToProduct(r: DbProductRow): Product {
  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    platform: r.platform ?? "",
    totalValue: Number(r.total_value) || 0,
    paidValue: Number(r.paid_value) || 0,
    financialStatus: r.financial_status as FinancialStatus,
    situation: r.situation as Situation,
    registerDate: r.register_date,
    dueDate: r.due_date,
    notes: r.notes ?? undefined,
  };
}

export function productToRow(p: Product): DbProductRow {
  return {
    id: p.id,
    client_id: p.clientId,
    name: p.name,
    platform: p.platform ?? "",
    total_value: p.totalValue,
    paid_value: p.paidValue,
    financial_status: p.financialStatus,
    situation: p.situation,
    register_date: p.registerDate,
    due_date: p.dueDate,
    notes: p.notes ?? null,
  };
}

export function rowToHistory(r: DbImportHistoryRow): ImportHistoryEntry {
  return {
    id: r.id,
    date: r.date,
    source: r.source as ImportSource,
    file: r.file,
    clientsCreated: r.clients_created,
    productsAdded: r.products_added,
    errors: r.errors,
    status: r.status as ImportStatus,
    fileHash: r.file_hash ?? undefined,
    agreementsCreated: r.agreements_created ?? undefined,
    agreementsReplaced: r.agreements_replaced ?? undefined,
    skippedDuplicates: r.skipped_duplicates ?? undefined,
    durationMs: r.duration_ms ?? undefined,
  };
}

export function historyToRow(h: ImportHistoryEntry): DbImportHistoryRow {
  return {
    id: h.id,
    date: h.date,
    source: h.source,
    file: h.file,
    clients_created: h.clientsCreated,
    products_added: h.productsAdded,
    errors: h.errors,
    status: h.status,
    file_hash: h.fileHash ?? null,
    agreements_created: h.agreementsCreated ?? null,
    agreements_replaced: h.agreementsReplaced ?? null,
    skipped_duplicates: h.skippedDuplicates ?? null,
    duration_ms: h.durationMs ?? null,
  };
}

// ============= Error helper =============

function logErr(scope: string, err: unknown) {
  // Errors are logged but never thrown — the UI uses optimistic local state.
  // eslint-disable-next-line no-console
  console.error(`[db-sync:${scope}]`, err);
}

// ============= Loaders =============

/**
 * Paginação genérica para contornar o teto padrão de 1000 linhas do PostgREST.
 * Lê em páginas de `pageSize` (default 1000) até receber uma página menor.
 * Exportado para testes.
 */
export type FetchAllPage<T> = { data: T[] | null; error: unknown };
export async function fetchAllRows<T = Record<string, unknown>>(
  table: "clients" | "products" | "mgmv_agreements" | "mgmv_installments",
  columns = "*",
  pageSize = 1000,
): Promise<FetchAllPage<T>> {
  const out: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (res.error) return { data: null, error: res.error };
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { data: out, error: null };
}

export interface DbSnapshot {
  clients: Client[];
  products: Product[];
  importHistory: ImportHistoryEntry[];
  preferences: Partial<SystemPreferences>;
  rules: Partial<OperationalRules>;
  security: Partial<SecuritySettings>;
  uiState: Record<string, unknown>;
}

export async function loadSnapshot(): Promise<DbSnapshot> {
  const [clientsRes, productsRes, historyRes, settingsRes, agreementsRes, installmentsRes] = await Promise.all([
    fetchAllRows<Record<string, unknown>>("clients", "*"),
    fetchAllRows<Record<string, unknown>>("products", "*"),
    supabase.from("import_history").select("*").order("date", { ascending: false }).limit(200),
    supabase.from("app_settings").select("*").eq("id", "default").maybeSingle(),
    fetchAllRows<Record<string, unknown>>("mgmv_agreements", "*"),
    fetchAllRows<Record<string, unknown>>("mgmv_installments", "*"),
  ]);
  if (clientsRes.error) logErr("loadClients", clientsRes.error);
  if (productsRes.error) logErr("loadProducts", productsRes.error);
  if (historyRes.error) logErr("loadHistory", historyRes.error);
  if (settingsRes.error) logErr("loadSettings", settingsRes.error);
  if (agreementsRes.error) logErr("loadAgreements", agreementsRes.error);
  if (installmentsRes.error) logErr("loadInstallments", installmentsRes.error);

  const settings = settingsRes.data;

  // Reconstrói cada acordo MGMV a partir das tabelas oficiais
  // (mgmv_agreements + mgmv_installments). Esta é a ÚNICA fonte de verdade
  // do MGMV — o jsonb legado em clients.mgmv é ignorado se não houver
  // registro relacional correspondente.
  const installmentsByAgreement = new Map<string, MGMVInstallment[]>();
  for (const row of (installmentsRes.data ?? []) as Array<{
    agreement_id: string;
    installment_number: number;
    amount: number | string | null;
    due_date: string | null;
    paid_at: string | null;
    status: string;
  }>) {
    const list = installmentsByAgreement.get(row.agreement_id) ?? [];
    list.push({
      number: row.installment_number,
      total: 0, // preenchido depois
      value: Number(row.amount ?? 0) || 0,
      dueDate: row.due_date ?? new Date().toISOString(),
      paid: row.status === "Paga" || !!row.paid_at,
      paidAt: row.paid_at ?? undefined,
    });
    installmentsByAgreement.set(row.agreement_id, list);
  }
  const agreementsByClient = new Map<string, MGMVAgreement>();
  for (const row of (agreementsRes.data ?? []) as Array<{
    id: string;
    client_id: string;
    total_agreement_value: number | string | null;
    installments_count: number | null;
    created_at: string;
    review_status?: string | null;
    ai_reviewed?: boolean | null;
    ai_review_applied_at?: string | null;
    ai_confidence?: number | string | null;
    ai_review_raw_result?: unknown;
  }>) {
    const ins = (installmentsByAgreement.get(row.id) ?? []).sort(
      (a, b) => a.number - b.number,
    );
    const total = ins.length;
    for (const i of ins) i.total = total;
    const rs = (row.review_status ?? "none") as MGMVAgreement["reviewStatus"];
    agreementsByClient.set(row.client_id, {
      startDate: row.created_at ?? new Date().toISOString(),
      totalDebt: Number(row.total_agreement_value ?? 0) || 0,
      installments: ins,
      reviewStatus: rs,
      aiReviewed: !!row.ai_reviewed,
      aiReviewAppliedAt: row.ai_review_applied_at ?? undefined,
      aiConfidence:
        row.ai_confidence == null ? undefined : Number(row.ai_confidence) || 0,
      aiReviewRawResult: row.ai_review_raw_result ?? undefined,
    });
  }

  const clients = (clientsRes.data ?? []).map((r: Record<string, unknown>) => {
    const c = rowToClient(r as unknown as DbClientRow);
    const official = agreementsByClient.get(c.id);
    // Fonte oficial: tabela relacional. Sem registro relacional → sem mgmv.
    return { ...c, mgmv: official };
  });

  return {
    clients,
    products: (productsRes.data ?? []).map((r: Record<string, unknown>) =>
      rowToProduct(r as unknown as DbProductRow),
    ),
    importHistory: (historyRes.data ?? []).map((r: Record<string, unknown>) =>
      rowToHistory(r as unknown as DbImportHistoryRow),
    ),
    preferences: (settings?.preferences as Partial<SystemPreferences>) ?? {},
    rules: (settings?.rules as Partial<OperationalRules>) ?? {},
    security: (settings?.security as Partial<SecuritySettings>) ?? {},
    uiState: (settings?.ui_state as Record<string, unknown>) ?? {},
  };
}

// ============= Writers (background) =============

export function dbUpsertClient(c: Client): void {
  void supabase.from("clients").upsert(clientToRow(c)).then(({ error }) => {
    if (error) logErr("upsertClient", error);
  });
}

export function dbUpsertProduct(p: Product): void {
  void supabase.from("products").upsert(productToRow(p)).then(({ error }) => {
    if (error) logErr("upsertProduct", error);
  });
}

// ----- Coalesced (debounced) upserts -----
// Em importações/edições em lote, várias mutações no mesmo produto/cliente
// disparam um upsert individual para cada chamada. A fila abaixo agrupa as
// últimas versões por id e envia em lotes, reduzindo pressão no backend
// sem perder consistência (sempre vence o estado mais recente).
const pendingProductUpserts = new Map<string, Product>();
const pendingClientUpserts = new Map<string, Client>();
let productFlushTimer: ReturnType<typeof setTimeout> | null = null;
let clientFlushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 250;

function scheduleProductFlush() {
  if (productFlushTimer) return;
  productFlushTimer = setTimeout(() => {
    productFlushTimer = null;
    void flushPendingProductUpserts();
  }, FLUSH_DELAY_MS);
}

function scheduleClientFlush() {
  if (clientFlushTimer) return;
  clientFlushTimer = setTimeout(() => {
    clientFlushTimer = null;
    void flushPendingClientUpserts();
  }, FLUSH_DELAY_MS);
}

export function queueProductUpsert(p: Product): void {
  pendingProductUpserts.set(p.id, p);
  scheduleProductFlush();
}

export function queueClientUpsert(c: Client): void {
  pendingClientUpserts.set(c.id, c);
  scheduleClientFlush();
}

export async function flushPendingProductUpserts(): Promise<void> {
  if (pendingProductUpserts.size === 0) return;
  const batch = Array.from(pendingProductUpserts.values());
  pendingProductUpserts.clear();
  await dbUpsertProductsAsync(batch);
}

export async function flushPendingClientUpserts(): Promise<void> {
  if (pendingClientUpserts.size === 0) return;
  const batch = Array.from(pendingClientUpserts.values());
  pendingClientUpserts.clear();
  await dbUpsertClientsAsync(batch);
}

export async function flushAllPendingUpserts(): Promise<void> {
  if (productFlushTimer) {
    clearTimeout(productFlushTimer);
    productFlushTimer = null;
  }
  if (clientFlushTimer) {
    clearTimeout(clientFlushTimer);
    clientFlushTimer = null;
  }
  await Promise.all([flushPendingProductUpserts(), flushPendingClientUpserts()]);
}

if (typeof window !== "undefined") {
  // Garante que mutações pendentes sejam empurradas antes do unload.
  window.addEventListener("beforeunload", () => {
    void flushAllPendingUpserts();
  });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAllPendingUpserts();
  });
}

export function dbInsertHistory(h: ImportHistoryEntry): void {
  void supabase.from("import_history").upsert(historyToRow(h)).then(({ error }) => {
    if (error) logErr("insertHistory", error);
  });
}

export async function dbUpsertHistoryAsync(h: ImportHistoryEntry): Promise<void> {
  const { error } = await supabase.from("import_history").upsert(historyToRow(h));
  if (error) logErr("upsertHistoryAsync", error);
}

export async function dbUpsertClientsAsync(clients: Client[]): Promise<void> {
  if (clients.length === 0) return;
  const rows = clients.map((c) => clientToRow(c));
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("clients").upsert(rows.slice(i, i + CHUNK));
    if (error) logErr("upsertClientsAsync", error);
  }
}

export async function dbUpsertProductsAsync(products: Product[]): Promise<void> {
  if (products.length === 0) return;
  const rows = products.map((p) => productToRow(p));
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("products").upsert(rows.slice(i, i + CHUNK));
    if (error) logErr("upsertProductsAsync", error);
  }
}

export function dbDeleteHistoryAll(): void {
  void supabase
    .from("import_history")
    .delete()
    .gte("date", "1900-01-01")
    .then(({ error }) => {
      if (error) logErr("deleteHistoryAll", error);
    });
}

export async function dbDeleteHistoryAllAsync(): Promise<void> {
  const { error } = await supabase.from("import_history").delete().gte("date", "1900-01-01");
  if (error) logErr("deleteHistoryAllAsync", error);
}

export function dbDeleteAllClients(): void {
  void supabase
    .from("clients")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllClients", error);
    });
}

export async function dbDeleteAllClientsAsync(): Promise<void> {
  const { error } = await supabase.from("clients").delete().not("id", "is", null);
  if (error) logErr("deleteAllClientsAsync", error);
}

export function dbDeleteAllProducts(): void {
  void supabase
    .from("products")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllProducts", error);
    });
}

export async function dbDeleteAllProductsAsync(): Promise<void> {
  const { error } = await supabase.from("products").delete().not("id", "is", null);
  if (error) logErr("deleteAllProductsAsync", error);
}

/** Apaga acordos MGMV (parcelas caem em cascata via FK). */
export function dbDeleteAllMGMV(): void {
  void supabase
    .from("mgmv_installments")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllMGMVInstallments", error);
    });
  void supabase
    .from("mgmv_agreements")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllMGMVAgreements", error);
    });
}

export async function dbDeleteAllMGMVAsync(): Promise<void> {
  const installments = await supabase.from("mgmv_installments").delete().not("id", "is", null);
  if (installments.error) logErr("deleteAllMGMVInstallmentsAsync", installments.error);
  const agreements = await supabase.from("mgmv_agreements").delete().not("id", "is", null);
  if (agreements.error) logErr("deleteAllMGMVAgreementsAsync", agreements.error);
}

/** Apaga progresso de importação interrompida do usuário atual. */
export function dbDeleteAllImportProgress(): void {
  void (async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const { error } = await supabase
        .from("import_progress")
        .delete()
        .eq("user_id", uid);
      if (error) logErr("deleteAllImportProgress", error);
    } catch (err) {
      logErr("deleteAllImportProgress", err);
    }
  })();
}

export async function dbDeleteAllImportProgressAsync(): Promise<void> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return;
    const { error } = await supabase.from("import_progress").delete().eq("user_id", uid);
    if (error) logErr("deleteAllImportProgressAsync", error);
  } catch (err) {
    logErr("deleteAllImportProgressAsync", err);
  }
}

// ============= Client merge (deduplicação) =============

/** Reatribui produtos de uma lista de clientes para um cliente primário. */
export async function dbReassignProductsClientAsync(
  fromIds: string[],
  toId: string,
): Promise<void> {
  if (fromIds.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < fromIds.length; i += CHUNK) {
    const slice = fromIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("products")
      .update({ client_id: toId })
      .in("client_id", slice);
    if (error) logErr("reassignProductsClient", error);
  }
}

/** Move um acordo MGMV (id é igual ao client_id antigo) para o cliente primário. */
export async function dbReassignAgreementClientAsync(
  fromId: string,
  toId: string,
): Promise<void> {
  // Atualiza FK e o próprio id do acordo para manter a convenção 1:1 com o cliente.
  const { error } = await supabase
    .from("mgmv_agreements")
    .update({ id: toId, client_id: toId })
    .eq("client_id", fromId);
  if (error) logErr("reassignAgreementClient", error);
}

/** Apaga clientes pelos ids informados. */
export async function dbDeleteClientsByIdsAsync(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("clients").delete().in("id", slice);
    if (error) logErr("deleteClientsByIds", error);
  }
}

// ============= MGMV relational sync =============

/**
 * Sincroniza o acordo MGMV oficial de UM cliente nas tabelas
 * `mgmv_agreements` + `mgmv_installments`, e atualiza as flags MGMV
 * dos produtos vinculados. Esta é a fonte oficial — sem registro aqui,
 * o sistema NÃO mostra MGMV oficial em nenhuma tela.
 *
 * Convenção: o id do acordo é IGUAL ao id do cliente (relação 1:1).
 */
export async function dbSyncAgreementForClientAsync(client: Client): Promise<void> {
  const agreementId = client.id;

  if (!client.mgmv || client.mgmv.installments.length === 0) {
    // Sem acordo → remove agreement (cascata apaga parcelas) e zera flags.
    const del = await supabase.from("mgmv_agreements").delete().eq("id", agreementId);
    if (del.error) logErr("syncAgreement.delete", del.error);
    const resetFlags = await supabase
      .from("products")
      .update({
        included_in_mgmv: false,
        mgmv_agreement_id: null,
        collection_eligible: true,
      })
      .eq("client_id", client.id);
    if (resetFlags.error) logErr("syncAgreement.resetFlags", resetFlags.error);
    return;
  }

  const ins = client.mgmv.installments;
  const sorted = [...ins].sort((a, b) => a.number - b.number);
  const paidCount = sorted.filter((i) => i.paid).length;
  const installmentValue = sorted[0]?.value ?? 0;
  const paidValue = sorted.filter((i) => i.paid).reduce((s, i) => s + (i.value || 0), 0);
  const remainingValue = Math.max(0, (client.mgmv.totalDebt || 0) - paidValue);
  const nextUnpaid = sorted.find((i) => !i.paid);
  const firstDue = sorted[0]?.dueDate ?? null;

  // Validação matemática para o flag needs_review.
  const sumByInstallments = sorted.reduce((s, i) => s + (i.value || 0), 0);
  const needsReview =
    client.mgmv.totalDebt > 0 &&
    Math.abs(sumByInstallments - client.mgmv.totalDebt) > 0.01;

  const status = paidCount >= sorted.length ? "Quitado" : needsReview ? "Revisão necessária" : "Ativo";

  // Status de revisão (SEPARADO do status financeiro acima).
  // Preserva ai_reviewed/manually_reviewed quando já marcados; senão deriva
  // de needsReview (divergência matemática) ou cai em 'none'.
  const preservedReview =
    client.mgmv.reviewStatus === "ai_reviewed" ||
    client.mgmv.reviewStatus === "manually_reviewed"
      ? client.mgmv.reviewStatus
      : null;
  const reviewStatus: NonNullable<MGMVAgreement["reviewStatus"]> =
    preservedReview ?? (needsReview ? "review_required" : "none");

  const upAgreement = await supabase.from("mgmv_agreements").upsert({
    id: agreementId,
    client_id: client.id,
    client_name: client.name,
    client_phone: client.phone ?? "",
    total_agreement_value: client.mgmv.totalDebt,
    installments_count: sorted.length,
    installment_value: installmentValue,
    paid_installments: paidCount,
    pending_installments: sorted.length - paidCount,
    first_due_date: firstDue,
    next_due_date: nextUnpaid?.dueDate ?? null,
    paid_value: paidValue,
    remaining_value: remainingValue,
    status,
    needs_review: needsReview,
    review_status: reviewStatus,
    ai_reviewed: !!client.mgmv.aiReviewed,
    ai_review_applied_at: client.mgmv.aiReviewAppliedAt ?? null,
    ai_confidence: client.mgmv.aiConfidence ?? null,
    ai_review_raw_result: (client.mgmv.aiReviewRawResult ?? null) as never,
    source_folder: client.folder ?? null,
    original_notes: client.notes ?? null,
  } as never);
  if (upAgreement.error) {
    logErr("syncAgreement.upsert", upAgreement.error);
    return;
  }

  // Substitui parcelas (estratégia simples: delete + insert em lotes).
  // Acordos podem ter dezenas/centenas de parcelas — envia em lotes para
  // não estourar o payload do PostgREST e manter o sync resiliente.
  const delIns = await supabase.from("mgmv_installments").delete().eq("agreement_id", agreementId);
  if (delIns.error) logErr("syncAgreement.delInstallments", delIns.error);
  if (sorted.length > 0) {
    const rows = sorted.map((i) => ({
      agreement_id: agreementId,
      installment_number: i.number,
      amount: i.value,
      due_date: i.dueDate,
      paid_at: i.paid ? (i.paidAt ?? new Date().toISOString()) : null,
      status: i.paid ? "Paga" : "Pendente",
    }));
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const insIns = await supabase
        .from("mgmv_installments")
        .insert(rows.slice(i, i + CHUNK) as never);
      if (insIns.error) logErr("syncAgreement.insertInstallments", insIns.error);
    }
  }

  // Atualiza flags dos produtos do cliente: produtos com financialStatus
  // = 'MGMV' viram parte do acordo; demais saem do acordo.
  const mgmvProducts = await supabase
    .from("products")
    .update({
      included_in_mgmv: true,
      mgmv_agreement_id: agreementId,
      collection_eligible: false,
    })
    .eq("client_id", client.id)
    .eq("financial_status", "MGMV");
  if (mgmvProducts.error) logErr("syncAgreement.mgmvProducts", mgmvProducts.error);

  const nonMgmvProducts = await supabase
    .from("products")
    .update({
      included_in_mgmv: false,
      mgmv_agreement_id: null,
      collection_eligible: true,
    })
    .eq("client_id", client.id)
    .neq("financial_status", "MGMV");
  if (nonMgmvProducts.error) logErr("syncAgreement.nonMgmvProducts", nonMgmvProducts.error);
}

/** Fire-and-forget wrapper para chamadas de UI. */
export function dbSyncAgreementForClient(client: Client): void {
  void dbSyncAgreementForClientAsync(client);
}

/** Sincroniza acordos de vários clientes (usado pós-importação). */
export async function dbSyncAgreementsBulkAsync(clients: Client[]): Promise<void> {
  for (const c of clients) {
    // Sequencial para preservar ordem de logs e evitar bursts de RLS.
    // O volume aqui é pequeno (clientes MGMV de UM ZIP).
    // eslint-disable-next-line no-await-in-loop
    await dbSyncAgreementForClientAsync(c);
  }
}

// ============= Diagnostics =============

export interface ImportDiagnostics {
  clientsCount: number;
  productsCount: number;
  agreementsCount: number;
  installmentsCount: number;
  /** Clientes marcados como MGMV mas sem registro em mgmv_agreements. */
  mgmvClientsWithoutAgreement: number;
  /** Produtos com included_in_mgmv = true mas sem mgmv_agreement_id. */
  mgmvProductsWithoutAgreementId: number;
  /** Linhas em import_progress (importações interrompidas) para o usuário. */
  importProgressRows: number;
  /** Última versão de reset registrada localmente. */
  resetVersion: string;
}

// ============= Audit log =============

/**
 * Registra no audit_log a aplicação de uma revisão por IA sobre um acordo MGMV.
 * Não bloqueia o fluxo do usuário em caso de falha — apenas loga e segue.
 */
export async function dbInsertMgmvReviewAuditLog(input: {
  clientId: string;
  agreementId: string;
  previousReviewStatus: string;
  newReviewStatus: string;
  previousAgreement?: MGMVAgreement;
  newAgreement: MGMVAgreement;
  confidence: number;
  confirmedWithConflict: boolean;
  mathOk: boolean;
}): Promise<void> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id ?? null;
    const userEmail = userRes.user?.email ?? null;
    const old = input.previousAgreement
      ? {
          totalDebt: input.previousAgreement.totalDebt,
          installments: input.previousAgreement.installments,
          reviewStatus: input.previousAgreement.reviewStatus ?? "review_required",
          aiReviewed: !!input.previousAgreement.aiReviewed,
          aiConfidence: input.previousAgreement.aiConfidence ?? null,
        }
      : null;
    const next = {
      totalDebt: input.newAgreement.totalDebt,
      installments: input.newAgreement.installments,
      reviewStatus: input.newAgreement.reviewStatus,
      aiReviewed: !!input.newAgreement.aiReviewed,
      aiReviewAppliedAt: input.newAgreement.aiReviewAppliedAt ?? null,
      aiConfidence: input.newAgreement.aiConfidence ?? null,
      confidence: input.confidence,
      confirmedWithConflict: input.confirmedWithConflict,
      mathOk: input.mathOk,
      previousReviewStatus: input.previousReviewStatus,
      newReviewStatus: input.newReviewStatus,
      event: "Revisão IA aplicada ao acordo MGMV",
      clientId: input.clientId,
    };
    const { error } = await supabase.from("audit_log").insert({
      table_name: "mgmv_agreements",
      action: "ai_review_applied",
      row_id: input.agreementId,
      user_id: uid,
      user_email: userEmail,
      old_data: old as never,
      new_data: next as never,
    } as never);
    if (error) logErr("audit_log.aiReview", error);
  } catch (err) {
    logErr("audit_log.aiReview", err);
  }
}

export async function dbFetchDiagnostics(): Promise<ImportDiagnostics> {
  const head = (q: ReturnType<typeof supabase.from>) =>
    (q.select("*", { count: "exact", head: true }) as unknown as Promise<{ count: number | null; error: unknown }>);

  const [c, p, a, i, mc, mp] = await Promise.all([
    head(supabase.from("clients")),
    head(supabase.from("products")),
    head(supabase.from("mgmv_agreements")),
    head(supabase.from("mgmv_installments")),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("client_type", "mgmv"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("included_in_mgmv", true)
      .is("mgmv_agreement_id", null),
  ]);

  // Inconsistência: clientes MGMV sem agreement correspondente.
  // Como o id do agreement = id do client, podemos contar via diff.
  let mgmvClientsWithoutAgreement = 0;
  try {
    const [mgmvClients, allAgreements] = await Promise.all([
      supabase.from("clients").select("id").eq("client_type", "mgmv"),
      supabase.from("mgmv_agreements").select("client_id"),
    ]);
    const setA = new Set(((allAgreements.data ?? []) as Array<{ client_id: string }>).map((r) => r.client_id));
    mgmvClientsWithoutAgreement = ((mgmvClients.data ?? []) as Array<{ id: string }>).filter(
      (r) => !setA.has(r.id),
    ).length;
  } catch (err) {
    logErr("diagnostics.mgmvWithoutAgreement", err);
  }

  let importProgressRows = 0;
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (uid) {
      const r = await supabase
        .from("import_progress")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid);
      importProgressRows = r.count ?? 0;
    }
  } catch (err) {
    logErr("diagnostics.importProgress", err);
  }

  return {
    clientsCount: c.count ?? 0,
    productsCount: p.count ?? 0,
    agreementsCount: a.count ?? 0,
    installmentsCount: i.count ?? 0,
    mgmvClientsWithoutAgreement: mgmvClientsWithoutAgreement || (mc.count ?? 0) - (a.count ?? 0),
    mgmvProductsWithoutAgreementId: mp.count ?? 0,
    importProgressRows,
    resetVersion: getUiValue<string>("import.resetVersion", ""),
  };
}

/**
 * Limpa o estado runtime de importação no navegador (cache, preview, lote
 * pendente, importação interrompida). Não toca no banco.
 */
export function clearImportRuntimeState(): void {
  if (typeof window === "undefined") return;
  const PREFIXES = [
    "star-games-store",
    "import.",
    "import-",
    "currentImportId",
    "lastImportPreview",
    "lastZipName",
    "processedFiles",
    "importProgress",
    "interruptedImport",
    "pendingImportBatches",
    "commonClientsPreview",
    "mgmvClientsPreview",
  ];
  try {
    const ls = window.localStorage;
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k) continue;
      if (PREFIXES.some((p) => k === p || k.startsWith(p))) toRemove.push(k);
    }
    for (const k of toRemove) ls.removeItem(k);
  } catch {
    /* ignore */
  }
  try {
    const ss = window.sessionStorage;
    const toRemove: string[] = [];
    for (let i = 0; i < ss.length; i++) {
      const k = ss.key(i);
      if (!k) continue;
      if (PREFIXES.some((p) => k === p || k.startsWith(p))) toRemove.push(k);
    }
    for (const k of toRemove) ss.removeItem(k);
  } catch {
    /* ignore */
  }
  try {
    const toRemove = Array.from(uiCache.keys()).filter((k) =>
      PREFIXES.some((p) => k === p || k.startsWith(p)),
    );
    for (const k of toRemove) {
      uiCache.delete(k);
      const subs = uiSubs.get(k);
      if (subs) for (const fn of subs) fn();
    }
  } catch {
    /* ignore */
  }
}

export function dbSaveSettings(patch: {
  preferences?: SystemPreferences;
  rules?: OperationalRules;
  security?: SecuritySettings;
  uiState?: Record<string, unknown>;
}): void {
  const update: Record<string, unknown> = { id: "default" };
  if (patch.preferences !== undefined) update.preferences = patch.preferences;
  if (patch.rules !== undefined) update.rules = patch.rules;
  if (patch.security !== undefined) update.security = patch.security;
  if (patch.uiState !== undefined) update.ui_state = patch.uiState;
  void supabase.from("app_settings").upsert(update as never).then(({ error }) => {
    if (error) logErr("saveSettings", error);
  });
}

// ============= One-time migration from localStorage =============

const STORE_KEY = "star-games-store";
const MIGRATION_FLAG = "__migratedFromLocalStorage_v1";

function collectLegacyUiState(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof window === "undefined") return out;
  const PREFIXES = ["collection.", "clientes."];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k) continue;
    if (!PREFIXES.some((p) => k.startsWith(p))) continue;
    try {
      const raw = window.localStorage.getItem(k);
      if (raw == null) continue;
      out[k] = JSON.parse(raw);
    } catch {
      // skip bad entries
    }
  }
  return out;
}

/**
 * Migrates only harmless legacy UI preferences into the DB.
 * Domain data no longer comes from browser storage, because reset/import must
 * always reflect the current backend state and never an old preview cache.
 *
 * Only runs once: writes a sentinel into `app_settings.ui_state` so future
 * boots skip it.
 */
export async function migrateLocalStorageOnce(snapshot: DbSnapshot): Promise<DbSnapshot> {
  if (typeof window === "undefined") return snapshot;
  if ((snapshot.uiState as Record<string, unknown>)?.[MIGRATION_FLAG]) return snapshot;

  const legacyUi = collectLegacyUiState();

  const mergedUiState: Record<string, unknown> = {
    ...legacyUi,
    ...snapshot.uiState,
    [MIGRATION_FLAG]: true,
  };

  const settingsPatch: Record<string, unknown> = {
    id: "default",
    ui_state: mergedUiState,
  };
  const { error: settingsErr } = await supabase
    .from("app_settings")
    .upsert(settingsPatch as never);
  if (settingsErr) logErr("migrate.settings", settingsErr);

  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }

  return { ...snapshot, uiState: mergedUiState };
}

// ============= UI state (per-key) =============

/** In-memory cache + subscribers for ui_state values. */
const uiCache = new Map<string, unknown>();
const uiSubs = new Map<string, Set<() => void>>();
let uiLoaded = false;
const uiLoadWaiters: Array<() => void> = [];

export function primeUiState(values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) uiCache.set(k, v);
  uiLoaded = true;
  for (const fn of uiLoadWaiters.splice(0)) fn();
  // notify all subscribers
  for (const subs of uiSubs.values()) for (const fn of subs) fn();
}

export function isUiLoaded() {
  return uiLoaded;
}

export function whenUiLoaded(cb: () => void) {
  if (uiLoaded) cb();
  else uiLoadWaiters.push(cb);
}

export function getUiValue<T>(key: string, fallback: T): T {
  const v = uiCache.get(key);
  return (v === undefined ? fallback : (v as T));
}

export function subscribeUi(key: string, cb: () => void): () => void {
  let set = uiSubs.get(key);
  if (!set) {
    set = new Set();
    uiSubs.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const snapshot: Record<string, unknown> = {};
    for (const [k, v] of uiCache.entries()) snapshot[k] = v;
    void supabase
      .from("app_settings")
      .upsert({ id: "default", ui_state: snapshot } as never)
      .then(({ error }) => {
        if (error) logErr("ui_state.flush", error);
      });
  }, 400);
}

export async function flushUiStateNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const snapshot: Record<string, unknown> = {};
  for (const [k, v] of uiCache.entries()) snapshot[k] = v;
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: "default", ui_state: snapshot } as never);
  if (error) logErr("ui_state.flushNow", error);
}

export function setUiValue(key: string, value: unknown) {
  uiCache.set(key, value);
  const subs = uiSubs.get(key);
  if (subs) for (const fn of subs) fn();
  scheduleFlush();
}