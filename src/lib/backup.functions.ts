import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLONE_ORDER, SANDBOX_TABLES, remapRow, type CloneTable } from "@/lib/sandbox-clone";
import {
  RESTORE_KEY_COLUMNS,
  dedupeRestoreRows,
  restoreRowKey,
} from "@/lib/backup-restore-keys";
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
// Retomada só é segura quando não há nenhum sinal de vida recente. Antes disso,
// um novo run concorrente pode sobrescrever logs de um backup que ainda está vivo.
const RESUME_STALE_MS = 90 * 1000;
const STORAGE_MIRROR_MAX_BYTES = 500 * 1024 * 1024;
const STORAGE_MIRROR_MAX_FILES = 10_000;
const BACKUP_RETENTION_COUNT = 3;
const BACKUP_RETENTION_BYTES = 1024 * 1024 * 1024;
const FAILED_BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// Heurística: cada linha ocupa ~800 bytes em JSONL (chaves + valores).
const ESTIMATED_BYTES_PER_ROW = 800;

// ---------------------------------------------------------------------------
// Execução em etapas (à prova de timeout)
// ---------------------------------------------------------------------------
// Cada execução do Worker exporta o quanto couber dentro do orçamento de
// tempo, grava o progresso e agenda a continuação. Nenhuma execução isolada
// precisa terminar o backup inteiro — por isso não há mais timeout.
const RUN_TIME_BUDGET_MS = 45_000;
/** Linhas por bloco gravado no armazenamento intermediário. */
const PART_CHUNK_ROWS = 20_000;
/** Teto por tabela e teto global (avisam em vez de falhar). */
export const MAX_ROWS_PER_TABLE = 300_000;
export const MAX_TOTAL_ROWS = 1_000_000;
const PARTS_PREFIX = "_parts";

interface BackupPartState {
  chunks: string[];
  rows: number;
  bytes: number;
  crcState: number;
  offset: number;
  done: boolean;
  capped?: boolean;
  skipped?: boolean;
}

interface BackupProgress {
  version: 2;
  parts: Record<string, BackupPartState>;
  totalRows: number;
  paused?: boolean;
  pausedAt?: string;
  runs?: number;
}

function emptyProgress(): BackupProgress {
  return { version: 2, parts: {}, totalRows: 0, runs: 0 };
}

function normalizeProgress(value: unknown): BackupProgress {
  const p = value as BackupProgress | null;
  if (!p || typeof p !== "object" || p.version !== 2 || !p.parts) return emptyProgress();
  return p;
}

function partPath(backupId: string, table: string, index: number): string {
  return `${PARTS_PREFIX}/${backupId}/${table}.${String(index).padStart(4, "0")}.jsonl`;
}

/** URL estável usada para o backup continuar sozinho na próxima execução. */
function continuationUrl(): string {
  const base =
    process.env["BACKUP_HOOK_URL"] ??
    "https://project--9675ace6-1d0a-4259-a33a-8378153df5fa.lovable.app/api/public/hooks/backup-run";
  return base;
}

/** Dispara a continuação do backup sem bloquear a execução atual. */
async function scheduleContinuation(backupId: string): Promise<boolean> {
  const apikey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "";
  if (!apikey) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    await fetch(continuationUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ type: "continue", backupId }),
      signal: controller.signal,
    }).catch(() => undefined);
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

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
  "sandbox_import_audit",
  "system_backups",
  "sandbox_state",
  "active_sessions",
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

async function appendBackupDebug(
  admin: any,
  backupId: string,
  entries: BackupDebugEntry[],
  patch: Record<string, unknown> = {},
) {
  try {
    const { data } = await admin
      .from("system_backups")
      .select("debug_log")
      .eq("id", backupId)
      .maybeSingle();
    const existing = Array.isArray(data?.debug_log)
      ? (data.debug_log as BackupDebugEntry[])
      : [];
    await admin
      .from("system_backups")
      .update({ debug_log: [...existing, ...entries].slice(-120), ...patch } as any)
      .eq("id", backupId);
  } catch (err) {
    console.warn("[backup] failed to append debug log:", err);
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

/** Data/hora no fuso de Brasília, para nomes de arquivo legíveis. */
function brParts(date: Date) {
  const br = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return {
    dia: pad(br.getUTCDate()),
    mes: pad(br.getUTCMonth() + 1),
    ano: String(br.getUTCFullYear()),
    hora: pad(br.getUTCHours()),
    min: pad(br.getUTCMinutes()),
  };
}

/**
 * Nome legível: `stargames-producao-31-07-2026-as-03h33.zip`
 * (data e hora de Brasília em que o backup foi gerado).
 */
export function formatFilename(
  now = new Date(),
  env: "producao" | "sandbox" = "producao",
): string {
  const label = env === "sandbox" ? "teste" : "producao";
  const { dia, mes, ano, hora, min } = brParts(now);
  return `stargames-${label}-${dia}-${mes}-${ano}-as-${hora}h${min}.zip`;
}

// Cada ambiente grava em sua própria pasta: um backup de teste nunca fica
// misturado com os de produção no armazenamento.
function storagePathFor(
  now: Date,
  filename: string,
  env: "producao" | "sandbox" = "producao",
): string {
  return `${env}/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${filename}`;
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

/** Coluna estável usada para ordenar a paginação de cada tabela. */
function orderKeyFor(table: string): string {
  if (table === "ai_training_profile") return "user_id";
  if (table === "active_sessions" || table === "sandbox_state") return "user_id";
  return "id";
}

// Tabelas de log crescem indefinidamente. O backup agora exporta o histórico
// COMPLETO delas: a gravação é feita em blocos (nada é acumulado inteiro em
// memória) e só existe um teto de segurança bem alto para o caso de uma tabela
// crescer fora de qualquer expectativa — se ele for atingido, o backup avisa.
//
// `columns` é uma lista de candidatas: cada tabela de log usa um nome
// diferente para a data (audit_log usa changed_at, as demais created_at) e o
// nome pode mudar em migrações futuras. O backup detecta em tempo de execução
// qual existe apenas para ordenar a paginação de forma estável.
const LOG_SAFETY_MAX_ROWS = 1_000_000;

const LOG_TABLE_LIMITS: Record<string, { maxRows: number; days: number | null; columns: string[] }> = {
  audit_log: { maxRows: LOG_SAFETY_MAX_ROWS, days: null, columns: ["changed_at", "created_at"] },
  notion_html_access_log: { maxRows: LOG_SAFETY_MAX_ROWS, days: null, columns: ["created_at"] },
  team_task_activity: { maxRows: LOG_SAFETY_MAX_ROWS, days: null, columns: ["created_at"] },
};

const logColumnCache = new Map<string, string | null>();

/** Descobre qual coluna de data existe na tabela de log (ou null). */
async function resolveLogColumn(
  admin: any,
  table: string,
  candidates: string[],
): Promise<string | null> {
  if (logColumnCache.has(table)) return logColumnCache.get(table) ?? null;
  for (const column of candidates) {
    const { error } = await admin.from(table).select(column).limit(1);
    if (!error) {
      logColumnCache.set(table, column);
      return column;
    }
  }
  logColumnCache.set(table, null);
  return null;
}

/** Chaves de estado de tela que guardam texto digitado em busca. */
const SEARCH_STATE_KEYS = new Set(["search", "searchTerm", "query", "globalSearch"]);

function stripSearchKeys(value: unknown, depth = 0): unknown {
  if (Array.isArray(value) || typeof value !== "object" || value === null || depth > 4) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const leaf = k.split(".").pop() ?? k;
    if (SEARCH_STATE_KEYS.has(leaf)) continue;
    out[k] = stripSearchKeys(v, depth + 1);
  }
  return out;
}

/**
 * Termos digitados em busca (navbar e filtros) nunca saem no backup — nem em
 * produção, nem no Modo Teste. Vale para o estado de tela das configurações e
 * para o histórico de auditoria.
 */
function stripSearchNoise(table: string, row: any): any {
  if (!row || typeof row !== "object") return row;
  if (table === "app_settings" && row.ui_state) {
    return { ...row, ui_state: stripSearchKeys(row.ui_state) };
  }
  if (table === "audit_log" && row.table_name === "app_settings") {
    const clean = { ...row };
    if (clean.old_data && typeof clean.old_data === "object") {
      const { ui_state: _o, ...rest } = clean.old_data as Record<string, unknown>;
      clean.old_data = rest;
    }
    if (clean.new_data && typeof clean.new_data === "object") {
      const { ui_state: _n, ...rest } = clean.new_data as Record<string, unknown>;
      clean.new_data = rest;
    }
    return clean;
  }
  return row;
}

async function fetchAllRows(
  admin: any,
  table: BackupTable,
  batchSize = 1000,
  env?: "producao" | "sandbox",
  sandboxOwner?: string | null,
): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = admin.from(table).select("*");
    if (env && ENV_SCOPED_TABLES.has(table)) {
      query = query.eq("env", env);
      // Cada usuário tem o próprio sandbox: nunca lê o de outro.
      if (env === "sandbox" && sandboxOwner) query = query.eq("sandbox_owner", sandboxOwner);
    }
    const { data, error } = await query
      .order(orderKeyFor(table), { ascending: true })
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data.map((r: any) => stripSearchNoise(table, r)));
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return out;
}

