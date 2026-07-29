import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deferWithWorkerContext } from "@/lib/worker-context";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Backup completo do sistema
// ---------------------------------------------------------------------------
// Gera um ZIP contendo:
//   - /manifest.json              contagem por tabela, versão, timestamp
//   - /database/data/<table>.jsonl (1 registro JSON por linha)
//   - /storage/notion-html-originals/... (espelho do bucket)
//   - /RESTORE.md                 instruções para restaurar em outro Supabase
//
// O ZIP é salvo no bucket privado "system-backups" e o metadado fica em
// public.system_backups. Somente admins/admin_masters têm acesso (RLS).
// ---------------------------------------------------------------------------

const BACKUP_BUCKET = "system-backups";
const BACKUP_SCHEMA_VERSION = 2;
// Reduzido de 20min → 5min. Se um Worker for morto no meio, a UI consegue
// retomar/limpar rápido em vez de esperar 20 minutos.
const STALE_BACKUP_MS = 5 * 60 * 1000;
const STORAGE_MIRROR_MAX_BYTES = 500 * 1024 * 1024;
const STORAGE_MIRROR_MAX_FILES = 10_000;
// Heurística: cada linha ocupa ~800 bytes em JSONL (chaves + valores).
const ESTIMATED_BYTES_PER_ROW = 800;

class BackupCancelledError extends Error {
  constructor() {
    super("Backup cancelado pelo usuário.");
    this.name = "BackupCancelledError";
  }
}

async function isCancellationRequested(admin: any, backupId: string): Promise<boolean> {
  try {
    const { data } = await admin
      .from("system_backups")
      .select("cancel_requested,status")
      .eq("id", backupId)
      .maybeSingle();
    if (!data) return false;
    return Boolean(data.cancel_requested) || data.status === "cancelled";
  } catch {
    return false;
  }
}

export interface BackupDebugEntry {
  at: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
  elapsedMs?: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface BackupErrorDetails {
  message: string;
  name?: string;
  phase?: string;
  elapsedMs?: number;
  stack?: string;
}

// Todas as tabelas do app que devem entrar no backup.
// Ordenadas por prioridade (independentes primeiro; dependentes depois).
const BACKUP_TABLES = [
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
  "import_progress",
  "ai_training_profile",
  "ai_automations",
  "team_tasks",
  "team_task_comments",
  "team_task_activity",
  "team_punch_entries",
  "notion_html_access_log",
  "audit_log",
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];

export const BACKUP_TABLE_NAMES: readonly string[] = BACKUP_TABLES;

// ---------------------------------------------------------------------------
// Resumo de negócio
// ---------------------------------------------------------------------------

export interface BusinessSummary {
  generatedAt: string;
  clients: {
    total: number;
    withFicha: number;
    withoutFicha: number;
    mgmvOnly: number;
  };
  products: {
    total: number;
    bySituation: Record<string, number>;
    byFinancialStatus: Record<string, number>;
    withNf: number;
    withoutNf: number;
  };
  mgmv: {
    agreements: number;
    active: number;
    completed: number;
    needsReview: number;
    installmentsTotal: number;
    installmentsPaid: number;
    installmentsPending: number;
    installmentsOverdue: number;
    totalAgreedCents: number;
    totalPaidCents: number;
    remainingCents: number;
  };
  financeiro: {
    receivedCents: number;
    receivableCents: number;
    overdueCents: number;
  };
  nfInvoices: {
    total: number;
    totalCents: number;
  };
  team: {
    tasksTotal: number;
    tasksByStatus: Record<string, number>;
    punchesThisMonth: number;
  };
}

function toCents(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function bumpMap(map: Record<string, number>, key: string, by = 1) {
  const k = (key ?? "").toString().trim() || "—";
  map[k] = (map[k] ?? 0) + by;
}

function sanitizeDiagnostic(value: unknown): string {
  return String(value ?? "")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[chave-redigida]")
    .replace(/sb_[A-Za-z0-9_-]+/g, "[chave-redigida]")
    .replace(/https?:\/\/[^\s)]+/g, "[url-redigida]")
    .slice(0, 5000);
}

function normalizeDebugMeta(meta?: Record<string, unknown>): BackupDebugEntry["meta"] {
  if (!meta) return undefined;
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => {
      if (typeof value === "number" || typeof value === "boolean" || value === null) return [key, value];
      return [key, sanitizeDiagnostic(value).slice(0, 500)];
    }),
  );
}

function makeErrorDetails(
  err: unknown,
  phase: string,
  elapsedMs: number,
): BackupErrorDetails {
  const error = err instanceof Error ? err : null;
  return {
    message: sanitizeDiagnostic(error?.message ?? err),
    name: error?.name ? sanitizeDiagnostic(error.name) : undefined,
    phase,
    elapsedMs,
    stack: error?.stack ? sanitizeDiagnostic(error.stack) : undefined,
  };
}

async function persistBackupDebug(
  admin: any,
  backupId: string,
  debugLog: BackupDebugEntry[],
  patch: Record<string, unknown> = {},
) {
  try {
    await admin
      .from("system_backups")
      .update({ debug_log: debugLog.slice(-120), ...patch } as any)
      .eq("id", backupId);
  } catch (err) {
    console.warn("[backup] failed to persist debug log:", err);
  }
}

