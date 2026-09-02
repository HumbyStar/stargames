import { supabase } from "@/integrations/supabase/client";
import { isLocalMode } from "./local-mode";
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

// ============= Usuário atual (cache leve) =============

let currentUser: { id?: string; email?: string } = {};

/** Identidade do usuário logado, usada para carimbar o histórico de importações. */
export function getCurrentUserInfo(): { id?: string; email?: string } {
  return currentUser;
}

if (typeof window !== "undefined") {
  void supabase.auth.getUser().then(({ data }) => {
    if (data.user) currentUser = { id: data.user.id, email: data.user.email ?? undefined };
  });
  supabase.auth.onAuthStateChange((_e, session) => {
    currentUser = session?.user
      ? { id: session.user.id, email: session.user.email ?? undefined }
      : {};
  });
}

export interface DbClientRow {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  customer_data?: string | null;
  folder: string | null;
  mgmv: Json;
  client_type?: string;
  original_html_file_name?: string | null;
  original_html_storage_path?: string | null;
  original_html_imported_at?: string | null;
  original_html_source_folder?: string | null;
  original_html_checksum?: string | null;
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
  updated_at?: string;
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
  user_id?: string | null;
  user_email?: string | null;
  raw_content?: string | null;
}

export function rowToClient(r: DbClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    notes: r.notes ?? undefined,
    customerData: r.customer_data ?? undefined,
    folder: r.folder ?? undefined,
    mgmv: (r.mgmv as MGMVAgreement | null) ?? undefined,
    clientType: r.client_type === "mgmv" ? "mgmv" : "common",
    originalHtmlFileName: r.original_html_file_name ?? undefined,
    originalHtmlStoragePath: r.original_html_storage_path ?? undefined,
    originalHtmlImportedAt: r.original_html_imported_at ?? undefined,
    originalHtmlSourceFolder: r.original_html_source_folder ?? undefined,
    originalHtmlChecksum: r.original_html_checksum ?? undefined,
  };
}

export function clientToRow(c: Client): DbClientRow {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    notes: c.notes ?? null,
    customer_data: c.customerData ?? null,
    folder: c.folder ?? null,
    mgmv: (c.mgmv as unknown as Json) ?? null,
    client_type: c.clientType ?? (c.mgmv ? "mgmv" : "common"),
    original_html_file_name: c.originalHtmlFileName ?? null,
    original_html_storage_path: c.originalHtmlStoragePath ?? null,
    original_html_imported_at: c.originalHtmlImportedAt ?? null,
    original_html_source_folder: c.originalHtmlSourceFolder ?? null,
    original_html_checksum: c.originalHtmlChecksum ?? null,
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
    updatedAt: r.updated_at ?? undefined,
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
    userId: r.user_id ?? undefined,
    userEmail: r.user_email ?? undefined,
    rawContent: r.raw_content ?? undefined,
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
    user_id: h.userId ?? getCurrentUserInfo().id ?? null,
    user_email: h.userEmail ?? getCurrentUserInfo().email ?? null,
    raw_content: h.rawContent ?? null,
  };
}

// ============= Error helper =============

function logErr(scope: string, err: unknown) {
  // Errors are logged but never thrown — the UI uses optimistic local state.
  // eslint-disable-next-line no-console
  console.error(`[db-sync:${scope}]`, err);
}

// ============= Mutações locais recentes (anti-sobrescrita) =============
//
// Escritas saem em lote/debounce e as releituras completas são paginadas,
// então um snapshot iniciado antes da gravação pode voltar com o estado
// antigo e desfazer na tela o que o usuário acabou de fazer (item importado
// some, produto excluído reaparece). O registro abaixo guarda por alguns
// segundos o que foi criado/alterado/excluído localmente e é usado para
// reconciliar qualquer snapshot vindo do banco.

export type MutationKind = "client" | "product";
type MutationOp = "upsert" | "delete";

/** Janela de proteção: tempo suficiente para o banco confirmar a gravação. */
const MUTATION_TTL_MS = 15_000;

const recentMutations = new Map<string, { op: MutationOp; at: number }>();

function mutationKey(kind: MutationKind, id: string) {
  return `${kind}:${id}`;
}

function pruneMutations(now = Date.now()) {
  for (const [key, entry] of recentMutations) {
    if (now - entry.at > MUTATION_TTL_MS) recentMutations.delete(key);
  }
}

export function markLocalMutation(kind: MutationKind, ids: string[], op: MutationOp): void {
  const at = Date.now();
  pruneMutations(at);
  for (const id of ids) recentMutations.set(mutationKey(kind, id), { op, at });
}

/** Libera a proteção assim que o banco confirmou o mesmo estado. */
export function clearLocalMutation(kind: MutationKind, ids: string[]): void {
  for (const id of ids) recentMutations.delete(mutationKey(kind, id));
}

export function clearAllLocalMutations(): void {
  recentMutations.clear();
}

function mutationFor(kind: MutationKind, id: string) {
  const entry = recentMutations.get(mutationKey(kind, id));
  if (!entry) return null;
  if (Date.now() - entry.at > MUTATION_TTL_MS) {
    recentMutations.delete(mutationKey(kind, id));
    return null;
  }
  return entry;
}

/**
 * Aplica um snapshot do banco respeitando as mutações locais recentes:
 * - id excluído há pouco nunca ressuscita;
 * - id criado/alterado há pouco e ausente na leitura é preservado.
 */
export function reconcileWithLocalMutations<T extends { id: string }>(
  kind: MutationKind,
  incoming: T[],
  previous: T[],
): T[] {
  pruneMutations();
  if (recentMutations.size === 0) return incoming;
  const incomingIds = new Set(incoming.map((r) => r.id));
  const out = incoming.filter((r) => mutationFor(kind, r.id)?.op !== "delete");
  for (const row of previous) {
    if (incomingIds.has(row.id)) continue;
    if (mutationFor(kind, row.id)?.op === "upsert") out.push(row);
  }
  return out;
}