async function fetchRowsForBackup(
  admin: any,
  table: BackupTable,
  opts: {
    batchSize?: number;
    keepRows?: boolean;
    env?: "producao" | "sandbox";
    sandboxOwner?: string | null;
    onBatch?: (rowCount: number) => Promise<void>;
  } = {},
): Promise<{
  rowCount: number;
  jsonl: string;
  rows?: any[];
  truncated?: boolean;
  windowSkipped?: boolean;
}> {
  const limit = LOG_TABLE_LIMITS[table];
  // Sem coluna de data válida, a janela por período é ignorada e a tabela sai
  // limitada só por quantidade — o backup segue em frente.
  const dateColumn = limit ? await resolveLogColumn(admin, table, limit.columns) : null;
  // Sem janela por período não há nada a "pular": o histórico sai completo.
  const windowSkipped = Boolean(limit?.days) && !dateColumn;
  const batchSize = Math.min(opts.batchSize ?? 1000, limit?.maxRows ?? 1000);
  const rowsToKeep: any[] | undefined = opts.keepRows ? [] : undefined;
  const chunks: string[] = [];
  let from = 0;
  let rowCount = 0;
  let truncated = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = admin.from(table).select("*");
    // O backup é sempre de UM ambiente (produção ou teste). Sem este filtro,
    // as tabelas com coluna `env` sairiam somadas (produção + sandbox).
    if (opts.env && ENV_SCOPED_TABLES.has(table)) {
      query = query.eq("env", opts.env);
      if (opts.env === "sandbox" && opts.sandboxOwner) {
        query = query.eq("sandbox_owner", opts.sandboxOwner);
      }
    }
    if (limit && limit.days && dateColumn) {
      const since = new Date(Date.now() - limit.days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte(dateColumn, since);
    }
    // Paginação sem ordenação pode repetir/pular linhas em tabelas grandes.
    const useDateOrder = Boolean(limit?.days && dateColumn);
    const { data, error } = await query
      .order(useDateOrder ? (dateColumn as string) : orderKeyFor(table), {
        ascending: !useDateOrder,
      })
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;

    const sanitized = data.map((r: any) => stripSearchNoise(table, r));
    const batchJsonl = sanitized.map((r: any) => JSON.stringify(r)).join("\n");
    if (batchJsonl) chunks.push(rowCount === 0 ? batchJsonl : `\n${batchJsonl}`);
    if (rowsToKeep) rowsToKeep.push(...sanitized);
    rowCount += data.length;
    if (opts.onBatch) await opts.onBatch(rowCount);
    if (data.length < batchSize) break;
    if (limit && rowCount >= limit.maxRows) {
      truncated = true;
      break;
    }
    from += batchSize;
  }
  return { rowCount, jsonl: chunks.join(""), rows: rowsToKeep, truncated, windowSkipped };
}

async function cleanupStaleBackups(admin: any) {
  const cutoff = new Date(Date.now() - STALE_BACKUP_MS).toISOString();
  const { data: staleRows } = await admin
    .from("system_backups")
    .select("id, debug_log, error_details, created_at")
    .in("status", ["pending", "running"])
    .lt("updated_at", cutoff);
  for (const row of staleRows ?? []) {
    // Backups em etapas guardam o progresso: enquanto forem recentes,
    // continuam retomáveis em vez de virarem falha.
    const resumable = Boolean((row as any).error_details?.resume?.paused);
    const ageMs = row.created_at ? Date.now() - Date.parse(row.created_at as string) : 0;
    if (resumable && ageMs < 6 * 60 * 60 * 1000) continue;
    const entry: BackupDebugEntry = {
      at: new Date().toISOString(),
      level: "error",
      phase: "timeout",
      message: "Backup sem sinal de vida recente. Use Tentar novamente para gerar um novo arquivo.",
      elapsedMs: STALE_BACKUP_MS,
    };
    const existing = Array.isArray(row.debug_log)
      ? (row.debug_log as BackupDebugEntry[])
      : [];
    await admin
      .from("system_backups")
      .update({
      status: "failed",
      error: "Backup sem sinal de vida recente. Use Tentar novamente para gerar um novo arquivo.",
      error_details: {
        message: "Backup sem sinal de vida recente. Use Tentar novamente para gerar um novo arquivo.",
        phase: "timeout",
        elapsedMs: STALE_BACKUP_MS,
      },
      debug_log: [...existing, entry].slice(-120),
      finished_at: new Date().toISOString(),
    } as any)
      .eq("id", row.id);
  }
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

/**
 * Exporta uma tabela em blocos gravados no armazenamento intermediário,
 * respeitando o orçamento de tempo da execução atual. Retorna com
 * `state.done = false` quando o tempo acaba — a próxima execução continua
 * exatamente da linha seguinte.
 */
async function exportTableInChunks(
  admin: any,
  opts: {
    backupId: string;
    table: string;
    env: "producao" | "sandbox";
    sandboxOwner?: string | null;
    state: BackupPartState;
    deadline: number;
    onProgress?: (rows: number) => Promise<void>;
  },
): Promise<void> {
  const { crc32Update } = await import("@/lib/zip-store-writer");
  const { table, state, deadline } = opts;
  const batchSize = 1000;
  const encoder = new TextEncoder();
  const limit = LOG_TABLE_LIMITS[table];
  const dateColumn = limit ? await resolveLogColumn(admin, table, limit.columns) : null;
  let buffer: string[] = [];
  let bufferRows = 0;

  const flush = async () => {
    if (bufferRows === 0) return;
    const text = (state.rows === bufferRows ? "" : "\n") + buffer.join("\n");
    const bytes = encoder.encode(text);
    const path = partPath(opts.backupId, table, state.chunks.length);
    const { error } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(path, bytes, { contentType: "application/x-ndjson", upsert: true });
    if (error) throw new Error(`[${table}] ${error.message}`);
    state.chunks.push(path);
    state.bytes += bytes.byteLength;
    state.crcState = crc32Update(state.crcState, bytes);
    buffer = [];
    bufferRows = 0;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = admin.from(table).select("*");
    // O backup é sempre de UM ambiente: sem este filtro produção e teste
    // sairiam somados no mesmo arquivo.
    if (ENV_SCOPED_TABLES.has(table)) {
      query = query.eq("env", opts.env);
      // Sandbox é individual: o backup leva apenas o ambiente do próprio usuário.
      if (opts.env === "sandbox" && opts.sandboxOwner) {
        query = query.eq("sandbox_owner", opts.sandboxOwner);
      }
    }
    const { data, error } = await query
      .order(dateColumn ?? orderKeyFor(table), { ascending: true })
      .range(state.offset, state.offset + batchSize - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) {
      await flush();
      state.done = true;
      return;
    }
    for (const row of data) buffer.push(JSON.stringify(stripSearchNoise(table, row)));
    bufferRows += data.length;
    state.rows += data.length;
    state.offset += data.length;
    if (opts.onProgress) await opts.onProgress(state.rows);
    if (bufferRows >= PART_CHUNK_ROWS) await flush();
    if (data.length < batchSize) {
      await flush();
      state.done = true;
      return;
    }
    if (state.rows >= MAX_ROWS_PER_TABLE) {
      await flush();
      state.capped = true;
      state.done = true;
      return;
    }
    if (Date.now() >= deadline) {
      await flush();
      return; // pausa: continua na próxima execução
    }
  }
}

/** Recarrega as linhas já exportadas de uma tabela (usado pelo resumo). */
async function loadPartRows(admin: any, state: BackupPartState | undefined): Promise<any[]> {
  if (!state) return [];
  const rows: any[] = [];
  for (const path of state.chunks) {
    const { data, error } = await admin.storage.from(BACKUP_BUCKET).download(path);
    if (error) throw new Error(error.message);
    const text = await data.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rows.push(JSON.parse(trimmed));
      } catch {
        /* linha corrompida é ignorada no resumo */
      }
    }
  }
  return rows;
}

async function cleanupBackupParts(admin: any, progress: BackupProgress) {
  const paths = Object.values(progress.parts).flatMap((state) => state.chunks);
  if (paths.length === 0) return;
  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage.from(BACKUP_BUCKET).remove(paths.slice(i, i + 100));
  }
}

