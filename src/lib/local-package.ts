// ---------------------------------------------------------------------------
// Pacote local: instalação dos dados no PC e exportação de volta em ZIP
// ---------------------------------------------------------------------------
// - `installLocalPackageFromZip` lê um backup do sistema (mesmo ZIP do painel
//   de Backups) e grava as tabelas no IndexedDB.
// - `loadLocalSnapshot` devolve o snapshot do app a partir do banco local.
// - `exportLocalBackupZip` gera um ZIP idêntico ao formato oficial, já com as
//   alterações feitas offline, pronto para validar no Modo Teste.
// ---------------------------------------------------------------------------

import {
  buildSnapshotFromRows,
  buildAgreementRow,
  buildInstallmentRows,
  clientToRow,
  productToRow,
  historyToRow,
  type DbSnapshot,
} from "./db-sync";
import {
  getAllTableRows,
  getLocalMeta,
  getTableRows,
  putTableRows,
  readLocalSnapshot,
  saveLocalSnapshot,
  setLocalMeta,
  type LocalPackageMeta,
} from "./local-db";
import { buildStoreZip, toZipBytes } from "./zip-store-writer";

/** Mesma versão usada pelo gerador de backup do servidor. */
export const LOCAL_SCHEMA_VERSION = 2;

/** Tabelas levadas para o PC (logs pesados ficam de fora). */
export const LOCAL_TABLES = [
  "profiles",
  "user_roles",
  "role_permissions",
  "user_responsibilities",
  "app_settings",
  "saved_filters",
  "clients",
  "products",
  "mgmv_agreements",
  "mgmv_installments",
  "nf_invoices",
  "import_history",
  "ai_training_profile",
  "ai_automations",
  "team_tasks",
  "team_task_comments",
  "team_task_activity",
  "team_punch_entries",
] as const;

export type LocalInstallProgress = {
  phase: "download" | "read" | "write" | "done";
  table?: string;
  current: number;
  total: number;
  percent: number;
};

function isSandboxRow(row: Record<string, unknown>): boolean {
  return row?.env === "sandbox";
}

function parseJsonl(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      // linha corrompida: ignora
    }
  }
  return rows;
}

/** Instala um backup (ZIP) no banco local deste PC. */
export async function installLocalPackageFromZip(
  blob: Blob,
  opts: { backupId?: string | null; onProgress?: (p: LocalInstallProgress) => void } = {},
): Promise<LocalPackageMeta> {
  const emit = (p: LocalInstallProgress) => opts.onProgress?.(p);
  const JSZip = (await import("jszip")).default;
  emit({ phase: "read", current: 0, total: LOCAL_TABLES.length, percent: 0 });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("manifest.json ausente — este arquivo não é um backup Star Games.");
  }
  const manifest = JSON.parse(await manifestFile.async("string")) as {
    schemaVersion?: number;
    generatedAt?: string;
  };
  const schemaVersion = Number(manifest.schemaVersion ?? 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1 || schemaVersion > LOCAL_SCHEMA_VERSION) {
    throw new Error(`Versão de schema incompatível no backup: ${manifest.schemaVersion}`);
  }

  const rowCounts: Record<string, number> = {};
  let index = 0;
  for (const table of LOCAL_TABLES) {
    index += 1;
    emit({
      phase: "write",
      table,
      current: index,
      total: LOCAL_TABLES.length,
      percent: Math.round((index / LOCAL_TABLES.length) * 100),
    });
    const file = zip.file(`database/data/${table}.jsonl`);
    if (!file) {
      await putTableRows(table, []);
      rowCounts[table] = 0;
      continue;
    }
    const rows = parseJsonl(await file.async("string")).filter((r) => !isSandboxRow(r));
    await putTableRows(table, rows);
    rowCounts[table] = rows.length;
    // Cede o event loop para a UI respirar entre tabelas grandes.
    await new Promise((r) => setTimeout(r, 0));
  }

  const snapshot = await buildSnapshotFromLocalTables();
  await saveLocalSnapshot(snapshot);

  const meta: LocalPackageMeta = {
    backupId: opts.backupId ?? null,
    generatedAt: manifest.generatedAt ?? null,
    installedAt: new Date().toISOString(),
    schemaVersion,
    rowCounts,
    changedAt: null,
    changeCount: 0,
  };
  await setLocalMeta(meta);
  emit({ phase: "done", current: LOCAL_TABLES.length, total: LOCAL_TABLES.length, percent: 100 });
  return meta;
}

async function buildSnapshotFromLocalTables(): Promise<DbSnapshot> {
  const [clients, products, importHistory, agreements, installments, settingsRows] =
    await Promise.all([
      getTableRows("clients"),
      getTableRows("products"),
      getTableRows("import_history"),
      getTableRows("mgmv_agreements"),
      getTableRows("mgmv_installments"),
      getTableRows("app_settings"),
    ]);
  const settings =
    settingsRows.find((r) => (r as { id?: string }).id === "default") ?? settingsRows[0] ?? null;
  return buildSnapshotFromRows({
    clients,
    products,
    importHistory: [...importHistory].sort((a, b) =>
      String((b as { date?: string }).date ?? "").localeCompare(String((a as { date?: string }).date ?? "")),
    ),
    agreements,
    installments,
    settings: settings as Record<string, unknown> | null,
  });
}

/** Snapshot do app no Modo Local (null quando não há pacote instalado). */
export async function loadLocalSnapshot(): Promise<DbSnapshot | null> {
  const meta = await getLocalMeta().catch(() => null);
  if (!meta) return null;
  const saved = await readLocalSnapshot().catch(() => null);
  if (saved) return saved;
  return buildSnapshotFromLocalTables();
}