// ============= Barreira de escrita =============
//
// Nenhuma releitura pode correr na frente das próprias escritas do usuário.

const inFlightWrites = new Set<Promise<unknown>>();

function trackWrite<T>(p: Promise<T>): Promise<T> {
  const tracked = p.finally(() => inFlightWrites.delete(tracked as Promise<unknown>));
  inFlightWrites.add(tracked as Promise<unknown>);
  return tracked;
}

/** Garante que tudo o que já foi disparado chegou ao banco antes de ler. */
export async function awaitPendingWrites(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    // Erros não podem ser engolidos: o fluxo de importação precisa permanecer
    // aberto e informar falha, em vez de anunciar sucesso e exigir reimportação.
    await flushAllPendingUpserts();
    if (inFlightWrites.size === 0) return;
    await Promise.all(Array.from(inFlightWrites));
  }
  if (inFlightWrites.size > 0) {
    throw new Error("Ainda existem gravações pendentes da importação.");
  }
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
  opts?: { env?: AppEnv; owner?: string | null },
): Promise<FetchAllPage<T>> {
  const out: T[] = [];
  let size = pageSize;
  let retries = 0;
  let lastId: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Filtrar por ambiente no banco (em vez de deixar tudo para a RLS) evita
    // varredura da tabela inteira — era o que estourava o tempo limite.
    let q: any = sb().from(table).select(columns);
    if (opts?.env) {
      q = q.eq("env", opts.env);
      if (opts.env === "sandbox" && opts.owner) q = q.eq("sandbox_owner", opts.owner);
    }
    // Paginação por chave: sem ordem estável, o Postgres pode repetir uma
    // linha em duas páginas e pular outra (era o que fazia produto recém
    // criado sumir da tela). Avançar por `id` também mantém o custo de
    // cada página constante.
    q = q.order("id", { ascending: true });
    if (lastId !== null) q = q.gt("id", lastId);
    const res = await q.limit(size);
    if (res.error) {
      const code = (res.error as { code?: string } | null)?.code;
      // Tempo limite: tenta novamente com páginas menores antes de desistir.
      if (code === "57014" && retries < 3 && size > 125) {
        retries += 1;
        size = Math.max(125, Math.floor(size / 2));
        continue;
      }
      return { data: null, error: res.error };
    }
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) break;
    const tail = rows[rows.length - 1] as { id?: string } | undefined;
    if (!tail?.id) break;
    lastId = String(tail.id);
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
  /** Ambiente ao qual estes dados pertencem (produção ou modo teste). */
  env?: AppEnv;
  /** Alguma tabela falhou na leitura: o snapshot está incompleto. */
  partial?: boolean;
  /** `false` quando clientes/produtos não foram lidos (carga sob demanda). */
  dataLoaded?: boolean;
}

export type AppEnv = "producao" | "sandbox";

/**
 * Descobre o ambiente ativo do usuário logado (produção x modo teste).
 * O banco decide a visibilidade por ambiente; aqui só precisamos saber
 * a qual ambiente pertence cada leitura, para não misturar snapshots.
 */
export async function resolveCurrentEnv(): Promise<AppEnv> {
  if (isLocalMode()) return "producao";
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return "producao";
    const { data } = await supabase
      .from("sandbox_state")
      .select("active")
      .eq("user_id", uid)
      .maybeSingle();
    return data?.active ? "sandbox" : "producao";
  } catch {
    return "producao";
  }
}

/**
 * Cliente stub usado no Modo Local: qualquer chamada encadeada resolve vazio,
 * sem tocar na rede. As gravações offline vivem no IndexedDB.
 */
function createOfflineBuilder(): any {
  const result = { data: null, error: null, count: 0, status: 200, statusText: "OK" };
  const target = function () {} as unknown as object;
  const proxy: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (onOk: any, onErr: any) => Promise.resolve(result).then(onOk, onErr);
      if (prop === "catch") return (onErr: any) => Promise.resolve(result).catch(onErr);
      if (prop === "finally") return (cb: any) => Promise.resolve(result).finally(cb);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

const OFFLINE_CLIENT = {
  from: () => createOfflineBuilder(),
  rpc: () => createOfflineBuilder(),
  storage: { from: () => createOfflineBuilder() },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
} as unknown as typeof supabase;

/** Supabase real quando online; stub inofensivo no Modo Local. */
export function sb(): typeof supabase {
  return isLocalMode() ? OFFLINE_CLIENT : supabase;
}

export interface RawSnapshotRows {
  clients: Record<string, unknown>[];
  products: Record<string, unknown>[];
  importHistory: Record<string, unknown>[];
  agreements: Record<string, unknown>[];
  installments: Record<string, unknown>[];
  settings: Record<string, unknown> | null;
}

export interface LoadSnapshotOptions {
  /**
   * Quando `false`, a leitura pesada (clientes, produtos e MGMV) é pulada:
   * o app abre apenas com preferências/regras/UI e histórico de importação.
   * As listas são carregadas sob demanda (ver `ensureDataLoaded` na store).
   */
  withData?: boolean;
}

export async function loadSnapshot(options: LoadSnapshotOptions = {}): Promise<DbSnapshot> {
  const withData = options.withData !== false;
  if (isLocalMode()) {
    const { loadLocalSnapshot } = await import("./local-package");
    const local = await loadLocalSnapshot();
    if (local) return { ...local, env: "producao" };
  }
  const envBefore = await resolveCurrentEnv();
  let owner: string | null = null;
  if (envBefore === "sandbox") {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      owner = userRes.user?.id ?? null;
    } catch {
      owner = null;
    }
  }
  const scope = { env: envBefore, owner };
  const empty = { data: [] as Record<string, unknown>[], error: null as unknown as null };
  const [clientsRes, productsRes, historyRes, settingsRes, agreementsRes, installmentsRes] = await Promise.all([
    withData ? fetchAllRows<Record<string, unknown>>("clients", "*", 1000, scope) : empty,
    withData ? fetchAllRows<Record<string, unknown>>("products", "*", 1000, scope) : empty,
    sb()
      .from("import_history")
      .select("*")
      .eq("env", envBefore)
      .order("date", { ascending: false })
      .limit(200),
    sb().from("app_settings").select("*").eq("id", "default").maybeSingle(),
    withData ? fetchAllRows<Record<string, unknown>>("mgmv_agreements", "*", 1000, scope) : empty,
    withData ? fetchAllRows<Record<string, unknown>>("mgmv_installments", "*", 1000, scope) : empty,
  ]);
  if (clientsRes.error) logErr("loadClients", clientsRes.error);
  if (productsRes.error) logErr("loadProducts", productsRes.error);
  if (historyRes.error) logErr("loadHistory", historyRes.error);
  if (settingsRes.error) logErr("loadSettings", settingsRes.error);
  if (agreementsRes.error) logErr("loadAgreements", agreementsRes.error);
  if (installmentsRes.error) logErr("loadInstallments", installmentsRes.error);

  const envAfter = await resolveCurrentEnv();
  const partial = !!(
    clientsRes.error ||
    productsRes.error ||
    agreementsRes.error ||
    installmentsRes.error
  );

  const snapshot = buildSnapshotFromRows({
    clients: (clientsRes.data ?? []) as Record<string, unknown>[],
    products: (productsRes.data ?? []) as Record<string, unknown>[],
    importHistory: (historyRes.data ?? []) as Record<string, unknown>[],
    agreements: (agreementsRes.data ?? []) as Record<string, unknown>[],
    installments: (installmentsRes.data ?? []) as Record<string, unknown>[],
    settings: (settingsRes.data ?? null) as Record<string, unknown> | null,
  });

  // Se o ambiente mudou no meio da leitura, os dados são de um ambiente
  // que já não é o atual: relê uma única vez para não misturar snapshots.
  if (envBefore !== envAfter) return loadSnapshot(options);
  return { ...snapshot, env: envAfter, partial, dataLoaded: withData };
}