export function computeBusinessSummaryFromRows(data: {
  clients: any[];
  products: any[];
  agreements: any[];
  installments: any[];
  nfInvoices: any[];
  teamTasks: any[];
  punchEntries: any[];
}): BusinessSummary {
  const now = new Date();
  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

  // Ficha completa: heurística — clients.customer_data com >= 40 chars.
  const withFicha = data.clients.filter(
    (c) => typeof c.customer_data === "string" && c.customer_data.trim().length >= 40,
  ).length;
  const mgmvClientIds = new Set(
    data.agreements
      .filter((a) => a.status !== "cancelled" && a.status !== "cancelado")
      .map((a) => a.client_id),
  );
  const clientIdsWithNonMgmvProduct = new Set(
    data.products.filter((p) => !p.included_in_mgmv).map((p) => p.client_id),
  );
  const mgmvOnly = Array.from(mgmvClientIds).filter(
    (id) => !clientIdsWithNonMgmvProduct.has(id),
  ).length;

  const bySituation: Record<string, number> = {};
  const byFinancialStatus: Record<string, number> = {};
  const productIdsWithNf = new Set<string>();
  let nfTotalCents = 0;
  for (const nf of data.nfInvoices) {
    nfTotalCents += Number(nf.total_cents ?? 0);
    for (const pid of nf.product_ids ?? []) productIdsWithNf.add(pid);
  }
  for (const p of data.products) {
    bumpMap(bySituation, p.situation);
    bumpMap(byFinancialStatus, p.financial_status);
  }
  const withNf = data.products.filter((p) => productIdsWithNf.has(p.id)).length;

  // MGMV
  let totalAgreedCents = 0;
  let totalPaidCents = 0;
  let active = 0;
  let completed = 0;
  let needsReview = 0;
  for (const a of data.agreements) {
    totalAgreedCents += toCents(a.total_agreement_value);
    totalPaidCents += toCents(a.paid_value);
    if (a.needs_review) needsReview++;
    const s = (a.status ?? "").toString().toLowerCase();
    if (s === "completed" || s === "concluido" || s === "concluído" || s === "quitado") completed++;
    else if (s !== "cancelled" && s !== "cancelado") active++;
  }
  let installmentsPaid = 0;
  let installmentsPending = 0;
  let installmentsOverdue = 0;
  let overdueCents = 0;
  let receivableCents = 0;
  for (const i of data.installments) {
    const st = (i.status ?? "").toString().toLowerCase();
    if (st.startsWith("pag") || st === "paid") installmentsPaid++;
    else {
      installmentsPending++;
      const remaining = toCents(i.amount) - toCents(i.paid_amount);
      receivableCents += Math.max(0, remaining);
      const due = i.due_date ? new Date(i.due_date) : null;
      if (due && due < now) {
        installmentsOverdue++;
        overdueCents += Math.max(0, remaining);
      }
    }
  }

  // Produtos não-MGMV: a receber e vencidos
  for (const p of data.products) {
    if (p.included_in_mgmv) continue;
    const remaining = toCents(p.total_value) - toCents(p.paid_value);
    if (remaining <= 0) continue;
    const st = (p.financial_status ?? "").toString().toLowerCase();
    if (st === "pago" || st === "paid") continue;
    receivableCents += remaining;
    const due = p.due_date ? new Date(p.due_date) : null;
    if (due && due < now) overdueCents += remaining;
  }
  const receivedCents = totalPaidCents +
    data.products
      .filter((p) => !p.included_in_mgmv)
      .reduce((s, p) => s + toCents(p.paid_value), 0);

  const tasksByStatus: Record<string, number> = {};
  for (const t of data.teamTasks) bumpMap(tasksByStatus, t.status);
  const punchesThisMonth = data.punchEntries.filter((e) => {
    const d = e.punched_at ? new Date(e.punched_at) : null;
    return d && d >= monthStart;
  }).length;

  return {
    generatedAt: now.toISOString(),
    clients: {
      total: data.clients.length,
      withFicha,
      withoutFicha: data.clients.length - withFicha,
      mgmvOnly,
    },
    products: {
      total: data.products.length,
      bySituation,
      byFinancialStatus,
      withNf,
      withoutNf: data.products.length - withNf,
    },
    mgmv: {
      agreements: data.agreements.length,
      active,
      completed,
      needsReview,
      installmentsTotal: data.installments.length,
      installmentsPaid,
      installmentsPending,
      installmentsOverdue,
      totalAgreedCents,
      totalPaidCents,
      remainingCents: Math.max(0, totalAgreedCents - totalPaidCents),
    },
    financeiro: { receivedCents, receivableCents, overdueCents },
    nfInvoices: { total: data.nfInvoices.length, totalCents: nfTotalCents },
    team: {
      tasksTotal: data.teamTasks.length,
      tasksByStatus,
      punchesThisMonth,
    },
  };
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const [admin, adminMaster] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin_master" }),
  ]);
  if (admin.error) throw new Error(admin.error.message);
  if (adminMaster.error) throw new Error(adminMaster.error.message);
  if (!admin.data && !adminMaster.data) {
    throw new Error("Forbidden: admin only");
  }
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

function formatFilename(now = new Date()): string {
  return `backup-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate(),
  )}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}.zip`;
}

function storagePathFor(now: Date, filename: string): string {
  return `${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${filename}`;
}

const RESTORE_MD = `# Restaurar este backup em um Supabase próprio

Este ZIP contém um snapshot completo dos dados do sistema Star Games.

## 1. Preparar o projeto destino

1. Crie um projeto novo em https://supabase.com
2. No SQL Editor, aplique todas as migrações do repositório em ordem
   (\`supabase/migrations/*.sql\`). Isso recria tabelas, tipos, funções e RLS.
3. Crie os buckets manualmente no Storage: \`notion-html-originals\` (privado)
   e \`system-backups\` (privado). As policies são criadas pelas migrações.

## 2. Restaurar dados

Cada arquivo em \`/database/data/\` é JSON Lines (uma linha = um registro).
Use o script Node abaixo apontando para SUPABASE_URL + SERVICE_ROLE_KEY do
destino:

\`\`\`bash
npm i @supabase/supabase-js
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node restore.mjs ./backup-descompactado
\`\`\`

O script faz upsert nas tabelas em ordem de dependência e sobe os arquivos
de \`/storage/notion-html-originals/\` para o bucket correspondente.

## 3. Usuários (auth.users)

Contas de acesso não são exportadas (hashes de senha não são portáveis).
O arquivo \`/database/data/profiles.jsonl\` traz nome/perfil para reconciliar.
No destino, recrie os usuários via Auth Admin API e envie link de redefinição
de senha.
`;

