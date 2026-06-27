import { supabase } from "@/integrations/supabase/client";
import type {
  Client,
  Product,
  ImportHistoryEntry,
  SystemPreferences,
  OperationalRules,
  SecuritySettings,
  MGMVAgreement,
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
  const [clientsRes, productsRes, historyRes, settingsRes] = await Promise.all([
    supabase.from("clients").select("*"),
    supabase.from("products").select("*"),
    supabase.from("import_history").select("*").order("date", { ascending: false }).limit(50),
    supabase.from("app_settings").select("*").eq("id", "default").maybeSingle(),
  ]);
  if (clientsRes.error) logErr("loadClients", clientsRes.error);
  if (productsRes.error) logErr("loadProducts", productsRes.error);
  if (historyRes.error) logErr("loadHistory", historyRes.error);
  if (settingsRes.error) logErr("loadSettings", settingsRes.error);

  const settings = settingsRes.data;
  return {
    clients: (clientsRes.data ?? []).map((r) => rowToClient(r as unknown as DbClientRow)),
    products: (productsRes.data ?? []).map((r) => rowToProduct(r as unknown as DbProductRow)),
    importHistory: (historyRes.data ?? []).map((r) => rowToHistory(r as unknown as DbImportHistoryRow)),
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

export function dbInsertHistory(h: ImportHistoryEntry): void {
  void supabase.from("import_history").insert(historyToRow(h)).then(({ error }) => {
    if (error) logErr("insertHistory", error);
  });
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

export function dbDeleteAllClients(): void {
  void supabase
    .from("clients")
    .delete()
    .not("id", "is", null)
    .then(({ error }) => {
      if (error) logErr("deleteAllClients", error);
    });
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

/**
 * Limpa o estado runtime de importação no navegador (cache, preview, lote
 * pendente, importação interrompida). Não toca no banco.
 */
export function clearImportRuntimeState(): void {
  if (typeof window === "undefined") return;
  const PREFIXES = [
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

interface LegacyPersistedState {
  clients?: Client[];
  products?: Product[];
  importHistory?: ImportHistoryEntry[];
  preferences?: SystemPreferences;
  rules?: OperationalRules;
  security?: SecuritySettings;
}

function readLegacyPersistedState(): LegacyPersistedState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: LegacyPersistedState };
    return parsed?.state ?? null;
  } catch {
    return null;
  }
}

function collectLegacyUiState(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof window === "undefined") return out;
  const PREFIXES = ["collection.", "clientes.", "import."];
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
 * Migrates legacy data persisted by zustand `persist` (localStorage key
 * `star-games-store`) and the `usePersistedState` UI keys into the DB.
 *
 * Only runs once: writes a sentinel into `app_settings.ui_state` so future
 * boots skip it.
 */
export async function migrateLocalStorageOnce(snapshot: DbSnapshot): Promise<DbSnapshot> {
  if (typeof window === "undefined") return snapshot;
  if ((snapshot.uiState as Record<string, unknown>)?.[MIGRATION_FLAG]) return snapshot;

  const legacy = readLegacyPersistedState();
  const legacyUi = collectLegacyUiState();

  const dbIsEmpty =
    snapshot.clients.length === 0 &&
    snapshot.products.length === 0 &&
    snapshot.importHistory.length === 0;

  let next: DbSnapshot = snapshot;

  if (legacy && dbIsEmpty) {
    const clientRows = (legacy.clients ?? []).map((c) => clientToRow(c));
    const productRows = (legacy.products ?? []).map((p) => productToRow(p));
    const historyRows = (legacy.importHistory ?? []).map((h) => historyToRow(h));

    if (clientRows.length > 0) {
      const { error } = await supabase.from("clients").upsert(clientRows);
      if (error) logErr("migrate.clients", error);
    }
    if (productRows.length > 0) {
      // Batch in chunks to avoid request-size issues.
      const CHUNK = 200;
      for (let i = 0; i < productRows.length; i += CHUNK) {
        const slice = productRows.slice(i, i + CHUNK);
        const { error } = await supabase.from("products").upsert(slice);
        if (error) logErr("migrate.products", error);
      }
    }
    if (historyRows.length > 0) {
      const { error } = await supabase.from("import_history").insert(historyRows);
      if (error) logErr("migrate.history", error);
    }

    next = {
      ...next,
      clients: (legacy.clients ?? []).slice(),
      products: (legacy.products ?? []).slice(),
      importHistory: (legacy.importHistory ?? []).slice(),
      preferences: { ...next.preferences, ...(legacy.preferences ?? {}) },
      rules: { ...next.rules, ...(legacy.rules ?? {}) },
      security: { ...next.security, ...(legacy.security ?? {}) },
    };
  }

  const mergedUiState: Record<string, unknown> = {
    ...legacyUi,
    ...snapshot.uiState,
    [MIGRATION_FLAG]: true,
  };

  const settingsPatch: Record<string, unknown> = {
    id: "default",
    ui_state: mergedUiState,
  };
  if (legacy?.preferences) settingsPatch.preferences = next.preferences;
  if (legacy?.rules) settingsPatch.rules = next.rules;
  if (legacy?.security) settingsPatch.security = next.security;

  const { error: settingsErr } = await supabase
    .from("app_settings")
    .upsert(settingsPatch as never);
  if (settingsErr) logErr("migrate.settings", settingsErr);

  return { ...next, uiState: mergedUiState };
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

export function setUiValue(key: string, value: unknown) {
  uiCache.set(key, value);
  const subs = uiSubs.get(key);
  if (subs) for (const fn of subs) fn();
  scheduleFlush();
}