/**
 * Leitura direcionada dos itens de um acordo MGMV. Esta consulta é usada como
 * garantia antes da quitação e evita depender do carregamento da tabela inteira
 * de produtos, que pode ser muito maior.
 */
export async function loadMGMVProductsForClient(clientId: string): Promise<Product[]> {
  const env = await resolveCurrentEnv();
  let query = sb()
    .from("products")
    .select("*")
    .eq("client_id", clientId)
    .eq("financial_status", "MGMV")
    .eq("env", env);

  if (env === "sandbox") {
    const { data: userRes } = await supabase.auth.getUser();
    const owner = userRes.user?.id;
    if (!owner) throw new Error("Usuário do modo teste não identificado.");
    query = query.eq("sandbox_owner", owner);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DbProductRow[]).map(rowToProduct);
}

export interface CompleteMGMVResult {
  ok: boolean;
  movedProducts: number;
  completedAt?: string;
}

/**
 * Releitura direcionada de TODOS os produtos de um cliente. Usada após a
 * quitação do MGMV para refletir na UI exatamente o que o banco gravou
 * (inclusive itens que entraram no acordo ainda como Reserva/Pendente).
 */
export async function loadProductsForClient(clientId: string): Promise<Product[]> {
  const env = await resolveCurrentEnv();
  let query = sb().from("products").select("*").eq("client_id", clientId).eq("env", env);

  if (env === "sandbox") {
    const { data: userRes } = await supabase.auth.getUser();
    const owner = userRes.user?.id;
    if (!owner) throw new Error("Usuário do modo teste não identificado.");
    query = query.eq("sandbox_owner", owner);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DbProductRow[]).map(rowToProduct);
}

/** Conclui o acordo e converte seus produtos em uma única transação no banco. */

/**
 * Verificação de presença: devolve, dentre `ids`, os que existem hoje no banco
 * (no ambiente ativo). Base da confirmação de escrita — nenhum "sucesso" é
 * exibido sem passar por aqui ou pelo evento realtime da linha.
 */
export async function dbRowsExist(kind: MutationKind, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  if (isLocalMode()) return new Set(ids);
  const table = kind === "client" ? "clients" : "products";
  const env = await resolveCurrentEnv();
  let sandboxOwner: string | null = null;
  if (env === "sandbox") {
    const { data: userRes } = await supabase.auth.getUser();
    sandboxOwner = userRes.user?.id ?? null;
    if (!sandboxOwner) throw new Error("Usuário do modo teste não identificado.");
  }
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    let query = sb()
      .from(table)
      .select("id")
      .in("id", ids.slice(i, i + CHUNK))
      .eq("env", env);
    if (sandboxOwner) query = query.eq("sandbox_owner", sandboxOwner);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of (data ?? []) as { id: string }[]) out.add(row.id);
  }
  return out;
}

/** Releitura direcionada de produtos por id (usada após import/edição). */
export async function loadProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const env = await resolveCurrentEnv();
  const out: Product[] = [];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    let query = sb()
      .from("products")
      .select("*")
      .in("id", ids.slice(i, i + CHUNK))
      .eq("env", env);
    if (env === "sandbox") {
      const { data: userRes } = await supabase.auth.getUser();
      const owner = userRes.user?.id;
      if (!owner) throw new Error("Usuário do modo teste não identificado.");
      query = query.eq("sandbox_owner", owner);
    }
    const { data, error } = await query;
    if (error) throw error;
    out.push(...((data ?? []) as DbProductRow[]).map(rowToProduct));
  }
  return out;
}

