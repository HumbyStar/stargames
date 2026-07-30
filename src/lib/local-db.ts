// ---------------------------------------------------------------------------
// Banco local (IndexedDB) usado pela instalação Windows / Modo Local
// ---------------------------------------------------------------------------
// Stores:
//   tables → uma entrada por tabela do backup (array de linhas cruas)
//   kv     → metadados do pacote e o snapshot de trabalho do app
// ---------------------------------------------------------------------------

import type { DbSnapshot } from "./db-sync";

const DB_NAME = "stargames-local";
const DB_VERSION = 1;
const TABLES_STORE = "tables";
const KV_STORE = "kv";

export interface LocalPackageMeta {
  /** id do backup de origem (quando veio de um backup do sistema) */
  backupId: string | null;
  /** quando o ZIP de origem foi gerado no servidor */
  generatedAt: string | null;
  /** quando o pacote foi instalado neste PC */
  installedAt: string;
  schemaVersion: number;
  rowCounts: Record<string, number>;
  /** última alteração feita offline neste PC */
  changedAt: string | null;
  changeCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function localDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!localDbAvailable()) return Promise.reject(new Error("IndexedDB indisponível neste navegador."));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TABLES_STORE)) db.createObjectStore(TABLES_STORE);
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Falha ao abrir o banco local."));
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("Erro no banco local."));
      }),
  );
}

// ----------------------------- tabelas -------------------------------------

export function putTableRows(table: string, rows: unknown[]): Promise<void> {
  return tx<IDBValidKey>(TABLES_STORE, "readwrite", (s) => s.put(rows, table)).then(() => undefined);
}

export function getTableRows<T = Record<string, unknown>>(table: string): Promise<T[]> {
  return tx<T[] | undefined>(TABLES_STORE, "readonly", (s) => s.get(table)).then((v) => v ?? []);
}

export async function listLocalTables(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>(TABLES_STORE, "readonly", (s) => s.getAllKeys());
  return keys.map((k) => String(k));
}

export async function getAllTableRows(): Promise<Record<string, Record<string, unknown>[]>> {
  const tables = await listLocalTables();
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) out[table] = await getTableRows(table);
  return out;
}

export function clearTables(): Promise<void> {
  return tx<undefined>(TABLES_STORE, "readwrite", (s) => s.clear()).then(() => undefined);
}

// ------------------------------- kv ----------------------------------------

function kvGet<T>(key: string): Promise<T | null> {
  return tx<T | undefined>(KV_STORE, "readonly", (s) => s.get(key)).then((v) => v ?? null);
}

function kvSet(key: string, value: unknown): Promise<void> {
  return tx<IDBValidKey>(KV_STORE, "readwrite", (s) => s.put(value, key)).then(() => undefined);
}

export function getLocalMeta(): Promise<LocalPackageMeta | null> {
  return kvGet<LocalPackageMeta>("meta").catch(() => null);
}

export function setLocalMeta(meta: LocalPackageMeta): Promise<void> {
  return kvSet("meta", meta);
}

export async function markLocalChange(): Promise<void> {
  const meta = await getLocalMeta();
  if (!meta) return;
  await setLocalMeta({
    ...meta,
    changedAt: new Date().toISOString(),
    changeCount: (meta.changeCount ?? 0) + 1,
  });
}

/** Snapshot de trabalho do app (mesma forma usada por `loadSnapshot`). */
export function saveLocalSnapshot(snapshot: DbSnapshot): Promise<void> {
  return kvSet("snapshot", snapshot);
}

export function readLocalSnapshot(): Promise<DbSnapshot | null> {
  return kvGet<DbSnapshot>("snapshot").catch(() => null);
}

export async function hasLocalPackage(): Promise<boolean> {
  if (!localDbAvailable()) return false;
  try {
    return (await getLocalMeta()) != null;
  } catch {
    return false;
  }
}

export async function clearLocalPackage(): Promise<void> {
  await clearTables();
  await tx<undefined>(KV_STORE, "readwrite", (s) => s.clear());
}