async function fetchAllRows(
  admin: any,
  table: BackupTable,
  batchSize = 1000,
): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return out;
}

async function fetchRowsForBackup(
  admin: any,
  table: BackupTable,
  opts: { batchSize?: number; keepRows?: boolean } = {},
): Promise<{ rowCount: number; jsonl: string; rows?: any[] }> {
  const batchSize = opts.batchSize ?? 1000;
  const rowsToKeep: any[] | undefined = opts.keepRows ? [] : undefined;
  const chunks: string[] = [];
  let from = 0;
  let rowCount = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;

    const batchJsonl = data.map((r: any) => JSON.stringify(r)).join("\n");
    if (batchJsonl) chunks.push(rowCount === 0 ? batchJsonl : `\n${batchJsonl}`);
    if (rowsToKeep) rowsToKeep.push(...data);
    rowCount += data.length;
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return { rowCount, jsonl: chunks.join(""), rows: rowsToKeep };
}

async function cleanupStaleBackups(admin: any) {
  const cutoff = new Date(Date.now() - STALE_BACKUP_MS).toISOString();
  await admin
    .from("system_backups")
    .update({
      status: "failed",
      error: "Backup interrompido por timeout/limite de execução. Gere novamente.",
      error_details: {
        message: "Backup interrompido por timeout/limite de execução. Gere novamente.",
        phase: "timeout",
        elapsedMs: STALE_BACKUP_MS,
      },
      debug_log: [
        {
          at: new Date().toISOString(),
          level: "error",
          phase: "timeout",
          message: "Backup interrompido por timeout/limite de execução. Gere novamente.",
          elapsedMs: STALE_BACKUP_MS,
        },
      ],
      finished_at: new Date().toISOString(),
    } as any)
    .in("status", ["pending", "running"])
    .lt("created_at", cutoff);
}

async function mirrorBucket(
  admin: any,
  bucket: string,
  onFile: (relPath: string, bytes: Uint8Array) => void,
  opts: { maxTotalBytes?: number; maxFiles?: number } = {},
): Promise<number> {
  let count = 0;
  let totalBytes = 0;
  let stopped = false;
  const maxBytes = opts.maxTotalBytes ?? 25 * 1024 * 1024; // 25MB
  const maxFiles = opts.maxFiles ?? 500;
  const walk = async (prefix: string) => {
    if (stopped) return;
    let offset = 0;
    const limit = 100;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`[storage/${bucket}] ${error.message}`);
      if (!data || data.length === 0) break;
      for (const item of data) {
        if (stopped) return;
        const isFolder = !item.id && !item.metadata;
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (isFolder) {
          await walk(path);
        } else {
          const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
          if (dlErr) throw new Error(`[storage/${bucket}/${path}] ${dlErr.message}`);
          const buf = new Uint8Array(await blob.arrayBuffer());
          onFile(path, buf);
          count++;
          totalBytes += buf.byteLength;
          if (count >= maxFiles || totalBytes >= maxBytes) {
            console.warn(
              `[backup] storage mirror capped at ${count} files / ${totalBytes} bytes`,
            );
            stopped = true;
            return;
          }
        }
      }
      if (data.length < limit) break;
      offset += limit;
    }
  };
  await walk("");
  return count;
}