/** Releitura direcionada de clientes por id (usada após import). */
export async function loadClientsByIds(ids: string[]): Promise<Client[]> {
  if (ids.length === 0) return [];
  const env = await resolveCurrentEnv();
  const out: Client[] = [];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    let query = sb()
      .from("clients")
      .select("*")
      .in("id", ids.slice(i, i + CHUNK))
      .eq("env", env);
    if (env === "sandbox") {
      const { data: userRes } = await supabase.auth.getUser();
      const owner = userRes.user?.id;
      if (!owner) throw new Error("Usuário do modo teste não identificado.");
      query = query.eq("sandbox_owner", owner);
    }
    const { data, error } = await query;
    if (error) throw error;
    out.push(...((data ?? []) as DbClientRow[]).map(rowToClient));
  }
  return out;
}

export async function dbCompleteMGMVAgreementAsync(
  clientId: string,
): Promise<CompleteMGMVResult> {
  const { data, error } = await sb().rpc("complete_mgmv_agreement", {
    _client_id: clientId,
  });
  if (error) throw error;
  const result = data as {
    ok?: boolean;
    movedProducts?: number;
    completedAt?: string;
  } | null;
  return {
    ok: result?.ok === true,
    movedProducts: Number(result?.movedProducts ?? 0) || 0,
    completedAt: result?.completedAt,
  };
}

/**
 * Monta o snapshot do app a partir das linhas cruas das tabelas.
 * Usado tanto pelo carregamento na nuvem quanto pelo banco local (offline).
 */
export function buildSnapshotFromRows(raw: RawSnapshotRows): DbSnapshot {
  const settings = raw.settings as
    | { preferences?: unknown; rules?: unknown; security?: unknown; ui_state?: unknown }
    | null;

  // Reconstrói cada acordo MGMV a partir das tabelas oficiais
  // (mgmv_agreements + mgmv_installments). Esta é a ÚNICA fonte de verdade
  // do MGMV — o jsonb legado em clients.mgmv é ignorado se não houver
  // registro relacional correspondente.
  const installmentsByAgreement = new Map<string, MGMVInstallment[]>();
  for (const row of (raw.installments ?? []) as unknown as Array<{
    agreement_id: string;
    installment_number: number;
    amount: number | string | null;
    due_date: string | null;
    paid_at: string | null;
    status: string;
    paid_amount?: number | string | null;
    manual_partial?: boolean | null;
  }>) {
    const list = installmentsByAgreement.get(row.agreement_id) ?? [];
    list.push({
      number: row.installment_number,
      total: 0, // preenchido depois
      value: Number(row.amount ?? 0) || 0,
      dueDate: row.due_date ?? new Date().toISOString(),
      paid: row.status === "Paga" || !!row.paid_at,
      paidAt: row.paid_at ?? undefined,
      paidAmount:
        row.paid_amount == null
          ? undefined
          : Number(row.paid_amount) || 0,
      manualPartial: !!row.manual_partial,
    });
    installmentsByAgreement.set(row.agreement_id, list);
  }
  const agreementsByClient = new Map<string, MGMVAgreement>();
  for (const row of (raw.agreements ?? []) as unknown as Array<{
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
    status?: string | null;
    completed_at?: string | null;
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
      completedAt: row.completed_at ?? undefined,
    });
  }

  const clients = (raw.clients ?? []).map((r: Record<string, unknown>) => {
    const c = rowToClient(r as unknown as DbClientRow);
    const official = agreementsByClient.get(c.id);
    // Fonte oficial: tabela relacional. Sem registro relacional → sem mgmv.
    return { ...c, mgmv: official };
  });

  return {
    clients,
    products: (raw.products ?? []).map((r: Record<string, unknown>) =>
      rowToProduct(r as unknown as DbProductRow),
    ),
    importHistory: (raw.importHistory ?? []).map((r: Record<string, unknown>) =>
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
  void sb().from("clients").upsert(clientToRow(c)).then(({ error }) => {
    if (error) logErr("upsertClient", error);
  });
}

export function dbUpsertProduct(p: Product): void {
  void sb().from("products").upsert(productToRow(p)).then(({ error }) => {
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
let clientFlushInFlight: Promise<void> | null = null;
let productFlushInFlight: Promise<void> | null = null;
const FLUSH_DELAY_MS = 250;

function scheduleProductFlush() {
  if (productFlushTimer) return;
  productFlushTimer = setTimeout(() => {
    productFlushTimer = null;
    // Clients must be persisted before products (FK products.client_id → clients.id).
    // Await any pending client flush before pushing products to avoid FK violations
    // during bulk imports where a new client and its products are queued together.
    void (async () => {
      if (pendingClientUpserts.size > 0 || clientFlushTimer || clientFlushInFlight) {
        if (clientFlushTimer) {
          clearTimeout(clientFlushTimer);
          clientFlushTimer = null;
        }
        await flushPendingClientUpserts();
      }
      await flushPendingProductUpserts();
    })().catch((error) => {
      logErr("scheduledProductFlush", error);
      if (pendingProductUpserts.size > 0) scheduleProductFlush();
    });
  }, FLUSH_DELAY_MS);
}

function scheduleClientFlush() {
  if (clientFlushTimer) return;
  clientFlushTimer = setTimeout(() => {
    clientFlushTimer = null;
    void flushPendingClientUpserts().catch((error) => {
      logErr("scheduledClientFlush", error);
      if (pendingClientUpserts.size > 0) scheduleClientFlush();
    });
  }, FLUSH_DELAY_MS);
}

export function queueProductUpsert(p: Product): void {
  markLocalMutation("product", [p.id], "upsert");
  pendingProductUpserts.set(p.id, p);
  scheduleProductFlush();
}

export function queueClientUpsert(c: Client): void {
  markLocalMutation("client", [c.id], "upsert");
  pendingClientUpserts.set(c.id, c);
  scheduleClientFlush();
}

export async function flushPendingProductUpserts(): Promise<void> {
  if (productFlushInFlight) {
    await productFlushInFlight;
    if (pendingProductUpserts.size > 0) return flushPendingProductUpserts();
    return;
  }
  if (pendingProductUpserts.size === 0) return;
  productFlushInFlight = (async () => {
    while (pendingProductUpserts.size > 0) {
      const batch = Array.from(pendingProductUpserts.values());
      for (const row of batch) pendingProductUpserts.delete(row.id);
      try {
        await dbUpsertProductsAsync(batch);
      } catch (error) {
        // Nunca perde uma importação em falha transitória: recoloca somente a
        // versão que ainda não foi substituída por uma edição mais recente.
        for (const row of batch) {
          if (!pendingProductUpserts.has(row.id)) pendingProductUpserts.set(row.id, row);
        }
        throw error;
      }
    }
  })().finally(() => {
    productFlushInFlight = null;
  });
  await productFlushInFlight;
}

export async function flushPendingClientUpserts(): Promise<void> {
  if (clientFlushInFlight) {
    await clientFlushInFlight;
    if (pendingClientUpserts.size > 0) return flushPendingClientUpserts();
    return;
  }
  if (pendingClientUpserts.size === 0) return;
  clientFlushInFlight = (async () => {
    while (pendingClientUpserts.size > 0) {
      const batch = Array.from(pendingClientUpserts.values());
      for (const row of batch) pendingClientUpserts.delete(row.id);
      try {
        await dbUpsertClientsAsync(batch);
      } catch (error) {
        for (const row of batch) {
          if (!pendingClientUpserts.has(row.id)) pendingClientUpserts.set(row.id, row);
        }
        throw error;
      }
    }
  })().finally(() => {
    clientFlushInFlight = null;
  });
  await clientFlushInFlight;
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
  // Clientes primeiro (FK), produtos depois. Cada flush é serializado e só
  // retorna quando também drenou itens enfileirados durante a escrita em voo.
  await flushPendingClientUpserts();
  await flushPendingProductUpserts();
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
  void sb().from("import_history").upsert(historyToRow(h)).then(({ error }) => {
    if (error) logErr("insertHistory", error);
  });
}

export async function dbUpsertHistoryAsync(h: ImportHistoryEntry): Promise<void> {
  const { error } = await sb().from("import_history").upsert(historyToRow(h));
  if (error) logErr("upsertHistoryAsync", error);
}

export async function dbUpsertClientsAsync(clients: Client[]): Promise<void> {
  if (clients.length === 0) return;
  markLocalMutation("client", clients.map((c) => c.id), "upsert");
  const rows = clients.map((c) => clientToRow(c));
  const CHUNK = 200;
  await trackWrite(
    (async () => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await sb().from("clients").upsert(rows.slice(i, i + CHUNK));
        if (error) {
          logErr("upsertClientsAsync", error);
          throw error;
        }
      }
    })(),
  );
}

export async function dbUpsertProductsAsync(products: Product[]): Promise<void> {
  if (products.length === 0) return;
  markLocalMutation("product", products.map((p) => p.id), "upsert");
  const rows = products.map((p) => productToRow(p));
  const CHUNK = 200;
  await trackWrite(
    (async () => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await sb().from("products").upsert(rows.slice(i, i + CHUNK));
        if (error) {
          logErr("upsertProductsAsync", error);
          throw error;
        }
      }
    })(),
  );
}