async function runBackup(opts: {
  type: "manual" | "scheduled";
  createdBy: string | null;
  env?: "producao" | "sandbox";
  existing?: { id: string; storagePath: string };
}): Promise<{ id: string; storagePath: string; sizeBytes: number; incomplete?: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const {
    toZipBytes,
    crc32Init,
    crc32Update,
    crc32Final,
    zipLocalHeader,
    zipCentralDirectory,
  } = await import("@/lib/zip-store-writer");

  await cleanupStaleBackups(supabaseAdmin);

  // Backup sempre pertence a um único ambiente. Sem ambiente explícito
  // (cron), assume produção.
  const backupEnv: "producao" | "sandbox" = opts.env ?? "producao";
  const now = new Date();
  const filename = formatFilename(now, backupEnv);
  const storagePath = opts.existing?.storagePath ?? storagePathFor(now, filename, backupEnv);
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
  let progress: BackupProgress = emptyProgress();
  if (opts.existing) {
    backupId = opts.existing.id;
    const { data: existingRow } = await supabaseAdmin
      .from("system_backups")
      .select("debug_log, error_details")
      .eq("id", backupId)
      .maybeSingle();
    debugLog.push(
      ...(Array.isArray(existingRow?.debug_log)
        ? (existingRow.debug_log as unknown as BackupDebugEntry[])
        : []),
    );
    progress = normalizeProgress((existingRow?.error_details as any)?.resume);
    pushDebug("info", "initializing", "Retomada do backup iniciada", {
      type: opts.type,
      mode: "resume",
      rowsAlreadyExported: progress.totalRows,
    });
    const { error: startErr } = await supabaseAdmin
      .from("system_backups")
      .update({ status: "running", error: null, error_details: null, debug_log: debugLog } as any)
      .eq("id", backupId);
    if (startErr) throw new Error(startErr.message);
  } else {
    pushDebug("info", "initializing", "Backup iniciado", {
      type: opts.type,
      mode: "new",
      env: backupEnv,
    });
    const { data: rowIns, error: insErr } = await supabaseAdmin
      .from("system_backups")
      .insert({
        created_by: opts.createdBy,
        type: opts.type,
        status: "running",
        storage_path: storagePath,
        debug_log: debugLog,
        env: backupEnv,
      } as any)
      .select("id")
      .single();
    if (insErr || !rowIns) throw new Error(insErr?.message ?? "insert failed");
    backupId = rowIns.id as string;
  }

  const deadline = startedAt + RUN_TIME_BUDGET_MS;

  try {
    pushDebug("info", "zip:create", "Preparando pacote do backup");
    await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    const zipEntries: Array<{ path: string; data: Uint8Array }> = [];
    const zip = {
      file: (path: string, data: string | Uint8Array | ArrayBuffer) => {
        zipEntries.push({ path, data: toZipBytes(data) });
      },
    };
    const rowCounts: Record<string, number> = {};
    for (const [table, state] of Object.entries(progress.parts)) {
      rowCounts[table] = state.rows;
    }

    // Exportação em etapas: cada tabela é gravada em blocos no armazenamento
    // intermediário. Quando o orçamento de tempo acaba, o backup pausa,
    // guarda a posição exata e continua na execução seguinte.
    let paused = false;
    for (const table of BACKUP_TABLES) {
      let state = progress.parts[table];
      if (!state) {
        state = {
          chunks: [],
          rows: 0,
          bytes: 0,
          crcState: crc32Init(),
          offset: 0,
          done: false,
        };
        progress.parts[table] = state;
      }
      if (state.done) {
        rowCounts[table] = state.rows;
        continue;
      }
      phase = `database:${table}`;
      if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
      pushDebug("info", `database:${table}`, `Exportando tabela ${table}…`, {
        started: true,
        alreadyExported: state.rows,
      });
      await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
        row_counts: rowCounts,
        error_details: { resume: progress } as any,
      });
      let lastBatchLogAt = 0;
      try {
        await exportTableInChunks(supabaseAdmin, {
          backupId,
          table,
          env: backupEnv,
          sandboxOwner: context.userId,
          state,
          deadline,
          onProgress: async (rows) => {
            if (await isCancellationRequested(supabaseAdmin, backupId)) {
              throw new BackupCancelledError();
            }
            const nowMs = Date.now();
            if (nowMs - lastBatchLogAt < 2500) return;
            lastBatchLogAt = nowMs;
            rowCounts[table] = rows;
            pushDebug(
              "info",
              `database:${table}`,
              `Exportando ${table}: ${rows.toLocaleString("pt-BR")} linhas lidas`,
              { rows, progress: true },
            );
            await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
              row_counts: rowCounts,
              error_details: { resume: progress } as any,
            });
          },
        });
      } catch (err) {
        if (err instanceof BackupCancelledError) throw err;
        // Tabelas de log/diagnóstico nunca podem derrubar o backup inteiro:
        // o que importa são os dados de negócio.
        if (!LOG_TABLE_LIMITS[table]) throw err;
        const message = err instanceof Error ? err.message : String(err);
        state.done = true;
        state.skipped = true;
        pushDebug(
          "warn",
          `database:${table}`,
          `Não foi possível exportar o histórico ${table}; o backup segue sem essa tabela (${message})`,
          { skipped: true },
        );
      }
      rowCounts[table] = state.rows;
      progress.totalRows = Object.values(progress.parts).reduce((acc, s) => acc + s.rows, 0);
      if (state.done) {
        pushDebug("info", `database:${table}`, `Tabela ${table} exportada`, {
          rows: state.rows,
          completed: true,
        });
        if (state.capped) {
          pushDebug(
            "warn",
            `database:${table}`,
            `Tabela ${table} atingiu o teto de ${MAX_ROWS_PER_TABLE.toLocaleString("pt-BR")} linhas por tabela; o restante ficou de fora deste backup`,
            { truncated: true, rows: state.rows },
          );
        }
      }
      await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
        row_counts: rowCounts,
        error_details: { resume: progress } as any,
      });
      if (!state.done) {
        paused = true;
        break;
      }
      if (progress.totalRows >= MAX_TOTAL_ROWS) {
        pushDebug(
          "warn",
          "database",
          `Teto global de ${MAX_TOTAL_ROWS.toLocaleString("pt-BR")} linhas atingido; as tabelas restantes ficaram de fora deste backup`,
          { truncated: true, rows: progress.totalRows },
        );
        break;
      }
    }

    if (paused) {
      progress.paused = true;
      progress.pausedAt = new Date().toISOString();
      pushDebug(
        "info",
        "paused",
        `Etapa parcial concluída (${progress.totalRows.toLocaleString("pt-BR")} linhas exportadas). O backup continua automaticamente de onde parou.`,
        { rows: progress.totalRows, resume: true },
      );
      await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
        row_counts: rowCounts,
        error_details: { resume: progress } as any,
        status: "running",
      });
      await scheduleContinuation(backupId);
      return { id: backupId, storagePath, sizeBytes: 0, incomplete: true };
    }
    progress.paused = false;

    // Storage: notion-html-originals
    let storageObjectCount = 0;
    let storageSkippedReason: string | null = null;
    if (backupEnv === "sandbox") {
      // No Modo Teste o acervo de arquivos é o mesmo da produção e só de
      // leitura — espelhar de novo só inflaria o backup sem trazer dado novo.
      storageSkippedReason = "sandbox";
      pushDebug(
        "info",
        "storage:notion-html-originals",
        "Arquivos originais não incluídos: no Modo Teste o acervo é compartilhado e somente leitura",
        { skipped: true },
      );
      await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    } else {
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
        completed: true,
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
    }

    pushDebug("info", "summary", "Calculando resumo de negócio");
    if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
    await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    const businessSummary = computeBusinessSummaryFromRows({
      clients: await loadPartRows(supabaseAdmin, progress.parts["clients"]),
      products: await loadPartRows(supabaseAdmin, progress.parts["products"]),
      agreements: await loadPartRows(supabaseAdmin, progress.parts["mgmv_agreements"]),
      installments: await loadPartRows(supabaseAdmin, progress.parts["mgmv_installments"]),
      nfInvoices: await loadPartRows(supabaseAdmin, progress.parts["nf_invoices"]),
      teamTasks: await loadPartRows(supabaseAdmin, progress.parts["team_tasks"]),
      punchEntries: await loadPartRows(supabaseAdmin, progress.parts["team_punch_entries"]),
    });

    const manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      type: opts.type,
      env: backupEnv,
      rowCounts,
      storageObjectCount,
      storageSkippedReason,
      tables: BACKUP_TABLES,
      // Tudo é exportado; estas voltam apenas como histórico consultável,
      // porque restaurá-las sobrescreveria estado vivo do sistema.
      historyOnlyTables: [...HISTORY_ONLY_TABLES],
      productionOnlyTables: [...PRODUCTION_ONLY_TABLES],
      buckets: storageSkippedReason ? [] : ["notion-html-originals"],
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
    // Montagem do ZIP a partir dos blocos já gravados: os dados nunca são
    // recompactados nem duplicados em memória de uma vez só.
    const pieces: Array<Uint8Array | Blob> = [];
    const directory: Array<{ path: string; crc: number; size: number; localOffset: number }> = [];
    let zipOffset = 0;
    const addZipEntry = (
      path: string,
      crc: number,
      size: number,
      bodies: Array<Uint8Array | Blob>,
    ) => {
      const header = zipLocalHeader({ path, crc, size }, now);
      pieces.push(header);
      directory.push({ path, crc, size, localOffset: zipOffset });
      zipOffset += header.byteLength + size;
      for (const body of bodies) pieces.push(body);
    };

    const tableNames = Object.keys(progress.parts);
    let zipDone = 0;
    const totalZipEntries = tableNames.length + zipEntries.length;
    for (const table of tableNames) {
      if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
      const state = progress.parts[table]!;
      const bodies: Blob[] = [];
      for (const path of state.chunks) {
        const { data, error } = await supabaseAdmin.storage.from(BACKUP_BUCKET).download(path);
        if (error) throw new Error(`[${table}] ${error.message}`);
        bodies.push(data);
      }
      addZipEntry(
        `database/data/${table}.jsonl`,
        crc32Final(state.crcState),
        state.bytes,
        bodies,
      );
      zipDone++;
      pushDebug("info", "zip:generate", "Montando arquivos do backup", {
        percent: Math.round((zipDone / Math.max(1, totalZipEntries)) * 100),
        entries: totalZipEntries,
        currentFile: `database/data/${table}.jsonl`,
      });
      await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
        business_summary: businessSummary as any,
      });
    }
    for (const entry of zipEntries) {
      addZipEntry(
        entry.path,
        crc32Final(crc32Update(crc32Init(), entry.data)),
        entry.data.byteLength,
        [entry.data],
      );
      zipDone++;
    }
    pieces.push(zipCentralDirectory(directory, now, zipOffset));
    const zipBlob = new Blob(pieces as BlobPart[], { type: "application/zip" });
    const zipBuf = { byteLength: zipBlob.size };
    pushDebug("info", "zip:generate", "ZIP gerado", {
      percent: 100,
      entries: totalZipEntries,
      sizeBytes: zipBuf.byteLength,
    });
    await persistBackupDebug(supabaseAdmin, backupId, debugLog, {
      business_summary: businessSummary as any,
    });

    pushDebug("info", "storage:upload", "Enviando ZIP para o armazenamento privado", {
      sizeBytes: zipBuf.byteLength,
    });
    if (await isCancellationRequested(supabaseAdmin, backupId)) throw new BackupCancelledError();
    await persistBackupDebug(supabaseAdmin, backupId, debugLog);
    const { error: upErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, zipBlob, {
        contentType: "application/zip",
        upsert: true,
      });
    if (upErr) throw new Error(upErr.message);

    const pathParts = storagePath.split("/");
    const uploadedName = pathParts.pop();
    const uploadedFolder = pathParts.join("/");
    const { data: uploadedFiles, error: verifyErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .list(uploadedFolder, { search: uploadedName, limit: 10 });
    if (verifyErr) throw new Error(`Falha ao verificar o backup enviado: ${verifyErr.message}`);
    const uploadedFile = uploadedFiles?.find((file: any) => file.name === uploadedName);
    const uploadedSize = Number((uploadedFile?.metadata as any)?.size ?? 0);
    if (!uploadedFile || (uploadedSize > 0 && uploadedSize !== zipBuf.byteLength)) {
      throw new Error("O arquivo enviado não passou na verificação de integridade do armazenamento.");
    }

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

    await enforceBackupRetention(supabaseAdmin);
    await cleanupBackupParts(supabaseAdmin, progress);

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

async function removeBackupFile(admin: any, storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  const { error } = await admin.storage.from(BACKUP_BUCKET).remove([storagePath]);
  if (error) throw new Error(error.message);
}

async function enforceBackupRetention(admin: any) {
  const { data } = await admin
    .from("system_backups")
    .select("id, storage_path, status, size_bytes, created_at, env")
    .eq("status", "completed")
    .order("created_at", { ascending: false });
  if (!data?.length) return;

  // Retenção é contada por ambiente: 3 backups de produção E 3 de teste.
  const retainedByEnv: Record<string, number> = {};
  let retainedBytes = 0;
  const toDelete: any[] = [];
  const latestByEnv = new Set<string>();
  for (const row of data) {
    const size = Math.max(0, Number(row.size_bytes ?? 0));
    const env = (row.env as string) ?? "producao";
    const mustKeepLatest = !latestByEnv.has(env);
    latestByEnv.add(env);
    const fits =
      (retainedByEnv[env] ?? 0) < BACKUP_RETENTION_COUNT &&
      retainedBytes + size <= BACKUP_RETENTION_BYTES;
    if (mustKeepLatest || fits) {
      retainedByEnv[env] = (retainedByEnv[env] ?? 0) + 1;
      retainedBytes += size;
    } else {
      toDelete.push(row);
    }
  }

  for (const row of toDelete) {
    try {
      await removeBackupFile(admin, row.storage_path as string | null);
      await admin.from("system_backups").delete().eq("id", row.id);
    } catch (error) {
      console.error(`[backup] retention failed for ${row.id}:`, error);
    }
  }

  const failedCutoff = new Date(Date.now() - FAILED_BACKUP_RETENTION_MS).toISOString();
  const { data: obsoleteRows } = await admin
    .from("system_backups")
    .select("id, storage_path")
    .in("status", ["failed", "cancelled"])
    .lt("created_at", failedCutoff);
  for (const row of obsoleteRows ?? []) {
    try {
      await removeBackupFile(admin, row.storage_path as string | null);
      await admin.from("system_backups").delete().eq("id", row.id);
    } catch (error) {
      console.error(`[backup] obsolete cleanup failed for ${row.id}:`, error);
    }
  }
}

// Exposto para o endpoint público (cron) executar sem passar por RPC.
export async function runScheduledBackup(): Promise<{ id: string; sizeBytes: number }> {
  const r = await runBackup({ type: "scheduled", createdBy: null });
  return { id: r.id, sizeBytes: r.sizeBytes };
}

/**
 * Continua um backup pausado (chamado pelo próprio backup ao esgotar o
 * orçamento de tempo, ou pela tela quando o usuário está acompanhando).
 */
export async function continueBackupById(
  backupId: string,
): Promise<{ id: string; sizeBytes: number; incomplete: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("system_backups")
    .select("id, storage_path, status, env, type")
    .eq("id", backupId)
    .maybeSingle();
  if (!row) throw new Error("Backup não encontrado");
  if (row.status !== "running" && row.status !== "pending") {
    return { id: backupId, sizeBytes: 0, incomplete: false };
  }
  const r = await runBackup({
    type: (row.type as "manual" | "scheduled") ?? "scheduled",
    createdBy: null,
    env: (row.env as "producao" | "sandbox") ?? "producao",
    existing: { id: row.id as string, storagePath: (row.storage_path as string) ?? "" },
  });
  return { id: r.id, sizeBytes: r.sizeBytes, incomplete: Boolean(r.incomplete) };
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
    const backupEnv = await resolveTargetEnv(supabaseAdmin, context.userId);

    // Um clique repetido acompanha a execução ativa, sem criar concorrência.
    const cutoffIso = new Date(Date.now() - STALE_BACKUP_MS).toISOString();
    const { data: existingRow } = await supabaseAdmin
      .from("system_backups")
      .select("id, storage_path, status, updated_at")
      .eq("created_by", context.userId)
      .eq("env", backupEnv)
      .in("status", ["pending", "running"])
      .gte("updated_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let backupId: string;
    let storagePath: string;
    let shouldExecute = false;
    if (existingRow?.id && existingRow.storage_path) {
      backupId = existingRow.id as string;
      storagePath = existingRow.storage_path as string;
    } else {
      const now = new Date();
      const filename = formatFilename(now, backupEnv);
      storagePath = storagePathFor(now, filename, backupEnv);
      const { data: rowIns, error: insErr } = await supabaseAdmin
        .from("system_backups")
        .insert({
          created_by: context.userId,
          type: "manual",
          status: "pending",
          storage_path: storagePath,
          env: backupEnv,
        })
        .select("id")
        .single();
      if (insErr || !rowIns) throw new Error(insErr?.message ?? "insert failed");
      backupId = rowIns.id as string;
      shouldExecute = true;
    }

    return {
      id: backupId,
      storagePath,
      sizeBytes: null,
      queued: true,
      shouldExecute,
    };
  });

export const executeBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("system_backups")
      .select("id, storage_path, status, created_by, env")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Backup não encontrado.");
    if (row.created_by !== context.userId) throw new Error("Você não pode executar este backup.");
    if (!row.storage_path) throw new Error("Caminho do backup inválido.");
    if (row.status === "completed") return { id: row.id as string, status: "completed" as const };
    if (row.status !== "pending") {
      throw new Error(`Este backup não pode ser iniciado no estado ${row.status}.`);
    }
    await runBackup({
      type: "manual",
      createdBy: context.userId,
      env: (row.env as "producao" | "sandbox" | null) ?? "producao",
      existing: { id: row.id as string, storagePath: row.storage_path as string },
    });
    return { id: row.id as string, status: "completed" as const };
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
  env: "producao" | "sandbox";
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
    // A prévia precisa refletir exatamente o que será exportado: apenas o
    // ambiente atual do usuário (produção ou teste).
    const backupEnv = await resolveTargetEnv(supabaseAdmin, context.userId);

    const tables: { name: string; rows: number }[] = [];
    let totalRows = 0;
    for (const t of BACKUP_TABLES) {
      try {
        let counter = (supabaseAdmin as any)
          .from(t)
          .select("*", { count: "exact", head: true });
        if (ENV_SCOPED_TABLES.has(t)) {
          counter = counter.eq("env", backupEnv);
          if (backupEnv === "sandbox") counter = counter.eq("sandbox_owner", context.userId);
        }
        const { count, error } = await counter;
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
      env: backupEnv,
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
      .select("id, storage_path, status, updated_at, created_by, env, error_details")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Backup não encontrado.");
    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
      return { id: row.id as string, status: row.status as string, queued: false };
    }
    if (!row.storage_path) throw new Error("Backup sem storage_path.");
    // Backup pausado por orçamento de tempo pode (e deve) continuar na hora.
    const pausedForBudget = Boolean((row.error_details as any)?.resume?.paused);
    const lastTouch = row.updated_at ? Date.parse(row.updated_at as string) : 0;
    if (!pausedForBudget && lastTouch > 0 && Date.now() - lastTouch < RESUME_STALE_MS) {
      return {
        id: row.id as string,
        status: row.status as string,
        queued: false,
        active: true,
        staleInMs: RESUME_STALE_MS - (Date.now() - lastTouch),
      };
    }

    const result = await runBackup({
      type: "manual",
      createdBy: (row.created_by as string | null) ?? context.userId,
      env: (row.env as "producao" | "sandbox" | null) ?? "producao",
      existing: { id: row.id as string, storagePath: row.storage_path as string },
    });
    return {
      id: result.id,
      status: result.incomplete ? "running" : "completed",
      queued: Boolean(result.incomplete),
    };
  });