async function runBackup(opts: {
  type: "manual" | "scheduled";
  createdBy: string | null;
  existing?: { id: string; storagePath: string };
}): Promise<{ id: string; storagePath: string; sizeBytes: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const JSZip = (await import("jszip")).default;

  await cleanupStaleBackups(supabaseAdmin);

  const now = new Date();
  const filename = formatFilename(now);
  const storagePath = opts.existing?.storagePath ?? storagePathFor(now, filename);
  const startedAt = Date.now();
  const debugLog: BackupDebugEntry[] = [];
  let phase = "initializing";
  const pushDebug = (
    level: BackupDebugEntry["level"],
    nextPhase: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    phase = nextPhase;
    const entry: BackupDebugEntry = {
      at: new Date().toISOString(),
      level,
      phase: nextPhase,
      message: sanitizeDiagnostic(message),
      elapsedMs: Date.now() - startedAt,
      meta: normalizeDebugMeta(meta),
    };
    debugLog.push(entry);
    const line = `[backup] ${nextPhase}: ${entry.message}`;
    if (level === "error") console.error(line, entry.meta ?? "");
    else if (level === "warn") console.warn(line, entry.meta ?? "");
    else console.info(line, entry.meta ?? "");
    return entry;
  };

  let backupId: string;
  pushDebug("info", "initializing", "Backup iniciado", {
    type: opts.type,
    mode: opts.existing ? "resume" : "new",
  });
  if (opts.existing) {
    backupId = opts.existing.id;
    const { error: startErr } = await supabaseAdmin
      .from("system_backups")
      .update({ status: "running", error: null, error_details: null, debug_log: debugLog } as any)
      .eq("id", backupId);
    if (startErr) throw new Error(startErr.message);
  } else {
    const { data: rowIns, error: insErr } = await supabaseAdmin
      .from("system_backups")
      .insert({
        created_by: opts.createdBy,
        type: opts.type,
        status: "running",
        storage_path: storagePath,
        debug_log: debugLog,
      } as any)
      .select("id")
      .single();
    if (insErr || !rowIns) throw new Error(insErr?.message ?? "insert failed");
    backupId = rowIns.id as string;
  }

  try {
    pushDebug("info", "zip:create", "Preparando arquivo ZIP");
    await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    const zip = new JSZip();
    const rowCounts: Record<string, number> = {};
    const tableRows: Record<string, any[]> = {};
    // Somente tabelas necessárias ao resumo permanecem em memória; as
    // demais são serializadas e descartadas para evitar estourar o
    // limite de memória do Worker.
    const KEEP_FOR_SUMMARY = new Set<string>([
      "clients",
      "products",
      "mgmv_agreements",
      "mgmv_installments",
      "nf_invoices",
      "team_tasks",
      "team_punch_entries",
    ]);

    for (const table of BACKUP_TABLES) {
      phase = `database:${table}`;
      if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
      const keepRows = KEEP_FOR_SUMMARY.has(table);
      const exported = await fetchRowsForBackup(supabaseAdmin, table, { keepRows });
      rowCounts[table] = exported.rowCount;
      zip.file(`database/data/${table}.jsonl`, exported.jsonl);
      if (keepRows) {
        tableRows[table] = exported.rows ?? [];
      }
      pushDebug("info", `database:${table}`, `Tabela ${table} exportada`, {
        rows: exported.rowCount,
        keptForSummary: keepRows,
      });
      await persistBackupDebug(supabaseAdmin, backupId, debugLog, { row_counts: rowCounts });
    }

    // Storage: notion-html-originals
    let storageObjectCount = 0;
    try {
      if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
      pushDebug("info", "storage:notion-html-originals", "Espelhando arquivos originais", {
        maxFiles: STORAGE_MIRROR_MAX_FILES,
        maxBytes: STORAGE_MIRROR_MAX_BYTES,
      });
      await persistBackupDebug(supabaseAdmin, backupId, debugLog);
      storageObjectCount = await mirrorBucket(
        supabaseAdmin,
        "notion-html-originals",
        (relPath, bytes) => {
          zip.file(`storage/notion-html-originals/${relPath}`, bytes);
        },
        { maxTotalBytes: STORAGE_MIRROR_MAX_BYTES, maxFiles: STORAGE_MIRROR_MAX_FILES },
      );
      pushDebug("info", "storage:notion-html-originals", "Arquivos originais espelhados", {
        files: storageObjectCount,
      });
      await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
        storage_object_count: storageObjectCount,
      });
    } catch (err) {
      if (err instanceof BackupCancelledError) throw err;
      // Se o bucket não existir, seguimos com o resto do backup.
      console.warn("[backup] mirror bucket failed:", err);
      pushDebug("warn", "storage:notion-html-originals", "Falha ao espelhar arquivos originais; backup seguirá sem esse espelho", {
        error: err instanceof Error ? err.message : String(err),
      });
      await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    }

    pushDebug("info", "summary", "Calculando resumo de negócio");
    if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
    await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    const businessSummary = computeBusinessSummaryFromRows({
      clients: tableRows["clients"] ?? [],
      products: tableRows["products"] ?? [],
      agreements: tableRows["mgmv_agreements"] ?? [],
      installments: tableRows["mgmv_installments"] ?? [],
      nfInvoices: tableRows["nf_invoices"] ?? [],
      teamTasks: tableRows["team_tasks"] ?? [],
      punchEntries: tableRows["team_punch_entries"] ?? [],
    });

    const manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      type: opts.type,
      rowCounts,
      storageObjectCount,
      tables: BACKUP_TABLES,
      buckets: ["notion-html-originals"],
      businessSummary,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("summary.json", JSON.stringify(businessSummary, null, 2));
    zip.file("RESTORE.md", RESTORE_MD);

    pushDebug("info", "zip:generate", "Gerando conteúdo final do ZIP");
    if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
    await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
      business_summary: businessSummary as any,
    });
    const zipBuf = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE",
      streamFiles: true,
    });

    pushDebug("info", "storage:upload", "Enviando ZIP para o armazenamento privado", {
      sizeBytes: zipBuf.byteLength,
    });
    if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
    await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    const { error: upErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, zipBuf, {
        contentType: "application/zip",
        upsert: true,
      });
    if (upErr) throw new Error(upErr.message);

    const duration = Date.now() - startedAt;
    pushDebug("info", "completed", "Backup concluído com sucesso", {
      sizeBytes: zipBuf.byteLength,
      durationMs: duration,
      storageObjectCount,
    });
    await supabaseAdmin
      .from("system_backups")
      .update({
        status: "completed",
        error: null,
        error_details: null,
        size_bytes: zipBuf.byteLength,
        duration_ms: duration,
        row_counts: rowCounts,
        storage_object_count: storageObjectCount,
        finished_at: new Date().toISOString(),
        business_summary: businessSummary as any,
        debug_log: debugLog,
      } as any)
      .eq("id", backupId);

    // Retenção: mantém últimos 14 backups.
    await pruneOldBackups(supabaseAdmin, 14);

    return { id: backupId, storagePath, sizeBytes: zipBuf.byteLength };
  } catch (err: any) {
    if (err instanceof BackupCancelledError) {
      const elapsed = Date.now() - startedAt;
      pushDebug("warn", "cancelled", "Backup cancelado pelo usuário", { elapsedMs: elapsed });
      await supabaseAdmin
        .from("system_backups")
        .update({
          status: "cancelled",
          error: "Cancelado pelo usuário",
          error_details: {
            message: "Backup cancelado pelo usuário.",
            phase: "cancelled",
            elapsedMs: elapsed,
          } as any,
          debug_log: debugLog,
          finished_at: new Date().toISOString(),
          cancel_requested: false,
        } as any)
        .eq("id", backupId);
      // Limpa qualquer parcial no storage
      try {
        await supabaseAdmin.storage.from(BACKUP_BUCKET).remove([storagePath]);
      } catch {}
      return { id: backupId, storagePath, sizeBytes: 0 };
    }
    const details = makeErrorDetails(err, phase, Date.now() - startedAt);
    pushDebug("error", details.phase ?? phase, details.message, {
      name: details.name ?? null,
      elapsedMs: details.elapsedMs ?? null,
    });
    await supabaseAdmin
      .from("system_backups")
      .update({
        status: "failed",
        error: details.message,
        error_details: details as any,
        debug_log: debugLog,
        finished_at: new Date().toISOString(),
      } as any)
      .eq("id", backupId);
    throw err;
  }
}