export function dbDeleteHistoryAll(): void {
  void sb()
    .from("import_history")
    .delete()
    .gte("date", "1900-01-01")
    .then(({ error }) => {
      if (error) logErr("deleteHistoryAll", error);
    });
}

export async function dbDeleteHistoryAllAsync(): Promise<void> {
  const { error } = await sb().from("import_history").delete().gte("date", "1900-01-01");
  if (error) logErr("deleteHistoryAllAsync", error);
}

export function dbDeleteAllClients(): void {
  void sb()
    .from("clients")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllClients", error);
    });
}

export async function dbDeleteAllClientsAsync(): Promise<void> {
  const { error } = await sb().from("clients").delete().not("id", "is", null);
  if (error) logErr("deleteAllClientsAsync", error);
}

export function dbDeleteAllProducts(): void {
  void sb()
    .from("products")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllProducts", error);
    });
}

export async function dbDeleteAllProductsAsync(): Promise<void> {
  const { error } = await sb().from("products").delete().not("id", "is", null);
  if (error) logErr("deleteAllProductsAsync", error);
}

/** Apaga acordos MGMV (parcelas caem em cascata via FK). */
export function dbDeleteAllMGMV(): void {
  void sb()
    .from("mgmv_installments")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllMGMVInstallments", error);
    });
  void sb()
    .from("mgmv_agreements")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllMGMVAgreements", error);
    });
}

export async function dbDeleteAllMGMVAsync(): Promise<void> {
  const installments = await sb().from("mgmv_installments").delete().not("id", "is", null);
  if (installments.error) logErr("deleteAllMGMVInstallmentsAsync", installments.error);
  const agreements = await sb().from("mgmv_agreements").delete().not("id", "is", null);
  if (agreements.error) logErr("deleteAllMGMVAgreementsAsync", agreements.error);
}

/**
 * Apaga todos os dados operacionais da Equipe: tarefas (com seus comentários
 * e activity log) e batidas de ponto. NÃO remove `user_responsibilities` nem
 * `user_roles` — esses são configurações de conta e permanecem entre resets.
 */
export async function dbDeleteAllTeamAsync(): Promise<void> {
  const comments = await sb().from("team_task_comments").delete().not("id", "is", null);
  if (comments.error) logErr("deleteAllTeamTaskCommentsAsync", comments.error);
  const activity = await sb().from("team_task_activity").delete().not("id", "is", null);
  if (activity.error) logErr("deleteAllTeamTaskActivityAsync", activity.error);
  const tasks = await sb().from("team_tasks").delete().not("id", "is", null);
  if (tasks.error) logErr("deleteAllTeamTasksAsync", tasks.error);
  const punches = await sb().from("team_punch_entries").delete().not("id", "is", null);
  if (punches.error) logErr("deleteAllTeamPunchEntriesAsync", punches.error);
}

