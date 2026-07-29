import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
const BACKUP_SCHEMA_VERSION = 1;

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

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .in("role", ["admin", "admin_master"]);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
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

async function mirrorBucket(
  admin: any,
  bucket: string,
  onFile: (relPath: string, bytes: Uint8Array) => void,
): Promise<number> {
  let count = 0;
  const walk = async (prefix: string) => {
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
}): Promise<{ id: string; storagePath: string; sizeBytes: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const JSZip = (await import("jszip")).default;

  const now = new Date();
  const filename = formatFilename(now);
  const storagePath = storagePathFor(now, filename);
  const startedAt = Date.now();

  // Cria linha em system_backups (status=running)
  const { data: rowIns, error: insErr } = await supabaseAdmin
    .from("system_backups")
    .insert({
      created_by: opts.createdBy,
      type: opts.type,
      status: "running",
      storage_path: storagePath,
    })
    .select("id")
    .single();
  if (insErr || !rowIns) throw new Error(insErr?.message ?? "insert failed");
  const backupId = rowIns.id as string;

  try {
    const zip = new JSZip();
    const rowCounts: Record<string, number> = {};

    // Tabelas
    for (const table of BACKUP_TABLES) {
      const rows = await fetchAllRows(supabaseAdmin, table);
      rowCounts[table] = rows.length;
      const jsonl = rows.map((r) => JSON.stringify(r)).join("\n");
      zip.file(`database/data/${table}.jsonl`, jsonl);
    }

    // Storage: notion-html-originals
    let storageObjectCount = 0;
    try {
      storageObjectCount = await mirrorBucket(
        supabaseAdmin,
        "notion-html-originals",
        (relPath, bytes) => {
          zip.file(`storage/notion-html-originals/${relPath}`, bytes);
        },
      );
    } catch (err) {
      // Se o bucket não existir, seguimos com o resto do backup.
      console.warn("[backup] mirror bucket failed:", err);
    }

    const manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      type: opts.type,
      rowCounts,
      storageObjectCount,
      tables: BACKUP_TABLES,
      buckets: ["notion-html-originals"],
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("RESTORE.md", RESTORE_MD);

    const zipBuf = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const { error: upErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, zipBuf, {
        contentType: "application/zip",
        upsert: true,
      });
    if (upErr) throw new Error(upErr.message);

    const duration = Date.now() - startedAt;
    await supabaseAdmin
      .from("system_backups")
      .update({
        status: "completed",
        size_bytes: zipBuf.byteLength,
        duration_ms: duration,
        row_counts: rowCounts,
        storage_object_count: storageObjectCount,
        finished_at: new Date().toISOString(),
      })
      .eq("id", backupId);

    // Retenção: mantém últimos 14 backups.
    await pruneOldBackups(supabaseAdmin, 14);

    return { id: backupId, storagePath, sizeBytes: zipBuf.byteLength };
  } catch (err: any) {
    await supabaseAdmin
      .from("system_backups")
      .update({
        status: "failed",
        error: err?.message ?? String(err),
        finished_at: new Date().toISOString(),
      })
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
    return runBackup({ type: "manual", createdBy: context.userId });
  });

export interface BackupRow {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string | null;
  type: "manual" | "scheduled";
  status: "pending" | "running" | "completed" | "failed";
  storagePath: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  rowCounts: Record<string, number>;
  storageObjectCount: number;
  error: string | null;
}

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackupRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
      storagePath: r.storage_path,
      sizeBytes: r.size_bytes,
      durationMs: r.duration_ms,
      rowCounts: r.row_counts ?? {},
      storageObjectCount: r.storage_object_count ?? 0,
      error: r.error,
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