async function pruneOldBackups(admin: any, keep: number) {
  const { data } = await admin
    .from("system_backups")
    .select("id, storage_path, status")
    .eq("status", "completed")
    .order("created_at", { ascending: false });
  if (!data || data.length <= keep) return;
  const toDelete = data.slice(keep);
  for (const row of toDelete) {
    if (row.storage_path) {
      await admin.storage.from(BACKUP_BUCKET).remove([row.storage_path]);
    }
    await admin.from("system_backups").delete().eq("id", row.id);
  }
}

// Exposto para o endpoint público (cron) executar sem passar por RPC.
export async function runScheduledBackup(): Promise<{ id: string; sizeBytes: number }> {
  const r = await runBackup({ type: "scheduled", createdBy: null });
  return { id: r.id, sizeBytes: r.sizeBytes };
}

// ---------------------------------------------------------------------------
// Server functions expostas para a UI
// ---------------------------------------------------------------------------

export const createBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await cleanupStaleBackups(supabaseAdmin);

    // Reutiliza uma linha pendente/em execução recente do mesmo usuário
    // para evitar múltiplas linhas quando o cliente clica de novo.
    const cutoffIso = new Date(Date.now() - STALE_BACKUP_MS).toISOString();
    const { data: existingRow } = await supabaseAdmin
      .from("system_backups")
      .select("id, storage_path, status, created_at")
      .eq("created_by", context.userId)
      .in("status", ["pending", "running"])
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let backupId: string;
    let storagePath: string;
    if (existingRow?.id && existingRow.storage_path) {
      backupId = existingRow.id as string;
      storagePath = existingRow.storage_path as string;
    } else {
      const now = new Date();
      const filename = formatFilename(now);
      storagePath = storagePathFor(now, filename);
      const { data: rowIns, error: insErr } = await supabaseAdmin
        .from("system_backups")
        .insert({
          created_by: context.userId,
          type: "manual",
          status: "pending",
          storage_path: storagePath,
        })
        .select("id")
        .single();
      if (insErr || !rowIns) throw new Error(insErr?.message ?? "insert failed");
      backupId = rowIns.id as string;
    }

    const started = runBackup({
      type: "manual",
      createdBy: context.userId,
      existing: { id: backupId, storagePath },
    }).catch((err) => console.error("[backup] background run failed:", err));

    // Sempre devolvemos rápido. Se o runtime expõe waitUntil, o job continua
    // depois da resposta. Caso contrário, ainda disparamos fire-and-forget
    // e a UI faz polling / retomada via resumeBackup para completar.
    const deferred = deferWithWorkerContext(started);
    if (!deferred) {
      await persistBackupDebug(
        supabaseAdmin,
        backupId,
        [
          {
            at: new Date().toISOString(),
            level: "warn",
            phase: "initializing",
            message:
              "Runtime sem waitUntil — job disparado sem garantia de continuidade; UI pode retomar automaticamente.",
          },
        ],
      );
    }

    return {
      id: backupId,
      storagePath,
      sizeBytes: null,
      queued: true,
      deferred,
    };
  });

// ---------------------------------------------------------------------------
// Estimativa (preflight) — roda antes de iniciar o backup
// ---------------------------------------------------------------------------

export interface BackupEstimate {
  generatedAt: string;
  tables: { name: string; rows: number }[];
  totalRows: number;
  estimatedDatabaseBytes: number;
  storageFiles: number;
  storageBytes: number;
  storageListingTruncated: boolean;
  estimatedZipBytes: number;
  limits: {
    storageMaxFiles: number;
    storageMaxBytes: number;
    staleMs: number;
  };
  warnings: string[];
  exceedsLimits: boolean;
}