/** Apaga progresso de importação interrompida do usuário atual. */
export function dbDeleteAllImportProgress(): void {
  void (async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const { error } = await sb()
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
    const { error } = await sb().from("import_progress").delete().eq("user_id", uid);
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
    const { error } = await sb()
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
  const { error } = await sb()
    .from("mgmv_agreements")
    .update({ id: toId, client_id: toId })
    .eq("client_id", fromId);
  if (error) logErr("reassignAgreementClient", error);
}

/** Apaga clientes pelos ids informados. */
export async function dbDeleteClientsByIdsAsync(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  markLocalMutation("client", ids, "delete");
  const CHUNK = 100;
  await trackWrite(
    (async () => {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await sb().from("clients").delete().in("id", slice);
        if (error) {
          logErr("deleteClientsByIds", error);
          throw error;
        }
      }
    })(),
  );
}

/** Apaga produtos pelos ids informados. */
export async function dbDeleteProductsByIdsAsync(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  markLocalMutation("product", ids, "delete");
  const CHUNK = 100;
  await trackWrite(
    (async () => {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await sb().from("products").delete().in("id", slice);
        if (error) {
          logErr("deleteProductsByIds", error);
          throw error;
        }
      }
    })(),
  );
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
/**
 * Linha canônica de `mgmv_agreements` para um cliente com acordo.
 * Pura: usada pelo sync na nuvem e pela exportação do banco local.
 */
export function buildAgreementRow(client: Client): Record<string, unknown> {
  const mgmv = client.mgmv!;
  const sorted = [...mgmv.installments].sort((a, b) => a.number - b.number);
  const paidCount = sorted.filter((i) => i.paid).length;
  const installmentValue = sorted[0]?.value ?? 0;
  const paidValue = sorted
    .filter((i) => i.paid)
    .reduce((s, i) => s + ((i.paidAmount ?? 0) > 0 ? i.paidAmount! : i.value || 0), 0);
  const remainingValue = Math.max(0, (mgmv.totalDebt || 0) - paidValue);
  const nextUnpaid = sorted.find((i) => !i.paid);
  const firstDue = sorted[0]?.dueDate ?? null;

  // Validação matemática para o flag needs_review.
  const sumByInstallments = sorted.reduce((s, i) => s + (i.value || 0), 0);
  const needsReview = mgmv.totalDebt > 0 && Math.abs(sumByInstallments - mgmv.totalDebt) > 0.01;
  // "Quitado" exige TODAS as parcelas pagas E o valor pago cobrindo o total
  // do acordo. Assim uma marcação indevida não fecha o acordo sozinha.
  const fullyPaid =
    sorted.length > 0 &&
    paidCount >= sorted.length &&
    (mgmv.totalDebt || 0) <= 0 + Math.max(0, paidValue) + 0.01;
  const status = fullyPaid ? "Quitado" : needsReview ? "Revisão necessária" : "Ativo";

  // Status de revisão (SEPARADO do status financeiro acima).
  // Preserva ai_reviewed/manually_reviewed quando já marcados; senão deriva
  // de needsReview (divergência matemática) ou cai em 'none'.
  const preservedReview =
    mgmv.reviewStatus === "ai_reviewed" || mgmv.reviewStatus === "manually_reviewed"
      ? mgmv.reviewStatus
      : null;
  const reviewStatus: NonNullable<MGMVAgreement["reviewStatus"]> =
    preservedReview ?? (needsReview ? "review_required" : "none");

  return {
    id: client.id,
    client_id: client.id,
    client_name: client.name,
    client_phone: client.phone ?? "",
    total_agreement_value: mgmv.totalDebt,
    installments_count: sorted.length,
    installment_value: installmentValue,
    paid_installments: paidCount,
    pending_installments: sorted.length - paidCount,
    first_due_date: firstDue,
    next_due_date: nextUnpaid?.dueDate ?? null,
    paid_value: paidValue,
    remaining_value: remainingValue,
    status,
    completed_at: mgmv.completedAt ?? null,
    needs_review: needsReview,
    review_status: reviewStatus,
    ai_reviewed: !!mgmv.aiReviewed,
    ai_review_applied_at: mgmv.aiReviewAppliedAt ?? null,
    ai_confidence: mgmv.aiConfidence ?? null,
    ai_review_raw_result: mgmv.aiReviewRawResult ?? null,
    source_folder: client.folder ?? null,
    original_notes: client.notes ?? null,
  };
}

/** Linhas canônicas de `mgmv_installments` para um cliente com acordo. */
export function buildInstallmentRows(client: Client): Record<string, unknown>[] {
  const sorted = [...(client.mgmv?.installments ?? [])].sort((a, b) => a.number - b.number);
  return sorted.map((i) => ({
    agreement_id: client.id,
    installment_number: i.number,
    amount: i.value,
    due_date: i.dueDate,
    paid_at: i.paid ? (i.paidAt ?? new Date().toISOString()) : null,
    status: i.paid ? "Paga" : "Pendente",
    paid_amount: i.paidAmount != null ? i.paidAmount : i.paid ? i.value : 0,
    manual_partial: !!i.manualPartial,
  }));
}

/**
 * Traduz erros de gravação do banco para uma mensagem em português.
 * O caso mais comum é recusa por RLS (usuário sem permissão), que antes
 * ficava apenas no console e produzia um falso "salvo com sucesso".
 */
export function describeDbError(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  const msg = e?.message ?? "";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "Sem permissão para gravar esta alteração no banco.";
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return "Sem conexão com o banco. A alteração não foi salva.";
  }
  return msg || "Falha ao gravar no banco.";
}

function throwDb(step: string, error: unknown): never {
  logErr(step, error);
  throw new Error(describeDbError(error));
}

