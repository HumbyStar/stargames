import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  buildDynamoItems,
  buildDynamoTableDefinitions,
  buildFirestoreCollection,
  buildFirestoreImportScript,
  buildMongoJsonl,
  buildPostgresDataSql,
  buildPostgresSchemaSql,
  buildPostgresSecuritySql,
  destinationById,
  validateForDestination,
  type MigrationDestinationId,
  type MigrationMode,
  type MigrationWarning,
  type SchemaSnapshot,
  type SchemaTable,
} from "@/lib/db-migration-formats";

// ---------------------------------------------------------------------------
// Migração / clonagem do banco para outros provedores de nuvem.
// Gera um pacote ZIP com estrutura, dados e instruções, salvo no bucket
// privado de backups (pasta migrations/) e entregue por link temporário.
// ---------------------------------------------------------------------------

const BUCKET = "system-backups";

// Tabelas exportadas na migração (mesma cobertura do backup, exceto trilhas
// de log/processos, que não fazem sentido em um projeto novo).
const MIGRATION_TABLES = [
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
  "team_punch_entries",
] as const;

const ENV_SCOPED = new Set<string>([
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
  "team_punch_entries",
]);

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const [admin, adminMaster] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin_master" }),
  ]);
  if (admin.error) throw new Error(admin.error.message);
  if (adminMaster.error) throw new Error(adminMaster.error.message);
  if (!admin.data && !adminMaster.data) throw new Error("Forbidden: admin only");
}

async function loadSnapshot(ctx: { supabase: any }): Promise<SchemaSnapshot> {
  const { data, error } = await ctx.supabase.rpc("export_db_schema_snapshot");
  if (error) throw new Error(error.message);
  return data as unknown as SchemaSnapshot;
}

async function countRows(admin: any, table: string, env: "producao" | "sandbox") {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (ENV_SCOPED.has(table)) q = q.eq("env", env);
  const { count, error } = await q;
  if (error) throw new Error(`[${table}] ${error.message}`);
  return count ?? 0;
}

async function fetchRows(
  admin: any,
  table: string,
  env: "producao" | "sandbox",
  batchSize = 1000,
): Promise<Array<Record<string, unknown>>> {
  const orderKey = table === "ai_training_profile" ? "user_id" : "id";
  const out: Array<Record<string, unknown>> = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = admin.from(table).select("*");
    if (ENV_SCOPED.has(table)) q = q.eq("env", env);
    const { data, error } = await q
      .order(orderKey, { ascending: true })
      .range(from, from + batchSize - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as Array<Record<string, unknown>>));
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return out;
}

const envSchema = z.object({ env: z.enum(["producao", "sandbox"]).default("producao") });

export interface MigrationPreview {
  generatedAt: string;
  env: "producao" | "sandbox";
  tables: Array<{ name: string; rows: number; columns: number }>;
  totalRows: number;
  enums: number;
  functions: number;
  policies: number;
}

/** Pré-validação: o que existe hoje no ambiente escolhido. */
export const previewDbMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => envSchema.parse(d))
  .handler(async ({ data, context }): Promise<MigrationPreview> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const snapshot = await loadSnapshot(context);
    const byName = new Map(snapshot.tables.map((t) => [t.name, t]));

    const tables: MigrationPreview["tables"] = [];
    let totalRows = 0;
    for (const table of MIGRATION_TABLES) {
      const rows = await countRows(supabaseAdmin, table, data.env);
      totalRows += rows;
      tables.push({ name: table, rows, columns: byName.get(table)?.columns.length ?? 0 });
    }

    return {
      generatedAt: snapshot.generatedAt,
      env: data.env,
      tables,
      totalRows,
      enums: snapshot.enums.length,
      functions: snapshot.functions.length,
      policies: snapshot.tables.reduce((acc, t) => acc + t.policies.length, 0),
    };
  });

const buildSchema = z.object({
  destination: z.enum(["supabase", "neon", "aws", "firebase", "mongodb"]),
  mode: z.enum(["full", "schema"]).default("full"),
  env: z.enum(["producao", "sandbox"]).default("producao"),
});

export interface MigrationPackageResult {
  url: string;
  filename: string;
  sizeBytes: number;
  storagePath: string;
  rowCounts: Record<string, number>;
  totalRows: number;
  warnings: MigrationWarning[];
  files: string[];
}

function readme(
  destinationId: MigrationDestinationId,
  mode: MigrationMode,
  env: string,
  rowCounts: Record<string, number>,
  files: string[],
  warnings: MigrationWarning[],
): string {
  const dest = destinationById(destinationId)!;
  const total = Object.values(rowCounts).reduce((a, b) => a + b, 0);
  return [
    `# Migração do Star Games → ${dest.label}`,
    "",
    `- Ambiente de origem: **${env === "sandbox" ? "Modo Teste" : "Produção"}**`,
    `- Conteúdo: **${mode === "full" ? "estrutura + dados" : "somente estrutura"}**`,
    `- Registros exportados: **${total.toLocaleString("pt-BR")}**`,
    `- Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    "",
    "## Passo a passo",
    ...dest.howTo.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Arquivos do pacote",
    ...files.map((f) => `- \`${f}\``),
    "",
    "## Registros por tabela",
    ...Object.entries(rowCounts).map(([t, c]) => `- ${t}: ${c.toLocaleString("pt-BR")}`),
    "",
    "## Avisos da pré-validação",
    ...(warnings.length
      ? warnings.map((w) => `- **${w.level.toUpperCase()}**${w.table ? ` (${w.table})` : ""}: ${w.message}`)
      : ["- Nenhum aviso."]),
    "",
    "## Importante",
    "- Senhas e sessões de usuários nunca são exportadas.",
    "- Arquivos anexados (originais em HTML) não entram neste pacote; use o backup completo para levá-los.",
    "",
  ].join("\n");
}