export const estimateBackup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackupEstimate> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tables: { name: string; rows: number }[] = [];
    let totalRows = 0;
    for (const t of BACKUP_TABLES) {
      try {
        const { count, error } = await supabaseAdmin
          .from(t)
          .select("*", { count: "exact", head: true });
        if (error) throw error;
        const rows = count ?? 0;
        tables.push({ name: t, rows });
        totalRows += rows;
      } catch (err) {
        console.warn(`[backup] estimate table ${t} failed:`, err);
        tables.push({ name: t, rows: 0 });
      }
    }

    let storageFiles = 0;
    let storageBytes = 0;
    let storageListingTruncated = false;
    // Limite total de nós visitados para não estourar o Worker em buckets
    // enormes — se atingir, marcamos truncated e usamos os dados parciais.
    const MAX_LIST_NODES = 5000;
    let visited = 0;
    try {
      const walk = async (prefix: string) => {
        if (storageListingTruncated) return;
        let offset = 0;
        const limit = 100;
        while (true) {
          if (storageListingTruncated) return;
          const { data, error } = await supabaseAdmin.storage
            .from("notion-html-originals")
            .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
          if (error) throw error;
          if (!data || data.length === 0) break;
          for (const item of data) {
            visited++;
            if (visited > MAX_LIST_NODES) {
              storageListingTruncated = true;
              return;
            }
            const isFolder = !item.id && !item.metadata;
            const path = prefix ? `${prefix}/${item.name}` : item.name;
            if (isFolder) {
              await walk(path);
            } else {
              storageFiles++;
              storageBytes += Number((item.metadata as any)?.size ?? 0);
            }
          }
          if (data.length < limit) break;
          offset += limit;
        }
      };
      await walk("");
    } catch (err) {
      console.warn("[backup] estimate storage listing failed:", err);
    }

    const estimatedDatabaseBytes = totalRows * ESTIMATED_BYTES_PER_ROW;
    const includedStorageBytes = Math.min(storageBytes, STORAGE_MIRROR_MAX_BYTES);
    // ZIP em modo STORE (sem compressão) ≈ soma dos conteúdos + ~2% de overhead.
    const estimatedZipBytes = Math.round(
      (estimatedDatabaseBytes + includedStorageBytes) * 1.02,
    );

    const warnings: string[] = [];
    let exceedsLimits = false;
    if (storageFiles > STORAGE_MIRROR_MAX_FILES) {
      exceedsLimits = true;
      warnings.push(
        `Bucket possui ${storageFiles.toLocaleString("pt-BR")} arquivos; o backup incluirá apenas os primeiros ${STORAGE_MIRROR_MAX_FILES.toLocaleString("pt-BR")}.`,
      );
    }
    if (storageBytes > STORAGE_MIRROR_MAX_BYTES) {
      exceedsLimits = true;
      const mb = Math.round(storageBytes / 1024 / 1024);
      const cap = Math.round(STORAGE_MIRROR_MAX_BYTES / 1024 / 1024);
      warnings.push(
        `Bucket possui ~${mb} MB; o backup incluirá apenas os primeiros ${cap} MB.`,
      );
    }
    if (storageListingTruncated) {
      warnings.push(
        `Listagem do bucket truncada em ${MAX_LIST_NODES} itens — o número real pode ser maior.`,
      );
    }
    if (totalRows > 500_000) {
      warnings.push(
        `${totalRows.toLocaleString("pt-BR")} linhas para exportar — o backup pode levar vários minutos e usar bastante memória do Worker.`,
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      tables,
      totalRows,
      estimatedDatabaseBytes,
      storageFiles,
      storageBytes,
      storageListingTruncated,
      estimatedZipBytes,
      limits: {
        storageMaxFiles: STORAGE_MIRROR_MAX_FILES,
        storageMaxBytes: STORAGE_MIRROR_MAX_BYTES,
        staleMs: STALE_BACKUP_MS,
      },
      warnings,
      exceedsLimits,
    };
  });

// Retoma um backup pending/running que ficou parado (Worker morto no meio).
// Idempotente: se o backup já concluiu ou falhou definitivamente, apenas
// retorna o status atual.
export const resumeBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("system_backups")
      .select("id, storage_path, status, updated_at, created_by")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Backup não encontrado.");
    if (row.status === "completed" || row.status === "failed") {
      return { id: row.id as string, status: row.status as string, queued: false };
    }
    if (!row.storage_path) throw new Error("Backup sem storage_path.");

    const started = runBackup({
      type: "manual",
      createdBy: (row.created_by as string | null) ?? context.userId,
      existing: { id: row.id as string, storagePath: row.storage_path as string },
    }).catch((err) => console.error("[backup] resume failed:", err));

    const deferred = deferWithWorkerContext(started);
    return { id: row.id as string, status: "running", queued: true, deferred };
  });

// removido: implementação original de createBackupNow substituída acima

export interface BackupRow {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string | null;
  type: "manual" | "scheduled";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  cancelRequested: boolean;
  storagePath: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  rowCounts: Record<string, number>;
  storageObjectCount: number;
  error: string | null;
  errorDetails: BackupErrorDetails | null;
  debugLog: BackupDebugEntry[];
  businessSummary: BusinessSummary | null;
}

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackupRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await cleanupStaleBackups(supabaseAdmin);
    const { data, error } = await supabaseAdmin
      .from("system_backups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      createdBy: r.created_by,
      type: r.type,
      status: r.status,
      cancelRequested: Boolean(r.cancel_requested),
      storagePath: r.storage_path,
      sizeBytes: r.size_bytes,
      durationMs: r.duration_ms,
      rowCounts: r.row_counts ?? {},
      storageObjectCount: r.storage_object_count ?? 0,
      error: r.error,
      errorDetails: r.error_details ?? null,
      debugLog: Array.isArray(r.debug_log) ? (r.debug_log as BackupDebugEntry[]) : [],
      businessSummary:
        r.business_summary && Object.keys(r.business_summary).length > 0
          ? (r.business_summary as BusinessSummary)
          : null,
    }));
  });

const idSchema = z.object({ id: z.string().uuid() });

export const getBackupDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("system_backups")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.storage_path) throw new Error("Backup sem arquivo disponível.");
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .createSignedUrl(row.storage_path, 60 * 10);
    if (signErr || !signed) throw new Error(signErr?.message ?? "sign failed");
    return { url: signed.signedUrl };
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("system_backups")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.storage_path) {
      await supabaseAdmin.storage.from(BACKUP_BUCKET).remove([row.storage_path]);
    }
    const { error } = await supabaseAdmin.from("system_backups").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Agendamento (pg_cron)
// ---------------------------------------------------------------------------

const JOB_NAME = "system-backup-daily";

export interface BackupScheduleInfo {
  active: boolean;
  frequency: "off" | "daily" | "weekly";
  cron: string | null;
  jobId: number | null;
}