export async function dbSyncAgreementForClientAsync(client: Client): Promise<void> {

  const agreementId = client.id;

  if (!client.mgmv || client.mgmv.installments.length === 0) {
    // Sem acordo → remove agreement (cascata apaga parcelas) e zera flags.
    const del = await sb().from("mgmv_agreements").delete().eq("id", agreementId);
    if (del.error) throwDb("syncAgreement.delete", del.error);
    const resetFlags = await sb()
      .from("products")
      .update({
        included_in_mgmv: false,
        mgmv_agreement_id: null,
        collection_eligible: true,
      })
      .eq("client_id", client.id);
    if (resetFlags.error) throwDb("syncAgreement.resetFlags", resetFlags.error);
    return;
  }


  // Uma gravação atrasada de uma parcela não pode reabrir um acordo que já
  // foi concluído em outra operação/aba. A conclusão é monotônica.
  if (!client.mgmv.completedAt) {
    const existing = await sb()
      .from("mgmv_agreements")
      .select("completed_at")
      .eq("id", agreementId)
      .maybeSingle();
    if (existing.error) throwDb("syncAgreement.readCompletion", existing.error);
    if (existing.data?.completed_at) return;
  }

  const sorted = [...client.mgmv.installments].sort((a, b) => a.number - b.number);
  const upAgreement = await sb()
    .from("mgmv_agreements")
    .upsert(buildAgreementRow(client) as never);
  if (upAgreement.error) throwDb("syncAgreement.upsert", upAgreement.error);

  // Substitui parcelas (estratégia simples: delete + insert em lotes).
  // Acordos podem ter dezenas/centenas de parcelas — envia em lotes para
  // não estourar o payload do PostgREST e manter o sync resiliente.
  // Upsert idempotente por (agreement_id, installment_number): nunca existe
  // uma janela em que as parcelas do acordo estejam apagadas do banco.
  if (sorted.length > 0) {
    const rows = buildInstallmentRows(client);
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const upIns = await sb()
        .from("mgmv_installments")
        .upsert(rows.slice(i, i + CHUNK) as never, {
          onConflict: "agreement_id,installment_number",
        });
      if (upIns.error) throwDb("syncAgreement.upsertInstallments", upIns.error);
    }
  }
  // Remove apenas as parcelas que sobraram de um plano maior anterior.
  const delExtra = await sb()
    .from("mgmv_installments")
    .delete()
    .eq("agreement_id", agreementId)
    .gt("installment_number", sorted.length);
  if (delExtra.error) logErr("syncAgreement.delExtraInstallments", delExtra.error);

  // Atualiza flags dos produtos do cliente: produtos com financialStatus
  // = 'MGMV' viram parte do acordo; demais saem do acordo.
  const mgmvProducts = await sb()
    .from("products")
    .update({
      included_in_mgmv: true,
      mgmv_agreement_id: agreementId,
      collection_eligible: false,
    })
    .eq("client_id", client.id)
    .eq("financial_status", "MGMV");
  if (mgmvProducts.error) throwDb("syncAgreement.mgmvProducts", mgmvProducts.error);

  const nonMgmvProducts = await sb()
    .from("products")
    .update({
      included_in_mgmv: false,
      mgmv_agreement_id: null,
      collection_eligible: true,
    })
    .eq("client_id", client.id)
    .neq("financial_status", "MGMV");
  if (nonMgmvProducts.error) throwDb("syncAgreement.nonMgmvProducts", nonMgmvProducts.error);
}


/**
 * Vincula produtos recém-criados ao acordo MGMV ativo do cliente.
 * Usado quando um item é adicionado direto na ficha com status MGMV,
 * garantindo que ele apareça na tabela de itens do acordo (e não suma).
 */
export async function linkProductsToAgreement(
  clientId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const ag = await sb()
    .from("mgmv_agreements")
    .select("id, completed_at")
    .eq("id", clientId)
    .maybeSingle();
  if (ag.error) throw ag.error;
  if (!ag.data || ag.data.completed_at) {
    throw new Error("Cliente sem acordo MGMV ativo");
  }
  const upd = await sb()
    .from("products")
    .update({
      financial_status: "MGMV",
      included_in_mgmv: true,
      mgmv_agreement_id: clientId,
      collection_eligible: false,
    })
    .in("id", productIds);
  if (upd.error) throw upd.error;
}