/** Persiste o estado atual do app no banco local (chamado após cada mudança). */
export async function persistLocalSnapshot(snapshot: DbSnapshot): Promise<void> {
  const meta = await getLocalMeta().catch(() => null);
  if (!meta) return;
  await saveLocalSnapshot(snapshot);
  await setLocalMeta({
    ...meta,
    changedAt: new Date().toISOString(),
    changeCount: (meta.changeCount ?? 0) + 1,
  });
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

function mergeById(
  original: Record<string, unknown>[],
  next: Record<string, unknown>[],
  key = "id",
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of original) byId.set(String(row[key]), row);
  return next.map((row) => {
    const prev = byId.get(String(row[key]));
    return prev ? { ...prev, ...row } : { env: "producao", ...row };
  });
}

function toJsonl(rows: Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

export interface LocalExportResult {
  bytes: Uint8Array;
  filename: string;
  rowCounts: Record<string, number>;
}

/**
 * Gera o ZIP de backup a partir do banco local, aplicando as alterações
 * feitas offline. O arquivo usa o mesmo formato do backup do servidor e é
 * aceito diretamente pelo fluxo de restauração (inclusive no Modo Teste).
 */
export async function exportLocalBackupZip(snapshot: DbSnapshot): Promise<LocalExportResult> {
  const tables = await getAllTableRows();
  const meta = await getLocalMeta();

  // ---- tabelas geridas pelo app (recebem as edições offline) ----
  const clientRows = mergeById(
    tables.clients ?? [],
    snapshot.clients.map((c) => clientToRow(c) as unknown as Record<string, unknown>),
  );
  const productRows = mergeById(
    tables.products ?? [],
    snapshot.products.map((p) => productToRow(p) as unknown as Record<string, unknown>),
  );
  const historyRows = mergeById(
    tables.import_history ?? [],
    snapshot.importHistory.map((h) => historyToRow(h) as unknown as Record<string, unknown>),
  );

  const mgmvClients = snapshot.clients.filter((c) => c.mgmv && c.mgmv.installments.length > 0);
  const agreementRows = mergeById(
    tables.mgmv_agreements ?? [],
    mgmvClients.map((c) => buildAgreementRow(c)),
  );
  const previousInstallments = new Map<string, Record<string, unknown>>();
  for (const row of tables.mgmv_installments ?? []) {
    previousInstallments.set(
      `${row.agreement_id}:${row.installment_number}`,
      row as Record<string, unknown>,
    );
  }
  const installmentRows = mgmvClients.flatMap((c) =>
    buildInstallmentRows(c).map((row) => {
      const prev = previousInstallments.get(`${row.agreement_id}:${row.installment_number}`);
      return prev
        ? { ...prev, ...row }
        : { id: crypto.randomUUID(), env: "producao", ...row };
    }),
  );

  const settingsRows = (tables.app_settings ?? []).map((row) =>
    (row as { id?: string }).id === "default"
      ? {
          ...row,
          preferences: snapshot.preferences,
          rules: snapshot.rules,
          security: snapshot.security,
          ui_state: snapshot.uiState,
        }
      : row,
  );

  const output: Record<string, Record<string, unknown>[]> = {
    ...tables,
    clients: clientRows,
    products: productRows,
    import_history: historyRows,
    mgmv_agreements: agreementRows,
    mgmv_installments: installmentRows,
    app_settings: settingsRows.length > 0 ? settingsRows : (tables.app_settings ?? []),
  };

  const rowCounts: Record<string, number> = {};
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  for (const table of LOCAL_TABLES) {
    const rows = output[table] ?? [];
    rowCounts[table] = rows.length;
    entries.push({
      path: `database/data/${table}.jsonl`,
      data: toZipBytes(toJsonl(rows)),
    });
  }

  const now = new Date();
  const manifest = {
    schemaVersion: LOCAL_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    type: "local",
    origin: {
      source: "instalacao-windows",
      backupId: meta?.backupId ?? null,
      packageGeneratedAt: meta?.generatedAt ?? null,
      installedAt: meta?.installedAt ?? null,
      offlineChanges: meta?.changeCount ?? 0,
    },
    rowCounts,
    storageObjectCount: 0,
    tables: LOCAL_TABLES,
    buckets: [],
  };
  const summary = {
    generatedAt: now.toISOString(),
    origin: "local",
    clients: snapshot.clients.length,
    products: snapshot.products.length,
    agreements: agreementRows.length,
    installments: installmentRows.length,
  };

  entries.push({ path: "manifest.json", data: toZipBytes(JSON.stringify(manifest, null, 2)) });
  entries.push({ path: "summary.json", data: toZipBytes(JSON.stringify(summary, null, 2)) });
  entries.push({ path: "RESTORE.md", data: toZipBytes(LOCAL_RESTORE_MD) });

  const bytes = await buildStoreZip(entries, { modifiedAt: now });
  const pad = (n: number) => String(n).padStart(2, "0");
  const filename = `stargames-local-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
  return { bytes, filename, rowCounts };
}

const LOCAL_RESTORE_MD = `# Backup gerado pela instalação local (Windows)

Este ZIP foi criado no PC, a partir do banco local do sistema, e inclui as
alterações feitas offline.

## Como reimportar com segurança

1. Abra o sistema na nuvem → Configurações → Ambiente de Teste (Sandbox).
2. Entre no Modo Teste e use "Importar backup" enviando este arquivo.
3. Confira o relatório de diferenças e os totais no Modo Teste.
4. Estando tudo certo, saia do Modo Teste e repita a importação em produção.

Os arquivos originais (acervo HTML) não fazem parte deste pacote: apenas os
dados das tabelas.
`;