export const getBackupSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackupScheduleInfo> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("get_system_backup_schedule");
    if (error) {
      // função ainda não existe (primeira execução)
      return { active: false, frequency: "off", cron: null, jobId: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { active: false, frequency: "off", cron: null, jobId: null };
    const cron: string = row.schedule ?? "";
    let frequency: BackupScheduleInfo["frequency"] = "off";
    if (/^0 3 \* \* \*$/.test(cron)) frequency = "daily";
    else if (/^0 3 \* \* 0$/.test(cron)) frequency = "weekly";
    return {
      active: Boolean(row.active),
      frequency,
      cron: cron || null,
      jobId: row.jobid ?? null,
    };
  });

const scheduleSchema = z.object({
  frequency: z.enum(["off", "daily", "weekly"]),
});

export const setBackupSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scheduleSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).rpc("set_system_backup_schedule", {
      _frequency: data.frequency,
      _job_name: JOB_NAME,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Resumo do banco vivo (para comparação com backup)
// ---------------------------------------------------------------------------

export const getCurrentBusinessSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BusinessSummary> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [clients, products, agreements, installments, nfInvoices, teamTasks, punchEntries] =
      await Promise.all([
        fetchAllRows(supabaseAdmin, "clients"),
        fetchAllRows(supabaseAdmin, "products"),
        fetchAllRows(supabaseAdmin, "mgmv_agreements"),
        fetchAllRows(supabaseAdmin, "mgmv_installments"),
        fetchAllRows(supabaseAdmin, "nf_invoices"),
        fetchAllRows(supabaseAdmin, "team_tasks"),
        fetchAllRows(supabaseAdmin, "team_punch_entries"),
      ]);
    return computeBusinessSummaryFromRows({
      clients,
      products,
      agreements,
      installments,
      nfInvoices,
      teamTasks,
      punchEntries,
    });
  });

// ---------------------------------------------------------------------------
// Restauração a partir de backup
// ---------------------------------------------------------------------------

// Tabelas restauráveis. Mantém a mesma ordem de dependência do backup.
// `user_roles` e `profiles` do próprio usuário logado ficam protegidos contra
// lockout — filtrados no handler.
const RESTORABLE_TABLES = BACKUP_TABLES.filter(
  (t) => t !== "audit_log" && t !== "import_progress",
);

export interface RestorePreview {
  ok: true;
  source: "backup" | "upload";
  filename: string;
  schemaVersion: number;
  generatedAt: string | null;
  rowCounts: Record<string, number>;
  storageObjectCount: number;
  businessSummary: BusinessSummary | null;
  current: BusinessSummary;
  availableTables: string[];
}

export interface RestoreResult {
  ok: true;
  mode: "merge" | "replace";
  tablesRestored: Array<{ table: string; inserted: number; skipped: number; deleted: number }>;
  storageFilesRestored: number;
  durationMs: number;
}

const restorePreviewSchema = z.object({
  backupId: z.string().uuid().optional(),
  uploadedZipBase64: z.string().optional(),
});

const restoreApplySchema = z.object({
  backupId: z.string().uuid().optional(),
  uploadedZipBase64: z.string().optional(),
  mode: z.enum(["merge", "replace"]),
  tables: z.array(z.string()).optional(),
  includeStorage: z.boolean().default(false),
  confirmReplace: z.string().optional(),
});

