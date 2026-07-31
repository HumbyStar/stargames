// ---------------------------------------------------------------------------
// Conversores de formato para a migração do banco para outras nuvens.
// Módulo puro (sem acesso a rede/banco) para poder ser testado e usado tanto
// no servidor quanto na interface.
// ---------------------------------------------------------------------------

export type MigrationDestinationId =
  | "supabase"
  | "neon"
  | "aws"
  | "firebase"
  | "mongodb";

export type MigrationMode = "full" | "schema";

export interface MigrationDestination {
  id: MigrationDestinationId;
  label: string;
  vendor: string;
  kind: "sql" | "nosql" | "mixed";
  summary: string;
  /** Como o pacote é aplicado no destino. */
  howTo: string[];
}

export const MIGRATION_DESTINATIONS: MigrationDestination[] = [
  {
    id: "supabase",
    label: "Supabase (projeto novo)",
    vendor: "Supabase",
    kind: "sql",
    summary:
      "Clone completo em PostgreSQL, com tipos, índices, funções, gatilhos, permissões e políticas de segurança (RLS).",
    howTo: [
      "Crie o projeto novo no Supabase.",
      "Abra o SQL Editor e rode 01-schema.sql.",
      "Rode 02-data.sql (se você escolheu incluir os dados).",
      "Rode 03-security.sql para recriar permissões e regras de acesso.",
      "Recrie os usuários pelo painel de autenticação — senhas nunca são exportadas.",
    ],
  },
  {
    id: "neon",
    label: "Neon / PostgreSQL gerenciado",
    vendor: "Neon",
    kind: "sql",
    summary:
      "PostgreSQL puro, sem as extensões e papéis exclusivos do Supabase. Serve para Neon, Railway, Render e qualquer Postgres.",
    howTo: [
      "Crie o banco no provedor.",
      "Rode 01-schema.sql e depois 02-data.sql com psql ou pelo editor SQL.",
      "Crie seus próprios papéis de acesso: as políticas do Supabase não são aplicadas aqui.",
    ],
  },
  {
    id: "aws",
    label: "Amazon AWS (RDS + DynamoDB)",
    vendor: "Amazon Web Services",
    kind: "mixed",
    summary:
      "Dois caminhos no mesmo pacote: SQL pronto para o RDS PostgreSQL e itens em JSON prontos para carga no DynamoDB.",
    howTo: [
      "Relacional: rode 01-schema.sql e 02-data.sql na instância RDS PostgreSQL.",
      "NoSQL: crie as tabelas descritas em dynamodb/tables.json.",
      "Carregue cada arquivo dynamodb/data/<tabela>.json com BatchWriteItem (lotes de 25 itens).",
    ],
  },
  {
    id: "firebase",
    label: "Google Firebase (Firestore)",
    vendor: "Google Cloud",
    kind: "nosql",
    summary:
      "Uma coleção por tabela, com os identificadores originais preservados como ID de documento.",
    howTo: [
      "Crie o projeto no Firebase e ative o Firestore.",
      "Use o script import-firestore.js (Node + firebase-admin) apontando para firestore/<coleção>.json.",
      "Recrie as regras de segurança: o Firestore não entende as regras do PostgreSQL.",
    ],
  },
  {
    id: "mongodb",
    label: "MongoDB Atlas",
    vendor: "MongoDB",
    kind: "nosql",
    summary:
      "Uma coleção por tabela em JSON de linha única (formato aceito pelo mongoimport).",
    howTo: [
      "Crie o cluster no Atlas e pegue a string de conexão.",
      "Rode, para cada arquivo: mongoimport --uri \"<conexão>\" --collection <tabela> --file mongodb/<tabela>.jsonl",
      "Crie os índices sugeridos em mongodb/indexes.json.",
    ],
  },
];

export function destinationById(id: string): MigrationDestination | undefined {
  return MIGRATION_DESTINATIONS.find((d) => d.id === id);
}

// ---------------------------------------------------------------------------
// Retrato da estrutura do banco (retornado por public.export_db_schema_snapshot)
// ---------------------------------------------------------------------------