// removido: implementação original de createBackupNow substituída acima

// Sinaliza cancelamento de um backup pendente/em execução. O runBackup
// checa o flag entre etapas e encerra graciosamente com status "cancelled".
export const cancelBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("system_backups")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Backup não encontrado.");
    if (row.status !== "pending" && row.status !== "running") {
      return { ok: true, status: row.status as string, alreadyFinished: true };
    }
    const nowIso = new Date().toISOString();
    // Se ainda estiver "pending" e nenhum job pegou, finalize direto.
    if (row.status === "pending") {
      await supabaseAdmin
        .from("system_backups")
        .update({
          status: "cancelled",
          cancel_requested: false,
          error: "Cancelado pelo usuário",
          error_details: { message: "Backup cancelado pelo usuário.", phase: "cancelled" } as any,
          finished_at: nowIso,
        } as any)
        .eq("id", data.id);
      return { ok: true, status: "cancelled", alreadyFinished: false };
    }
    // Em execução: marca como cancelado imediatamente (a UI reage na hora) e
    // sinaliza o job, que encerra na próxima checagem e limpa o parcial.
    await supabaseAdmin
      .from("system_backups")
      .update({
        status: "cancelled",
        cancel_requested: true,
        error: "Cancelado pelo usuário",
        error_details: { message: "Backup cancelado pelo usuário.", phase: "cancelled" } as any,
        finished_at: nowIso,
      } as any)
      .eq("id", data.id);
    return { ok: true, status: "cancelled", alreadyFinished: false };
  });