async function loadBackupZip(
  admin: any,
  opts: { backupId?: string; uploadedZipBase64?: string },
): Promise<{ zip: any; filename: string }> {
  const JSZip = (await import("jszip")).default;
  if (opts.backupId) {
    const { data: row, error } = await admin
      .from("system_backups")
      .select("storage_path")
      .eq("id", opts.backupId)
      .maybeSingle();
    if (error || !row?.storage_path) throw new Error("Backup não encontrado.");
    const { data: blob, error: dlErr } = await admin.storage
      .from(BACKUP_BUCKET)
      .download(row.storage_path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Falha ao baixar backup.");
    const buf = new Uint8Array(await blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    return { zip, filename: row.storage_path.split("/").pop() ?? "backup.zip" };
  }
  if (opts.uploadedZipBase64) {
    const raw = opts.uploadedZipBase64.includes(",")
      ? opts.uploadedZipBase64.split(",", 2)[1]
      : opts.uploadedZipBase64;
    const bin = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (bin.byteLength > 250 * 1024 * 1024) {
      throw new Error("Arquivo maior que 250 MB.");
    }
    const zip = await JSZip.loadAsync(bin);
    return { zip, filename: "upload.zip" };
  }
  throw new Error("Informe um backupId ou faça upload do ZIP.");
}

async function readManifest(zip: any): Promise<{
  schemaVersion: number;
  generatedAt: string | null;
  rowCounts: Record<string, number>;
  storageObjectCount: number;
  businessSummary: BusinessSummary | null;
}> {
  const mf = zip.file("manifest.json");
  if (!mf) throw new Error("manifest.json ausente — arquivo não parece um backup Star Games.");
  const text = await mf.async("string");
  const parsed = JSON.parse(text);
  const version = Number(parsed.schemaVersion ?? 1);
  if (version < 1 || version > BACKUP_SCHEMA_VERSION) {
    throw new Error(`Versão de schema incompatível: ${version}`);
  }
  return {
    schemaVersion: version,
    generatedAt: parsed.generatedAt ?? null,
    rowCounts: parsed.rowCounts ?? {},
    storageObjectCount: Number(parsed.storageObjectCount ?? 0),
    businessSummary: parsed.businessSummary ?? null,
  };
}

async function loadTableRows(zip: any, table: string): Promise<any[]> {
  const f = zip.file(`database/data/${table}.jsonl`);
  if (!f) return [];
  const text = await f.async("string");
  if (!text.trim()) return [];
  const rows: any[] = [];
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

export const previewBackupRestore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => restorePreviewSchema.parse(d))
  .handler(async ({ data, context }): Promise<RestorePreview> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { zip, filename } = await loadBackupZip(supabaseAdmin, data);
    const manifest = await readManifest(zip);

    // Se o backup for antigo (sem businessSummary), calcula na hora a partir do ZIP.
    let summary = manifest.businessSummary;
    if (!summary) {
      const [clients, products, agreements, installments, nfInvoices, teamTasks, punchEntries] =
        await Promise.all([
          loadTableRows(zip, "clients"),
          loadTableRows(zip, "products"),
          loadTableRows(zip, "mgmv_agreements"),
          loadTableRows(zip, "mgmv_installments"),
          loadTableRows(zip, "nf_invoices"),
          loadTableRows(zip, "team_tasks"),
          loadTableRows(zip, "team_punch_entries"),
        ]);
      summary = computeBusinessSummaryFromRows({
        clients,
        products,
        agreements,
        installments,
        nfInvoices,
        teamTasks,
        punchEntries,
      });
    }

    // Estado atual do banco vivo
    const [clients, products, agreements, installments, nfInvoices, teamTasks, punchEntries] =
      await Promise.all([
        fetchAllRows(supabaseAdmin, "clients"),
        fetchAllRows(supabaseAdmin, "products"),
        fetchAllRows(supabaseAdmin, "mgmv_agreements"),
        fetchAllRows(supabaseAdmin, "mgmv_installments"),
        fetchAllRows(supabaseAdmin, "nf_invoices"),
        fetchAllRows(supabaseAdmin, "team_tasks"),
        fetchAllRows(supabaseAdmin, "team_punch_entries"),
      ]);
    const current = computeBusinessSummaryFromRows({
      clients,
      products,
      agreements,
      installments,
      nfInvoices,
      teamTasks,
      punchEntries,
    });

    const availableTables = RESTORABLE_TABLES.filter((t) => Boolean(zip.file(`database/data/${t}.jsonl`)));

    return {
      ok: true,
      source: data.backupId ? "backup" : "upload",
      filename,
      schemaVersion: manifest.schemaVersion,
      generatedAt: manifest.generatedAt,
      rowCounts: manifest.rowCounts,
      storageObjectCount: manifest.storageObjectCount,
      businessSummary: summary,
      current,
      availableTables,
    };
  });

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => restoreApplySchema.parse(d))
  .handler(async ({ data, context }): Promise<RestoreResult> => {
    await assertAdmin(context);
    if (data.mode === "replace" && data.confirmReplace !== "REPLACE") {
      throw new Error('Para o modo "Substituir tudo" digite REPLACE para confirmar.');
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const started = Date.now();
    const { zip } = await loadBackupZip(supabaseAdmin, data);
    await readManifest(zip);

    const requested = data.tables && data.tables.length > 0
      ? new Set(data.tables)
      : new Set(RESTORABLE_TABLES);

    const tablesToProcess = RESTORABLE_TABLES.filter((t) => requested.has(t));

    const results: RestoreResult["tablesRestored"] = [];

    // REPLACE: apaga em ordem reversa (dependentes primeiro)
    if (data.mode === "replace") {
      for (const table of [...tablesToProcess].reverse()) {
        let query = supabaseAdmin.from(table).delete();
        // Protege o admin logado
        if (table === "user_roles" || table === "profiles") {
          query = query.neq("user_id" as any, context.userId).neq("id" as any, context.userId);
        }
        // .delete() do PostgREST exige um filtro; usa neq id impossível como fallback.
        const { error } = await query.neq("id" as any, "00000000-0000-0000-0000-000000000000");
        if (error) {
          console.warn(`[restore] delete ${table}:`, error.message);
        }
      }
    }

    // Insere/upsert em ordem normal
    for (const table of tablesToProcess) {
      const rows = await loadTableRows(zip, table);
      let filtered = rows;
      if (table === "user_roles") {
        filtered = rows.filter((r) => r.user_id !== context.userId);
      } else if (table === "profiles") {
        filtered = rows.filter((r) => r.id !== context.userId);
      }
      let inserted = 0;
      let skipped = 0;
      const CHUNK = 500;
      for (let i = 0; i < filtered.length; i += CHUNK) {
        const chunk = filtered.slice(i, i + CHUNK);
        const { error } = await supabaseAdmin.from(table).upsert(chunk, {
          onConflict: "id",
          ignoreDuplicates: false,
        } as any);
        if (error) {
          console.warn(`[restore] upsert ${table} (chunk ${i}):`, error.message);
          skipped += chunk.length;
        } else {
          inserted += chunk.length;
        }
      }
      results.push({ table, inserted, skipped, deleted: data.mode === "replace" ? rows.length : 0 });
    }

    // Storage: reenvia arquivos originais
    let storageFilesRestored = 0;
    if (data.includeStorage) {
      const storageFiles = Object.values(zip.files).filter(
        (f: any) => !f.dir && f.name.startsWith("storage/notion-html-originals/"),
      );
      for (const f of storageFiles as any[]) {
        const rel = f.name.replace("storage/notion-html-originals/", "");
        const bytes = await f.async("uint8array");
        const { error } = await supabaseAdmin.storage
          .from("notion-html-originals")
          .upload(rel, bytes, { upsert: true });
        if (!error) storageFilesRestored++;
      }
    }

    // Registra no import_history
    try {
      await supabaseAdmin.from("import_history").insert({
        date: new Date().toISOString(),
        source: "backup-restore",
        file: data.backupId ? `backup:${data.backupId}` : "upload.zip",
        clients_created: 0,
        products_added: 0,
        errors: results.reduce((s, r) => s + r.skipped, 0),
        status: "success",
      } as any);
    } catch (err) {
      console.warn("[restore] import_history log failed:", err);
    }

    return {
      ok: true,
      mode: data.mode,
      tablesRestored: results,
      storageFilesRestored,
      durationMs: Date.now() - started,
    };
  });