export interface SchemaColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
}

export interface SchemaConstraint {
  name: string;
  /** p = primary key, u = unique, f = foreign key, c = check */
  type: string;
  def: string;
}

export interface SchemaPolicy {
  name: string;
  cmd: string;
  roles: string[] | null;
  using: string | null;
  check: string | null;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  constraints: SchemaConstraint[];
  indexes: string[];
  rls: boolean;
  policies: SchemaPolicy[];
  grants: Array<{ grantee: string; privilege: string }>;
  triggers: string[];
}

export interface SchemaSnapshot {
  generatedAt: string;
  enums: Array<{ name: string; values: string[] }>;
  tables: SchemaTable[];
  functions: string[];
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

const POLICY_CMD_LABEL: Record<string, string> = {
  r: "SELECT",
  a: "INSERT",
  w: "UPDATE",
  d: "DELETE",
  "*": "ALL",
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Converte um valor vindo do PostgREST em literal SQL válido. */
export function sqlLiteral(value: unknown, pgType: string): string {
  if (value === null || value === undefined) return "NULL";
  const type = pgType.toLowerCase();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (type.endsWith("[]") && Array.isArray(value)) {
    const base = pgType.slice(0, -2);
    const items = value.map((v) =>
      v === null ? "NULL" : quoteLiteral(typeof v === "string" ? v : JSON.stringify(v)),
    );
    return `ARRAY[${items.join(", ")}]::${base}[]`;
  }
  if (typeof value === "object") {
    return `${quoteLiteral(JSON.stringify(value))}::jsonb`;
  }
  const text = String(value);
  if (type === "json" || type === "jsonb") return `${quoteLiteral(text)}::jsonb`;
  return quoteLiteral(text);
}

export interface PostgresSchemaOptions {
  /** Inclui políticas RLS, GRANTs e funções (só faz sentido em Supabase). */
  includeSecurity: boolean;
  /** Inclui funções e gatilhos definidos no schema public. */
  includeFunctions: boolean;
}

export function buildPostgresSchemaSql(
  snapshot: SchemaSnapshot,
  opts: PostgresSchemaOptions,
): string {
  const out: string[] = [];
  out.push("-- Estrutura do banco Star Games");
  out.push(`-- Gerado em ${snapshot.generatedAt}`);
  out.push("-- Execute este arquivo antes de qualquer carga de dados.");
  out.push("");
  out.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  out.push('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');
  out.push("");

  if (snapshot.enums.length) {
    out.push("-- Tipos personalizados");
    for (const e of snapshot.enums) {
      const values = e.values.map((v) => quoteLiteral(v)).join(", ");
      out.push("DO $$ BEGIN");
      out.push(`  CREATE TYPE public.${quoteIdent(e.name)} AS ENUM (${values});`);
      out.push("EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
    }
    out.push("");
  }

  out.push("-- Tabelas");
  for (const table of snapshot.tables) {
    const cols = table.columns.map((c) => {
      const parts = [`  ${quoteIdent(c.name)} ${c.type}`];
      if (c.default) parts.push(`DEFAULT ${c.default}`);
      if (c.notNull) parts.push("NOT NULL");
      return parts.join(" ");
    });
    out.push(`CREATE TABLE IF NOT EXISTS public.${quoteIdent(table.name)} (`);
    out.push(cols.join(",\n"));
    out.push(");");
    out.push("");
  }

  out.push("-- Chaves, unicidade e validações");
  for (const table of snapshot.tables) {
    for (const con of table.constraints) {
      out.push(
        `ALTER TABLE public.${quoteIdent(table.name)} ADD CONSTRAINT ${quoteIdent(con.name)} ${con.def};`,
      );
    }
  }
  out.push("");

  out.push("-- Índices");
  for (const table of snapshot.tables) {
    for (const idx of table.indexes) {
      out.push(`${idx.replace(/^CREATE INDEX /i, "CREATE INDEX IF NOT EXISTS ")};`);
    }
  }
  out.push("");

  if (opts.includeFunctions && snapshot.functions.length) {
    out.push("-- Funções do banco");
    for (const fn of snapshot.functions) {
      out.push(`${fn.trim().replace(/;?$/, "")};`);
      out.push("");
    }
    out.push("-- Gatilhos");
    for (const table of snapshot.tables) {
      for (const trg of table.triggers) out.push(`${trg};`);
    }
    out.push("");
  }

  return out.join("\n");
}

export function buildPostgresSecuritySql(snapshot: SchemaSnapshot): string {
  const out: string[] = [];
  out.push("-- Permissões e regras de acesso (Row Level Security)");
  out.push("-- Requer os papéis anon / authenticated / service_role do Supabase.");
  out.push("");
  for (const table of snapshot.tables) {
    const ident = `public.${quoteIdent(table.name)}`;
    const byGrantee = new Map<string, Set<string>>();
    for (const g of table.grants) {
      if (!byGrantee.has(g.grantee)) byGrantee.set(g.grantee, new Set());
      byGrantee.get(g.grantee)!.add(g.privilege);
    }
    for (const [grantee, privs] of byGrantee) {
      out.push(`GRANT ${[...privs].sort().join(", ")} ON ${ident} TO ${grantee};`);
    }
    if (table.rls) out.push(`ALTER TABLE ${ident} ENABLE ROW LEVEL SECURITY;`);
    for (const p of table.policies) {
      const cmd = POLICY_CMD_LABEL[p.cmd] ?? "ALL";
      const roles = p.roles?.length ? ` TO ${p.roles.join(", ")}` : "";
      const using = p.using ? ` USING (${p.using})` : "";
      const check = p.check ? ` WITH CHECK (${p.check})` : "";
      out.push(
        `CREATE POLICY ${quoteLiteral(p.name).slice(1, -1).length ? `"${p.name.replace(/"/g, '""')}"` : quoteIdent(p.name)} ON ${ident} FOR ${cmd}${roles}${using}${check};`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

export function buildPostgresDataSql(
  table: SchemaTable,
  rows: Array<Record<string, unknown>>,
  batchSize = 200,
): string {
  if (!rows.length) return `-- ${table.name}: nenhum registro exportado\n`;
  const columns = table.columns.map((c) => c.name);
  const typeByCol = new Map(table.columns.map((c) => [c.name, c.type]));
  const out: string[] = [`-- ${table.name}: ${rows.length} registro(s)`];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk.map((row) => {
      const cells = columns.map((col) => sqlLiteral(row[col], typeByCol.get(col) ?? "text"));
      return `  (${cells.join(", ")})`;
    });
    out.push(
      `INSERT INTO public.${quoteIdent(table.name)} (${columns.map(quoteIdent).join(", ")}) VALUES`,
    );
    out.push(`${values.join(",\n")}\nON CONFLICT DO NOTHING;`);
    out.push("");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// NoSQL
// ---------------------------------------------------------------------------

function documentIdFor(row: Record<string, unknown>, index: number): string {
  const candidate = row.id ?? row.user_id ?? row.session_id;
  if (typeof candidate === "string" && candidate) return candidate;
  if (typeof candidate === "number") return String(candidate);
  return `row-${index + 1}`;
}

/** Firestore: { "<docId>": { campos... } } por coleção. */
export function buildFirestoreCollection(
  rows: Array<Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  rows.forEach((row, i) => {
    out[documentIdFor(row, i)] = row;
  });
  return out;
}

/** MongoDB: um documento JSON por linha (mongoimport). */
export function buildMongoJsonl(rows: Array<Record<string, unknown>>): string {
  return rows
    .map((row, i) => {
      const { id, ...rest } = row as Record<string, unknown> & { id?: unknown };
      return JSON.stringify({ _id: id ?? documentIdFor(row, i), ...rest });
    })
    .join("\n");
}

function dynamoValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === "boolean") return { BOOL: value };
  if (typeof value === "number") return { N: String(value) };
  if (Array.isArray(value)) return { L: value.map(dynamoValue) };
  if (typeof value === "object") {
    const map: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) map[k] = dynamoValue(v);
    return { M: map };
  }
  const text = String(value);
  return text === "" ? { NULL: true } : { S: text };
}

/** DynamoDB: itens já no formato do BatchWriteItem. */
export function buildDynamoItems(
  rows: Array<Record<string, unknown>>,
): Array<{ PutRequest: { Item: Record<string, unknown> } }> {
  return rows.map((row, i) => {
    const item: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) item[k] = dynamoValue(v);
    if (!("id" in row)) item.id = { S: documentIdFor(row, i) };
    return { PutRequest: { Item: item } };
  });
}

export function buildDynamoTableDefinitions(tables: SchemaTable[]) {
  return tables.map((t) => ({
    TableName: `stargames_${t.name}`,
    KeySchema: [{ AttributeName: t.columns.some((c) => c.name === "id") ? "id" : t.columns[0].name, KeyType: "HASH" }],
    AttributeDefinitions: [
      {
        AttributeName: t.columns.some((c) => c.name === "id") ? "id" : t.columns[0].name,
        AttributeType: "S",
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  }));
}

// ---------------------------------------------------------------------------
// Pré-validação
// ---------------------------------------------------------------------------

export interface MigrationWarning {
  level: "info" | "warn" | "error";
  table?: string;
  message: string;
}

const NOSQL_UNSUPPORTED_HINTS = ["jsonb", "json", "[]", "uuid", "timestamp"];

export function validateForDestination(
  snapshot: SchemaSnapshot,
  destination: MigrationDestinationId,
  rowCounts: Record<string, number>,
): MigrationWarning[] {
  const warnings: MigrationWarning[] = [];
  const isNoSql = destination === "firebase" || destination === "mongodb";
  const isAws = destination === "aws";

  for (const table of snapshot.tables) {
    const count = rowCounts[table.name] ?? 0;
    if (table.rls && destination !== "supabase") {
      warnings.push({
        level: "warn",
        table: table.name,
        message:
          "As regras de acesso (RLS) desta tabela não são recriadas neste destino — configure a segurança manualmente.",
      });
    }
    if ((isNoSql || isAws) && count > 50_000) {
      warnings.push({
        level: "warn",
        table: table.name,
        message: `Volume alto (${count.toLocaleString("pt-BR")} registros): faça a carga em lotes para não estourar limites de escrita.`,
      });
    }
    if (isNoSql) {
      const complex = table.columns.filter((c) =>
        NOSQL_UNSUPPORTED_HINTS.some((h) => c.type.toLowerCase().includes(h)),
      );
      if (complex.length) {
        warnings.push({
          level: "info",
          table: table.name,
          message: `Campos convertidos para texto/objeto: ${complex.map((c) => c.name).join(", ")}.`,
        });
      }
    }
  }

  if (destination !== "supabase") {
    warnings.push({
      level: "info",
      message:
        "Usuários e senhas não são exportados em nenhum destino: recrie as contas e envie link de redefinição.",
    });
  }
  if (isNoSql) {
    warnings.push({
      level: "warn",
      message:
        "Bancos NoSQL não garantem integridade entre tabelas: as ligações entre cliente, produto e acordo passam a ser responsabilidade do aplicativo.",
    });
  }
  return warnings;
}

export function buildFirestoreImportScript(collections: string[]): string {
  return `// Importa os arquivos de firestore/ para o Firestore.
// 1) npm install firebase-admin
// 2) Baixe a chave de serviço do projeto e salve como service-account.json
// 3) node import-firestore.js

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(require("./service-account.json")),
});
const db = admin.firestore();

const COLLECTIONS = ${JSON.stringify(collections, null, 2)};

(async () => {
  for (const name of COLLECTIONS) {
    const file = path.join(__dirname, "firestore", name + ".json");
    if (!fs.existsSync(file)) continue;
    const docs = JSON.parse(fs.readFileSync(file, "utf8"));
    const ids = Object.keys(docs);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + 400)) {
        batch.set(db.collection(name).doc(id), docs[id]);
      }
      await batch.commit();
    }
    console.log(name + ": " + ids.length + " documentos");
  }
})();
`;
}