/** Gera o pacote de migração e devolve um link temporário para download. */
export const buildDbMigrationPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => buildSchema.parse(d))
  .handler(async ({ data, context }): Promise<MigrationPackageResult> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildStoreZip, toZipBytes } = await import("@/lib/zip-store-writer");

    const snapshot = await loadSnapshot(context);
    const tableByName = new Map(snapshot.tables.map((t) => [t.name, t]));
    const exported: SchemaTable[] = MIGRATION_TABLES.map((t) => tableByName.get(t)).filter(
      (t): t is SchemaTable => Boolean(t),
    );
    const exportSnapshot: SchemaSnapshot = { ...snapshot, tables: exported };

    const entries: Array<{ path: string; data: Uint8Array }> = [];
    const add = (path: string, content: string) =>
      entries.push({ path, data: toZipBytes(content) });

    const rowCounts: Record<string, number> = {};
    const rowsByTable: Record<string, Array<Record<string, unknown>>> = {};
    if (data.mode === "full") {
      for (const table of MIGRATION_TABLES) {
        const rows = await fetchRows(supabaseAdmin, table, data.env);
        rowsByTable[table] = rows;
        rowCounts[table] = rows.length;
      }
    } else {
      for (const table of MIGRATION_TABLES) rowCounts[table] = 0;
    }

    const isSql = data.destination === "supabase" || data.destination === "neon" || data.destination === "aws";

    if (isSql) {
      add(
        "01-schema.sql",
        buildPostgresSchemaSql(exportSnapshot, {
          includeSecurity: data.destination === "supabase",
          includeFunctions: data.destination === "supabase",
        }),
      );
      if (data.mode === "full") {
        const parts = exported.map((t) => buildPostgresDataSql(t, rowsByTable[t.name] ?? []));
        add("02-data.sql", ["BEGIN;", "", ...parts, "COMMIT;", ""].join("\n"));
      }
      if (data.destination === "supabase") {
        add("03-security.sql", buildPostgresSecuritySql(exportSnapshot));
      }
    }

    if (data.destination === "aws") {
      add(
        "dynamodb/tables.json",
        JSON.stringify(buildDynamoTableDefinitions(exported), null, 2),
      );
      if (data.mode === "full") {
        for (const table of exported) {
          add(
            `dynamodb/data/${table.name}.json`,
            JSON.stringify(buildDynamoItems(rowsByTable[table.name] ?? []), null, 2),
          );
        }
      }
    }

    if (data.destination === "firebase") {
      for (const table of exported) {
        add(
          `firestore/${table.name}.json`,
          JSON.stringify(buildFirestoreCollection(rowsByTable[table.name] ?? []), null, 2),
        );
      }
      add("import-firestore.js", buildFirestoreImportScript(exported.map((t) => t.name)));
    }

    if (data.destination === "mongodb") {
      for (const table of exported) {
        add(`mongodb/${table.name}.jsonl`, buildMongoJsonl(rowsByTable[table.name] ?? []));
      }
      add(
        "mongodb/indexes.json",
        JSON.stringify(
          exported.map((t) => ({
            collection: t.name,
            indexes: t.columns
              .filter((c) => c.name.endsWith("_id") || c.name === "created_at" || c.name === "env")
              .map((c) => ({ key: { [c.name]: 1 } })),
          })),
          null,
          2,
        ),
      );
    }

    const warnings = validateForDestination(exportSnapshot, data.destination, rowCounts);
    add("schema-snapshot.json", JSON.stringify(exportSnapshot, null, 2));
    const files = entries.map((e) => e.path).sort();
    add("LEIA-ME.md", readme(data.destination, data.mode, data.env, rowCounts, files, warnings));

    const zip = await buildStoreZip(entries, { modifiedAt: new Date() });
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const envLabel = data.env === "sandbox" ? "teste" : "producao";
    const filename = `stargames-migracao-${data.destination}-${envLabel}-${stamp}.zip`;
    const storagePath = `migrations/${envLabel}/${filename}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, zip, { contentType: "application/zip", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 30);
    if (signErr || !signed) throw new Error(signErr?.message ?? "Falha ao gerar link de download.");

    return {
      url: signed.signedUrl,
      filename,
      sizeBytes: zip.byteLength,
      storagePath,
      rowCounts,
      totalRows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
      warnings,
      files: [...files, "LEIA-ME.md"],
    };
  });