/** Fire-and-forget wrapper para chamadas de UI. */
export function dbSyncAgreementForClient(client: Client): void {
  void dbSyncAgreementForClientAsync(client).catch((error) => {
    logErr("syncAgreement.fireAndForget", error);
    notifyWriteFailure(describeDbError(error));
  });
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
  /** `null` = a contagem falhou (tempo limite/erro), não é "zero no banco". */
  clientsCount: number | null;
  productsCount: number | null;
  agreementsCount: number | null;
  installmentsCount: number | null;
  /** Clientes marcados como MGMV mas sem registro em mgmv_agreements. */
  mgmvClientsWithoutAgreement: number;
  /** Produtos com included_in_mgmv = true mas sem mgmv_agreement_id. */
  mgmvProductsWithoutAgreementId: number;
  /** Linhas em import_progress (importações interrompidas) para o usuário. */
  importProgressRows: number;
  /** Última versão de reset registrada localmente. */
  resetVersion: string;
  /** Ambiente consultado (produção x modo teste). */
  env: AppEnv;
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
    const { error } = await sb().from("audit_log").insert({
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
  const env = await resolveCurrentEnv();
  const owner = env === "sandbox" ? (getCurrentUserInfo().id ?? null) : null;

  // A contagem via PostgREST (`count: exact`) reavalia a regra de visibilidade
  // linha a linha; com dezenas de milhares de produtos isso estoura o tempo
  // limite e voltava como "indisponível". A RPC conta em uma única consulta.
  const scoped = async (table: string): Promise<number | null> => {
    try {
      const { data, error } = await (sb() as any).rpc("count_env_rows", {
        _table: table,
        _env: env,
        _owner: owner,
      });
      if (error) {
        logErr(`diagnostics.count.${table}`, error);
        return null;
      }
      return typeof data === "number" ? data : Number(data ?? 0);
    } catch (err) {
      logErr(`diagnostics.count.${table}`, err);
      return null;
    }
  };

  const [c, p, a, i, mc, mp] = await Promise.all([
    scoped("clients"),
    scoped("products"),
    scoped("mgmv_agreements"),
    scoped("mgmv_installments"),
    scoped("clients_mgmv"),
    scoped("products_orphan_mgmv"),
  ]);

  // Inconsistência: clientes MGMV sem agreement correspondente.
  // Como o id do agreement = id do client, podemos contar via diff.
  let mgmvClientsWithoutAgreement = 0;
  try {
    const [mgmvClients, allAgreements] = await Promise.all([
      sb().from("clients").select("id").eq("client_type", "mgmv"),
      sb().from("mgmv_agreements").select("client_id"),
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
      const r = await sb()
        .from("import_progress")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid);
      importProgressRows = r.count ?? 0;
    }
  } catch (err) {
    logErr("diagnostics.importProgress", err);
  }

  return {
    clientsCount: c,
    productsCount: p,
    agreementsCount: a,
    installmentsCount: i,
    mgmvClientsWithoutAgreement:
      mgmvClientsWithoutAgreement || Math.max(0, (mc ?? 0) - (a ?? 0)),
    mgmvProductsWithoutAgreementId: mp ?? 0,
    importProgressRows,
    resetVersion: getUiValue<string>("import.resetVersion", ""),
    env,
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
  void sb().from("app_settings").upsert(update as never).then(({ error }) => {
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
  const { error: settingsErr } = await sb()
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

/** Cópia do cache de ui_state (usada pela persistência local). */
export function getUiStateSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [k, v] of uiCache.entries()) snapshot[k] = v;
  return snapshot;
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
    void sb()
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
  const { error } = await sb()
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

/**
 * Suspensão temporária dos refreshes disparados por Realtime. Durante uma
 * restauração de backup (milhares de linhas gravadas em lote) o Postgres
 * emite uma torrente de eventos; sem isso a UI do Modo Teste dispararia
 * dezenas de `loadSnapshot()` completos e travaria.
 */
let realtimeSuspended = 0;
let missedWhileSuspended = false;
const realtimeListeners = new Set<() => void>();

export function suspendRealtimeRefresh(): () => void {
  realtimeSuspended += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    realtimeSuspended = Math.max(0, realtimeSuspended - 1);
    if (realtimeSuspended === 0 && missedWhileSuspended) {
      missedWhileSuspended = false;
      for (const fn of realtimeListeners) fn();
    }
  };
}

/**
 * Assina eventos Realtime nas tabelas de negócio (clients/products/MGMV) e
 * dispara `onRefresh` com debounce curto quando qualquer linha muda. Usado
 * pelo AppLayout para manter o store espelhado com o banco em tempo real —
 * o modal Finanças e demais telas re-renderizam automaticamente.
 *
 * O debounce tem "max wait": em rajadas longas (importação/restauração) os
 * eventos continuam reiniciando o timer curto, mas garantimos no máximo um
 * refresh a cada `MAX_WAIT_MS`, e nunca um por evento.
 */
export interface RealtimeRowEvent {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRow: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
}

export function subscribeRealtimeSnapshot(
  onRefresh: () => void,
  onRow?: (e: RealtimeRowEvent) => void,
): () => void {
  // No Modo Local não há conexão com o banco na nuvem.
  if (isLocalMode()) return () => {};
  let timer: number | null = null;
  let firstEventAt = 0;
  const QUIET_MS = 800;
  const MAX_WAIT_MS = 6000;
  const run = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    firstEventAt = 0;
    if (realtimeSuspended > 0) {
      missedWhileSuspended = true;
      return;
    }
    if (typeof document !== "undefined" && document.hidden) {
      // Aba em segundo plano: adia até o usuário voltar.
      missedWhileSuspended = true;
      return;
    }
    onRefresh();
  };
  const schedule = (payload?: unknown) => {
    if (onRow && payload && typeof payload === "object") {
      const p = payload as {
        table?: string;
        eventType?: string;
        new?: Record<string, unknown>;
        old?: Record<string, unknown>;
      };
      if (p.table && p.eventType) {
        try {
          onRow({
            table: p.table,
            eventType: p.eventType as RealtimeRowEvent["eventType"],
            newRow: p.new && Object.keys(p.new).length > 0 ? p.new : null,
            oldRow: p.old && Object.keys(p.old).length > 0 ? p.old : null,
          });
        } catch {
          /* aplicação pontual é best-effort; a releitura cobre o resto */
        }
      }
    }
    const now = Date.now();
    if (!firstEventAt) firstEventAt = now;
    if (now - firstEventAt >= MAX_WAIT_MS) {
      run();
      return;
    }
    if (timer) window.clearTimeout(timer);
    const wait = Math.min(QUIET_MS, MAX_WAIT_MS - (now - firstEventAt));
    timer = window.setTimeout(run, wait);
  };
  realtimeListeners.add(run);
  const onVisible = () => {
    if (!document.hidden && missedWhileSuspended && realtimeSuspended === 0) {
      missedWhileSuspended = false;
      onRefresh();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  const channel = sb()
    .channel("realtime-store")
    .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, schedule)
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, schedule)
    // Acordos e parcelas também precisam refletir em tempo real: sem isso,
    // pagar/alterar um MGMV em outra aba não atualizava a ficha aberta.
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "mgmv_agreements" },
      schedule,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "mgmv_installments" },
      schedule,
    )
    .subscribe();

  return () => {
    if (timer) window.clearTimeout(timer);
    realtimeListeners.delete(run);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
    supabase.removeChannel(channel);
  };
}