export interface BackupRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  createdBy: string | null;
  type: "manual" | "scheduled";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  env: "producao" | "sandbox";
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
  .inputValidator((input?: { env?: "producao" | "sandbox" }) => input ?? {})
  .handler(async ({ context, data }): Promise<BackupRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await cleanupStaleBackups(supabaseAdmin);
    // Cada ambiente tem seu próprio histórico: por padrão mostramos apenas o
    // ambiente em que o usuário está.
    const listEnv = data?.env ?? (await resolveTargetEnv(supabaseAdmin, context.userId));
    const { data: rows, error } = await supabaseAdmin
      .from("system_backups")
      .select("*")
      .eq("env", listEnv)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      finishedAt: r.finished_at,
      createdBy: r.created_by,
      type: r.type,
      status: r.status,
      env: (r.env as "producao" | "sandbox") ?? "producao",
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
      .select("storage_path, created_at, env")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.storage_path) throw new Error("Backup sem arquivo disponível.");
    // Mesmo backups antigos (nome com números corridos) baixam com nome legível.
    const envLabel: "producao" | "sandbox" =
      (row as any).env === "sandbox" || row.storage_path.startsWith("sandbox/")
        ? "sandbox"
        : "producao";
    const downloadName = formatFilename(
      new Date((row as any).created_at ?? Date.now()),
      envLabel,
    );
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .createSignedUrl(row.storage_path, 60 * 10, { download: downloadName });
    if (signErr || !signed) throw new Error(signErr?.message ?? "sign failed");
    return { url: signed.signedUrl, filename: downloadName };
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
  /** Hora/minuto em UTC extraídos do cron. */
  hourUtc: number;
  minuteUtc: number;
  /** 0 = domingo (apenas para semanal). */
  weekday: number;
}

export const getBackupSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackupScheduleInfo> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const off: BackupScheduleInfo = {
      active: false,
      frequency: "off",
      cron: null,
      jobId: null,
      hourUtc: 3,
      minuteUtc: 0,
      weekday: 0,
    };
    const { data, error } = await (supabaseAdmin as any).rpc("get_system_backup_schedule");
    if (error) return off; // função ainda não existe (primeira execução)
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return off;
    const cron: string = row.schedule ?? "";
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return off;
    const [min, hour, , , dow] = parts;
    const frequency: BackupScheduleInfo["frequency"] = dow === "*" ? "daily" : "weekly";
    return {
      active: Boolean(row.active),
      frequency,
      cron: cron || null,
      jobId: row.jobid ?? null,
      hourUtc: Number.isFinite(Number(hour)) ? Number(hour) : 3,
      minuteUtc: Number.isFinite(Number(min)) ? Number(min) : 0,
      weekday: Number.isFinite(Number(dow)) ? Number(dow) : 0,
    };
  });

const scheduleSchema = z.object({
  frequency: z.enum(["off", "daily", "weekly"]),
  hourUtc: z.number().int().min(0).max(23).default(3),
  minuteUtc: z.number().int().min(0).max(59).default(0),
  weekday: z.number().int().min(0).max(6).default(0),
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
      _hour: data.hourUtc,
      _minute: data.minuteUtc,
      _weekday: data.weekday,
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
    // O resumo "ao vivo" precisa comparar com o mesmo ambiente do backup.
    const env = await resolveTargetEnv(supabaseAdmin, context.userId);
    const [clients, products, agreements, installments, nfInvoices, teamTasks, punchEntries] =
      await Promise.all([
        fetchAllRows(supabaseAdmin, "clients", 1000, env, context.userId),
        fetchAllRows(supabaseAdmin, "products", 1000, env, context.userId),
        fetchAllRows(supabaseAdmin, "mgmv_agreements", 1000, env, context.userId),
        fetchAllRows(supabaseAdmin, "mgmv_installments", 1000, env, context.userId),
        fetchAllRows(supabaseAdmin, "nf_invoices", 1000, env, context.userId),
        fetchAllRows(supabaseAdmin, "team_tasks", 1000, env, context.userId),
        fetchAllRows(supabaseAdmin, "team_punch_entries", 1000, env, context.userId),
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
// Tabelas exportadas apenas como histórico — restaurá-las sobrescreveria estado
// vivo do sistema (sessões, modo teste, catálogo de backups) e nunca é feito.
const HISTORY_ONLY_TABLES = new Set<string>([
  "import_progress",
  "active_sessions",
  "sandbox_state",
  "system_backups",
  "sandbox_import_audit",
]);

const RESTORABLE_TABLES = BACKUP_TABLES.filter((t) => !HISTORY_ONLY_TABLES.has(t));

// Trilhas de log globais (sem coluna `env`): restauradas só na produção, para
// que um teste jamais reescreva o histórico real de auditoria.
const PRODUCTION_ONLY_TABLES = new Set<string>(["audit_log", "notion_html_access_log"]);

// Tabelas que possuem a coluna `env` (produção x sandbox).
const ENV_SCOPED_TABLES = new Set<string>(SANDBOX_TABLES);

// Tabelas globais (usuários, papéis, permissões) — nunca são tocadas quando o
// destino é o sandbox, para que um teste jamais altere acesso real.
const GLOBAL_TABLES = new Set<string>([
  "profiles",
  "user_roles",
  "role_permissions",
  "user_responsibilities",
]);

const CLONE_BY_TABLE: Record<string, CloneTable> = Object.fromEntries(
  CLONE_ORDER.map((t) => [t.name, t]),
);

// Alvo de conflito do upsert por tabela. As tabelas com chave composta
// (id/env) precisam do alvo correto, senão o banco recusa a gravação.
const CONFLICT_TARGET: Record<string, string> = {
  app_settings: "id,env,sandbox_key",
  ai_training_profile: "user_id,env,sandbox_key",
  active_sessions: "user_id",
  sandbox_state: "user_id",
};

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/**
 * O ambiente de destino é SEMPRE decidido no servidor a partir do estado de
 * sandbox do usuário — nunca vem do navegador.
 */
async function resolveTargetEnv(
  admin: any,
  userId: string,
): Promise<"producao" | "sandbox"> {
  const { data } = await admin
    .from("sandbox_state")
    .select("active")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.active ? "sandbox" : "producao";
}

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
  targetEnv: "producao" | "sandbox";
  /** Ambiente de origem gravado no manifesto (null em backups antigos). */
  sourceEnv: "producao" | "sandbox" | null;
  /** true quando o arquivo veio de um ambiente diferente do destino. */
  envMismatch: boolean;
  skippedTables: string[];
}

export interface RestoreResult {
  ok: true;
  mode: "merge" | "replace";
  targetEnv: "producao" | "sandbox";
  tablesRestored: Array<{ table: string; inserted: number; skipped: number; deleted: number }>;
  storageFilesRestored: number;
  durationMs: number;
  /** Nome do arquivo usado na restauração. */
  filename?: string;
  /** Erros por tabela (causa real vinda do banco). */
  errors?: Array<{ table: string; stage: string; message: string }>;
  /** Conferência pós-restauração: esperado (backup) x contado no banco. */
  verification?: Array<{ table: string; expected: number; actual: number; diff: number }>;
  /** true = contagens de produção idênticas antes/depois (só no Modo Teste). */
  productionUntouched?: boolean | null;
}

const restorePreviewSchema = z.object({
  backupId: z.string().uuid().optional(),
  uploadedZipBase64: z.string().optional(),
  uploadedPath: z.string().optional(),
});

const restoreApplySchema = z.object({
  backupId: z.string().uuid().optional(),
  uploadedZipBase64: z.string().optional(),
  uploadedPath: z.string().optional(),
  mode: z.enum(["merge", "replace"]),
  tables: z.array(z.string()).optional(),
  includeStorage: z.boolean().default(false),
  confirmReplace: z.string().optional(),
});

/** Prefixo dos ZIPs enviados pelo usuário (temporários). */
const UPLOAD_PREFIX = "uploads/";
/** Base64 continua aceito só para arquivos pequenos (compatibilidade). */
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

function assertUploadPath(path: string) {
  if (!path.startsWith(UPLOAD_PREFIX) || path.includes("..")) {
    throw new Error("Caminho de upload inválido.");
  }
}

/**
 * Gera uma URL assinada para o navegador enviar o ZIP direto ao armazenamento.
 * Evita trafegar o arquivo em base64 dentro da requisição (estourava memória).
 */
export const createBackupUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ fileName: z.string().min(1), size: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ path: string; token: string; bucket: string }> => {
    await assertAdmin(context);
    if (data.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo maior que 500 MB.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safe = data.fileName.replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `${UPLOAD_PREFIX}${context.userId}/${Date.now()}-${safe}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Falha ao preparar upload.");
    // Limpa sobras antigas de uploads deste usuário (> 24h).
    try {
      const { data: old } = await supabaseAdmin.storage
        .from(BACKUP_BUCKET)
        .list(`${UPLOAD_PREFIX}${context.userId}`, { limit: 100 });
      const stale = (old ?? [])
        .filter((o: any) => Date.now() - new Date(o.created_at ?? 0).getTime() > 86_400_000)
        .map((o: any) => `${UPLOAD_PREFIX}${context.userId}/${o.name}`);
      if (stale.length > 0) await supabaseAdmin.storage.from(BACKUP_BUCKET).remove(stale);
    } catch {
      /* limpeza é best-effort */
    }
    return { path: signed.path, token: signed.token, bucket: BACKUP_BUCKET };
  });

/** Remove um ZIP temporário enviado pelo usuário. */
export const discardUploadedBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    assertUploadPath(data.path);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from(BACKUP_BUCKET).remove([data.path]);
    return { ok: true };
  });

async function loadBackupZip(
  admin: any,
  opts: { backupId?: string; uploadedZipBase64?: string; uploadedPath?: string },
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
  if (opts.uploadedPath) {
    assertUploadPath(opts.uploadedPath);
    const { data: blob, error } = await admin.storage
      .from(BACKUP_BUCKET)
      .download(opts.uploadedPath);
    if (error || !blob) {
      throw new Error(error?.message ?? "Falha ao baixar o arquivo enviado.");
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf.byteLength > MAX_UPLOAD_BYTES) throw new Error("Arquivo maior que 500 MB.");
    let zip: any;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
      throw new Error("Arquivo inválido: não foi possível ler o ZIP enviado.");
    }
    return { zip, filename: opts.uploadedPath.split("/").pop() ?? "upload.zip" };
  }
  if (opts.uploadedZipBase64) {
    const raw = opts.uploadedZipBase64.includes(",")
      ? opts.uploadedZipBase64.split(",", 2)[1]
      : opts.uploadedZipBase64;
    if (raw.length * 0.75 > MAX_BASE64_BYTES) {
      throw new Error("Arquivo grande demais para envio direto — reenvie o ZIP pelo seletor.");
    }
    const bin = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    let zip: any;
    try {
      zip = await JSZip.loadAsync(bin);
    } catch {
      throw new Error("Arquivo inválido: não foi possível ler o ZIP enviado.");
    }
    return { zip, filename: "upload.zip" };
  }
  throw new Error("Informe um backup salvo ou envie um ZIP.");
}

async function readManifest(zip: any): Promise<{
  schemaVersion: number;
  generatedAt: string | null;
  sourceEnv: "producao" | "sandbox" | null;
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
    sourceEnv:
      parsed.env === "sandbox" || parsed.env === "producao"
        ? (parsed.env as "producao" | "sandbox")
        : null,
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
    const targetEnv = await resolveTargetEnv(supabaseAdmin, context.userId);
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

    // Estado atual do banco vivo — escopado ao ambiente de destino.
    const [clients, products, agreements, installments, nfInvoices, teamTasks, punchEntries] =
      await Promise.all([
        fetchAllRows(supabaseAdmin, "clients", 1000, targetEnv, context.userId),
        fetchAllRows(supabaseAdmin, "products", 1000, targetEnv, context.userId),
        fetchAllRows(supabaseAdmin, "mgmv_agreements", 1000, targetEnv, context.userId),
        fetchAllRows(supabaseAdmin, "mgmv_installments", 1000, targetEnv, context.userId),
        fetchAllRows(supabaseAdmin, "nf_invoices", 1000, targetEnv, context.userId),
        fetchAllRows(supabaseAdmin, "team_tasks", 1000, targetEnv, context.userId),
        fetchAllRows(supabaseAdmin, "team_punch_entries", 1000, targetEnv, context.userId),
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

    const inZip = RESTORABLE_TABLES.filter((t) => Boolean(zip.file(`database/data/${t}.jsonl`)));
    const availableTables =
      targetEnv === "sandbox" ? inZip.filter((t) => !GLOBAL_TABLES.has(t)) : inZip;
    const skippedTables = inZip.filter((t) => !availableTables.includes(t));

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
      targetEnv,
      sourceEnv: manifest.sourceEnv,
      envMismatch: Boolean(manifest.sourceEnv && manifest.sourceEnv !== targetEnv),
      skippedTables,
    };
  });

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => restoreApplySchema.parse(d))
  .handler(async ({ data, context }): Promise<RestoreResult> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const started = Date.now();
    // Destino decidido no servidor. O navegador não escolhe ambiente.
    const targetEnv = await resolveTargetEnv(supabaseAdmin, context.userId);
    // Na produção a substituição continua exigindo confirmação explícita.
    // No teste o ambiente é SEMPRE zerado antes da carga (não há risco real).
    if (targetEnv === "producao" && data.mode === "replace" && data.confirmReplace !== "REPLACE") {
      throw new Error('Para o modo "Substituir tudo" digite REPLACE para confirmar.');
    }
    const effectiveMode: "merge" | "replace" =
      targetEnv === "sandbox" ? "replace" : data.mode;
    // Prova de isolamento: contagens de produção antes da execução em teste.
    const productionBefore =
      targetEnv === "sandbox" ? await countProductionRows(supabaseAdmin) : {};
    const { zip, filename: zipName } = await loadBackupZip(supabaseAdmin, data);
    await readManifest(zip);

    const requested = data.tables && data.tables.length > 0
      ? new Set(data.tables)
      : new Set(RESTORABLE_TABLES);

    const tablesToProcess = (
      targetEnv === "sandbox"
        ? // No sandbox seguimos a ordem de dependência da clonagem para que as
          // chaves estrangeiras já estejam remapeadas quando forem usadas, e
          // nunca tocamos tabelas globais (perfis, papéis, permissões).
          [
            ...(CLONE_ORDER.map((t) => t.name) as string[]),
            // Qualquer tabela com `env` que ainda não esteja na ordem de
            // clonagem entra no fim, para que nada fique de fora do teste.
            ...(RESTORABLE_TABLES as unknown as string[]).filter(
              (t) => ENV_SCOPED_TABLES.has(t) && !CLONE_ORDER.some((c) => c.name === t),
            ),
          ].filter(
            (t) =>
              RESTORABLE_TABLES.includes(t as any) &&
              !GLOBAL_TABLES.has(t) &&
              !PRODUCTION_ONLY_TABLES.has(t),
          )
        : (RESTORABLE_TABLES as unknown as string[])
    ).filter((t) => requested.has(t));

    const results: RestoreResult["tablesRestored"] = [];
    const restoreErrors: NonNullable<RestoreResult["errors"]> = [];
    const deletedByTable: Record<string, number> = {};
    const expectedByTable: Record<string, number> = {};
    // Mapa de ids originais -> novos ids (somente sandbox).
    const idMaps: Record<string, Record<string, string>> = {};

    // REPLACE: apaga em ordem reversa (dependentes primeiro).
    // No sandbox a limpeza cobre TODAS as tabelas de teste, e não apenas as
    // presentes no ZIP/seleção, para que cada restauração comece do zero.
    if (effectiveMode === "replace") {
      const tablesToWipe =
        targetEnv === "sandbox"
          ? (CLONE_ORDER.map((t) => t.name) as string[]).filter((t) => !GLOBAL_TABLES.has(t))
          : tablesToProcess;
      for (const table of [...tablesToWipe].reverse()) {
        // Conta antes de apagar para relatar quantos registros saíram.
        try {
          let counter = (supabaseAdmin as any).from(table).select("*", { count: "exact", head: true });
          if (ENV_SCOPED_TABLES.has(table)) {
            counter = counter.eq("env", targetEnv);
            if (targetEnv === "sandbox") counter = counter.eq("sandbox_owner", context.userId);
          }
          const { count } = await counter;
          deletedByTable[table] = count ?? 0;
        } catch {
          deletedByTable[table] = 0;
        }
        let query = (supabaseAdmin as any).from(table).delete();
        // Exclusão SEMPRE escopada ao ambiente de destino.
        if (ENV_SCOPED_TABLES.has(table)) {
          query = query.eq("env" as any, targetEnv);
          // Nunca apaga o sandbox de outro usuário.
          if (targetEnv === "sandbox") query = query.eq("sandbox_owner" as any, context.userId);
        } else if (targetEnv === "sandbox") {
          continue; // tabela global: nunca apagada em teste
        }
        // Protege o admin logado
        if (table === "user_roles" || table === "profiles") {
          query = query.neq("user_id" as any, context.userId).neq("id" as any, context.userId);
        }
        // Tabelas de ambiente já possuem o filtro obrigatório acima. O fallback
        // por `id` só é usado em tabelas globais que realmente possuem essa coluna.
        const deletion = ENV_SCOPED_TABLES.has(table)
          ? query
          : query.neq("id" as any, "00000000-0000-0000-0000-000000000000");
        const { error } = await deletion;
        if (error) {
          console.warn(`[restore] delete ${table}:`, error.message);
          deletedByTable[table] = 0;
          restoreErrors.push({ table, stage: "limpeza", message: error.message });
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
      expectedByTable[table] = filtered.length;

      const cloneTable = CLONE_BY_TABLE[table];
      let payload: any[];
      if (targetEnv === "sandbox" && cloneTable) {
        // Regenera todos os ids e reescreve as FKs — nenhum id do backup entra
        // como está, então é impossível sobrescrever uma linha de produção.
        idMaps[table] = idMaps[table] ?? {};
        payload = filtered.map((row) =>
          stripGeneratedColumns(remapRow(cloneTable, row, idMaps, context.userId)),
        );
      } else {
        payload = filtered.map((row) =>
          stripGeneratedColumns(
            ENV_SCOPED_TABLES.has(table)
              ? {
                  ...row,
                  env: targetEnv,
                  sandbox_owner: targetEnv === "sandbox" ? context.userId : null,
                }
              : { ...row },
          ),
        );
      }

      // Consolida chaves repetidas depois de aplicar o ambiente de destino. É
      // nessa etapa que duas linhas produção/sandbox do ZIP podem convergir.
      const deduped = dedupeRestoreRows(table, payload);
      payload = deduped.rows;

      // A chave única do ponto agora inclui `env`, então produção e teste têm
      // batidas independentes — nenhum filtro de colisão é necessário.
      const businessKeySkipped = deduped.removed;

      // Trava final: nada é gravado se alguma linha não estiver carimbada com
      // o ambiente de destino (ou, no sandbox, se algum id não foi regerado).
      if (ENV_SCOPED_TABLES.has(table)) {
        const bad = payload.find((r) => r.env !== targetEnv);
        if (bad) throw new Error(`[restore] ${table}: linha fora do ambiente ${targetEnv}. Abortado.`);
      }
      if (targetEnv === "sandbox" && cloneTable?.idColumn) {
        const map = idMaps[table] ?? {};
        const collision = payload.find((r) => {
          const id = r[cloneTable.idColumn as string];
          return typeof id === "string" && map[id] !== undefined;
        });
        if (collision) throw new Error(`[restore] ${table}: id não remapeado. Abortado.`);
      }

      let inserted = 0;
      let skipped = businessKeySkipped;
      const CHUNK = 500;
      const useInsert = targetEnv === "sandbox" && Boolean(cloneTable?.idColumn);
      for (let i = 0; i < payload.length; i += CHUNK) {
        const chunk = payload.slice(i, i + CHUNK);
        const { error } = useInsert
          ? await (supabaseAdmin as any).from(table).insert(chunk as any)
          : await (supabaseAdmin as any).from(table).upsert(chunk as any, {
              onConflict: CONFLICT_TARGET[table] ?? "id",
              ignoreDuplicates: false,
            } as any);
        if (error) {
          console.warn(`[restore] upsert ${table} (chunk ${i}):`, error.message);
          skipped += chunk.length;
          if (restoreErrors.filter((e) => e.table === table).length < 2) {
            restoreErrors.push({
              table,
              stage: "gravação",
              message: `${error.message}${(error as any).hint ? ` — ${(error as any).hint}` : ""}${(error as any).details ? ` (${(error as any).details})` : ""}`,
            });
          }
        } else {
          inserted += chunk.length;
        }
      }
      results.push({
        table,
        inserted,
        skipped,
        deleted: effectiveMode === "replace" ? (deletedByTable[table] ?? 0) : 0,
      });
    }

    // Storage: reenvia arquivos originais (o acervo é único; em teste é só leitura)
    let storageFilesRestored = 0;
    if (data.includeStorage && targetEnv === "producao") {
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
        env: targetEnv,
      } as any);
    } catch (err) {
      console.warn("[restore] import_history log failed:", err);
    }

    // Conferência pós-restauração: conta o que ficou no banco (no ambiente de
    // destino) e compara com o que o backup trouxe.
    const verification: NonNullable<RestoreResult["verification"]> = [];
    for (const table of tablesToProcess) {
      const expected = expectedByTable[table] ?? 0;
      let actual = -1;
      try {
          let counter = (supabaseAdmin as any)
          .from(table)
            .select("*", { count: "exact", head: true });
        if (ENV_SCOPED_TABLES.has(table)) counter = counter.eq("env", targetEnv);
        const { count, error } = await counter;
        if (!error) actual = count ?? 0;
      } catch {
        /* contagem best-effort */
      }
      verification.push({
        table,
        expected,
        actual,
        diff: actual < 0 ? 0 : actual - expected,
      });
    }

    // Auditoria do Modo Teste + verificação de que a produção não mudou.
    let productionUntouched: boolean | null = null;
    if (targetEnv === "sandbox") {
      const productionAfter = await countProductionRows(supabaseAdmin);
      productionUntouched = await logSandboxImport(supabaseAdmin, {
        userId: context.userId,
        userEmail: (context as any)?.claims?.email ?? null,
        source: data.backupId ? "backup-salvo" : "upload-zip",
        fileName: zipName,
        mode: targetEnv === "sandbox" ? "reset+carga" : data.mode,
        tables: tablesToProcess,
        rowCounts: Object.fromEntries(results.map((r) => [r.table, r.inserted])),
        durationMs: Date.now() - started,
        result: restoreErrors.length > 0 ? "error" : "success",
        error: restoreErrors[0] ? `${restoreErrors[0].table}: ${restoreErrors[0].message}` : null,
        productionBefore,
        productionAfter,
        report: { tablesRestored: results, verification, errors: restoreErrors },
      });
    }

    return {
      ok: true,
      mode: effectiveMode,
      targetEnv,
      tablesRestored: results,
      storageFilesRestored,
      durationMs: Date.now() - started,
      filename: zipName,
      errors: restoreErrors,
      verification,
      productionUntouched,
    };
  });

// ---------------------------------------------------------------------------
// Modo de validação (dry-run no sandbox) + auditoria de importações em teste
// ---------------------------------------------------------------------------

/** Tabelas usadas para conferir que a produção não foi tocada. */
const PROD_GUARD_TABLES = [
  "clients",
  "products",
  "mgmv_agreements",
  "mgmv_installments",
  "nf_invoices",
  "team_tasks",
  "team_punch_entries",
] as const;

/** Conta linhas de PRODUÇÃO (nunca escreve nada) para provar o isolamento. */
export async function countProductionRows(admin: any): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    PROD_GUARD_TABLES.map(async (table) => {
      const { count, error } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("env", "producao");
      out[table] = error ? -1 : (count ?? 0);
    }),
  );
  return out;
}

function countsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  }
  return true;
}

export interface SandboxAuditInput {
  userId: string;
  userEmail?: string | null;
  source: string;
  fileName?: string | null;
  mode: string;
  tables: string[];
  rowCounts: Record<string, unknown>;
  durationMs: number;
  result?: "success" | "error" | "isolation_breach";
  error?: string | null;
  productionBefore: Record<string, number>;
  productionAfter: Record<string, number>;
  report?: unknown;
}

/**
 * Registra uma importação/validação feita no Modo Teste, junto com a prova de
 * que as contagens de produção não mudaram durante a execução.
 */
export async function logSandboxImport(admin: any, input: SandboxAuditInput): Promise<boolean> {
  const untouched = countsEqual(input.productionBefore, input.productionAfter);
  try {
    await admin.from("sandbox_import_audit").insert({
      user_id: input.userId,
      user_email: input.userEmail ?? null,
      env: "sandbox",
      source: input.source,
      file_name: input.fileName ?? null,
      mode: input.mode,
      tables_affected: input.tables,
      row_counts: input.rowCounts as any,
      duration_ms: Math.round(input.durationMs),
      result: untouched ? (input.result ?? "success") : "isolation_breach",
      error: input.error ?? null,
      production_untouched: untouched,
      production_counts_before: input.productionBefore as any,
      production_counts_after: input.productionAfter as any,
      report: (input.report ?? null) as any,
    } as any);
  } catch (err) {
    console.warn("[sandbox-audit] falha ao registrar:", err);
  }
  return untouched;
}

export interface ValidationTableDiff {
  table: string;
  inBackup: number;
  currentSandbox: number;
  toInsert: number;
  toDelete: number;
  projected: number;
}

export interface ValidationIssue {
  level: "error" | "warn" | "info";
  message: string;
}

export interface ValidationReport {
  ok: true;
  filename: string;
  generatedAt: string | null;
  schemaVersion: number;
  mode: "merge" | "replace";
  targetEnv: "sandbox";
  tables: ValidationTableDiff[];
  skippedTables: string[];
  currentSummary: BusinessSummary;
  projectedSummary: BusinessSummary;
  issues: ValidationIssue[];
  productionUntouched: boolean;
  productionCounts: Record<string, number>;
  durationMs: number;
  validatedAt: string;
}

const validateSchema = z.object({
  backupId: z.string().uuid().optional(),
  uploadedZipBase64: z.string().optional(),
  uploadedPath: z.string().optional(),
  mode: z.enum(["merge", "replace"]).default("merge"),
  tables: z.array(z.string()).optional(),
});

const SUMMARY_TABLES = [
  "clients",
  "products",
  "mgmv_agreements",
  "mgmv_installments",
  "nf_invoices",
  "team_tasks",
  "team_punch_entries",
] as const;

/**
 * Executa a restauração "a seco": lê o backup, projeta o resultado no sandbox e
 * devolve um relatório de diferenças. NENHUMA escrita de dados acontece — nem
 * na produção, nem no sandbox (apenas o registro de auditoria é gravado).
 */
export const validateBackupRestore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validateSchema.parse(d))
  .handler(async ({ data, context }): Promise<ValidationReport> => {
    await assertAdmin(context);
    const started = Date.now();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const targetEnv = await resolveTargetEnv(supabaseAdmin, context.userId);
    if (targetEnv !== "sandbox") {
      throw new Error(
        "A validação só roda no Modo Teste. Entre no Modo Teste (Configurações → Sandbox) e tente de novo.",
      );
    }

    const productionBefore = await countProductionRows(supabaseAdmin);
    const { zip, filename } = await loadBackupZip(supabaseAdmin, data);
    const manifest = await readManifest(zip);

    const inZip = RESTORABLE_TABLES.filter((t) => Boolean(zip.file(`database/data/${t}.jsonl`)));
    const requested = data.tables && data.tables.length > 0 ? new Set(data.tables) : null;
    const applicable = inZip.filter((t) => !GLOBAL_TABLES.has(t));
    const skippedTables = inZip.filter((t) => GLOBAL_TABLES.has(t));
    const selected = applicable.filter((t) => !requested || requested.has(t));

    const issues: ValidationIssue[] = [];
    if (skippedTables.length > 0) {
      issues.push({
        level: "info",
        message: `Tabelas globais ignoradas em teste (usuários, papéis, permissões): ${skippedTables.join(", ")}`,
      });
    }

    // Linhas do backup por tabela selecionada
    const backupRows: Record<string, any[]> = {};
    for (const table of selected) {
      backupRows[table] = await loadTableRows(zip, table);
    }

    // Estado atual do sandbox
    const currentRows: Record<string, any[]> = {};
    await Promise.all(
      SUMMARY_TABLES.map(async (table) => {
        currentRows[table] = await fetchAllRows(supabaseAdmin, table as any, 1000, "sandbox", context.userId);
      }),
    );
    for (const table of selected) {
      if (!currentRows[table]) {
        currentRows[table] = await fetchAllRows(supabaseAdmin, table as any, 1000, "sandbox", context.userId);
      }
    }

    // Diferenças por tabela. No sandbox todos os ids são regerados, então
    // merge sempre insere e replace apaga o que existe antes de inserir.
    const tables: ValidationTableDiff[] = selected.map((table) => {
      const inBackup = backupRows[table]?.length ?? 0;
      const currentSandbox = currentRows[table]?.length ?? 0;
      const toDelete = data.mode === "replace" ? currentSandbox : 0;
      return {
        table,
        inBackup,
        currentSandbox,
        toInsert: inBackup,
        toDelete,
        projected: data.mode === "replace" ? inBackup : currentSandbox + inBackup,
      };
    });

    // Integridade referencial dentro do ZIP
    const idSet = (rows: any[]) => new Set(rows.map((r) => r?.id).filter(Boolean));
    const clientIds = idSet(backupRows["clients"] ?? []);
    const agreementIds = idSet(backupRows["mgmv_agreements"] ?? []);

    const orphanProducts = (backupRows["products"] ?? []).filter(
      (p) => p?.client_id && !clientIds.has(p.client_id),
    ).length;
    if (orphanProducts > 0) {
      issues.push({
        level: "error",
        message: `${orphanProducts} produto(s) apontam para um cliente que não está no backup — ficariam sem vínculo.`,
      });
    }
    const orphanInstallments = (backupRows["mgmv_installments"] ?? []).filter(
      (i) => i?.agreement_id && !agreementIds.has(i.agreement_id),
    ).length;
    if (orphanInstallments > 0) {
      issues.push({
        level: "error",
        message: `${orphanInstallments} parcela(s) apontam para um acordo MGMV inexistente no backup.`,
      });
    }
    const orphanAgreements = (backupRows["mgmv_agreements"] ?? []).filter(
      (a) => a?.client_id && !clientIds.has(a.client_id),
    ).length;
    if (orphanAgreements > 0) {
      issues.push({
        level: "error",
        message: `${orphanAgreements} acordo(s) MGMV sem o cliente correspondente no backup.`,
      });
    }

    for (const table of selected) {
      const rows = backupRows[table] ?? [];
      const normalizedRows = rows.map((row) =>
        ENV_SCOPED_TABLES.has(table) ? { ...row, env: "sandbox" } : row,
      );
      const keyedRows = normalizedRows
        .map((row) => restoreRowKey(table, row))
        .filter((key): key is string => key !== null);
      if (keyedRows.length > 0 && new Set(keyedRows).size !== keyedRows.length) {
        const keyLabel = (RESTORE_KEY_COLUMNS[table] ?? ["id"]).join(" + ");
        issues.push({
          level: "warn",
          message: `${table}: existem linhas repetidas pela chave ${keyLabel}; a restauração consolidará essas versões antes de gravar.`,
        });
      }
      if (rows.length === 0 && (manifest.rowCounts?.[table] ?? 0) > 0) {
        issues.push({
          level: "warn",
          message: `${table}: o manifesto indica ${manifest.rowCounts[table]} registro(s), mas o arquivo veio vazio.`,
        });
      }
    }
    if (selected.length === 0) {
      issues.push({ level: "error", message: "Nenhuma tabela restaurável foi encontrada no backup." });
    }

    const selectedSet = new Set<string>(selected as unknown as string[]);
    const pick = (table: string) =>
      data.mode === "replace"
        ? selectedSet.has(table)
          ? backupRows[table] ?? []
          : currentRows[table] ?? []
        : [...(currentRows[table] ?? []), ...(selectedSet.has(table) ? backupRows[table] ?? [] : [])];

    const currentSummary = computeBusinessSummaryFromRows({
      clients: currentRows["clients"] ?? [],
      products: currentRows["products"] ?? [],
      agreements: currentRows["mgmv_agreements"] ?? [],
      installments: currentRows["mgmv_installments"] ?? [],
      nfInvoices: currentRows["nf_invoices"] ?? [],
      teamTasks: currentRows["team_tasks"] ?? [],
      punchEntries: currentRows["team_punch_entries"] ?? [],
    });
    const projectedSummary = computeBusinessSummaryFromRows({
      clients: pick("clients"),
      products: pick("products"),
      agreements: pick("mgmv_agreements"),
      installments: pick("mgmv_installments"),
      nfInvoices: pick("nf_invoices"),
      teamTasks: pick("team_tasks"),
      punchEntries: pick("team_punch_entries"),
    });

    const productionAfter = await countProductionRows(supabaseAdmin);
    const durationMs = Date.now() - started;

    const productionUntouched = await logSandboxImport(supabaseAdmin, {
      userId: context.userId,
      userEmail: (context as any)?.claims?.email ?? null,
      source: data.backupId ? "backup-salvo" : "upload-zip",
      fileName: filename,
      mode: `validacao-${data.mode}`,
      tables: selected,
      rowCounts: Object.fromEntries(tables.map((t) => [t.table, t.inBackup])),
      durationMs,
      result: issues.some((i) => i.level === "error") ? "error" : "success",
      productionBefore,
      productionAfter,
      report: { issues, tables },
    });

    return {
      ok: true,
      filename,
      generatedAt: manifest.generatedAt,
      schemaVersion: manifest.schemaVersion,
      mode: data.mode,
      targetEnv: "sandbox",
      tables,
      skippedTables,
      currentSummary,
      projectedSummary,
      issues,
      productionUntouched,
      productionCounts: productionAfter,
      durationMs,
      validatedAt: new Date().toISOString(),
    };
  });

export interface SandboxAuditRow {
  id: string;
  createdAt: string;
  userEmail: string | null;
  source: string;
  fileName: string | null;
  mode: string;
  tables: string[];
  rowCounts: Record<string, number>;
  durationMs: number | null;
  result: string;
  error: string | null;
  productionUntouched: boolean;
}

export const listSandboxImportAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SandboxAuditRow[]> => {
    const { data, error } = await context.supabase
      .from("sandbox_import_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      userEmail: r.user_email,
      source: r.source,
      fileName: r.file_name,
      mode: r.mode,
      tables: r.tables_affected ?? [],
      rowCounts: (r.row_counts ?? {}) as Record<string, number>,
      durationMs: r.duration_ms,
      result: r.result,
      error: r.error,
      productionUntouched: r.production_untouched,
    }));
  });

/** Snapshot das contagens de produção — usado antes de uma importação em teste. */
export const snapshotProductionCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, number>> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const env = await resolveTargetEnv(supabaseAdmin, context.userId);
    if (env !== "sandbox") return {};
    return countProductionRows(supabaseAdmin);
  });

const recordSandboxImportSchema = z.object({
  source: z.string(),
  fileName: z.string().nullable().optional(),
  mode: z.string().default("import"),
  tables: z.array(z.string()).default([]),
  rowCounts: z.record(z.string(), z.number()).default({}),
  durationMs: z.number().default(0),
  error: z.string().nullable().optional(),
  productionBefore: z.record(z.string(), z.number()).default({}),
});

/**
 * Registra uma importação comum (lista/ZIP) feita no Modo Teste e confere se as
 * contagens de produção continuam idênticas às do início da operação.
 */
export const recordSandboxImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => recordSandboxImportSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ recorded: boolean; productionUntouched: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const env = await resolveTargetEnv(supabaseAdmin, context.userId);
    if (env !== "sandbox") return { recorded: false, productionUntouched: true };

    const productionAfter = await countProductionRows(supabaseAdmin);
    const before = Object.keys(data.productionBefore).length
      ? data.productionBefore
      : productionAfter;
    const untouched = await logSandboxImport(supabaseAdmin, {
      userId: context.userId,
      userEmail: (context as any)?.claims?.email ?? null,
      source: data.source,
      fileName: data.fileName ?? null,
      mode: data.mode,
      tables: data.tables,
      rowCounts: data.rowCounts,
      durationMs: data.durationMs,
      result: data.error ? "error" : "success",
      error: data.error ?? null,
      productionBefore: before,
      productionAfter,
    });
    return { recorded: true, productionUntouched: untouched };
  });
