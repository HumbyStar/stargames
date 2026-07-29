// Configuração de clonagem produção -> sandbox.
// Como as linhas ficam na MESMA tabela (separadas pela coluna `env`),
// os UUIDs precisam ser regerados e as chaves estrangeiras reescritas.

export interface CloneTable {
  name: string;
  /** Coluna de id que precisa de novo UUID (undefined = mantém a chave original) */
  idColumn?: string;
  /** Colunas FK -> tabela de origem do id */
  fks?: Record<string, string>;
  /** Colunas com array de ids -> tabela de origem */
  arrayFks?: Record<string, string>;
}

export const CLONE_ORDER: CloneTable[] = [
  { name: "clients", idColumn: "id" },
  { name: "mgmv_agreements", idColumn: "id", fks: { client_id: "clients" } },
  { name: "mgmv_installments", idColumn: "id", fks: { agreement_id: "mgmv_agreements" } },
  {
    name: "products",
    idColumn: "id",
    fks: { client_id: "clients", mgmv_agreement_id: "mgmv_agreements" },
  },
  {
    name: "nf_invoices",
    idColumn: "id",
    fks: { client_id: "clients" },
    arrayFks: { product_ids: "products" },
  },
  { name: "import_history", idColumn: "id" },
  {
    name: "team_tasks",
    idColumn: "id",
    fks: { client_id: "clients", product_id: "products" },
  },
  { name: "team_task_comments", idColumn: "id", fks: { task_id: "team_tasks" } },
  { name: "team_task_activity", idColumn: "id", fks: { task_id: "team_tasks" } },
  { name: "team_punch_entries", idColumn: "id" },
  { name: "saved_filters", idColumn: "id" },
  { name: "ai_automations", idColumn: "id" },
  { name: "app_settings" },
  { name: "ai_training_profile" },
];

export const SANDBOX_TABLES = CLONE_ORDER.map((t) => t.name);

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function remapRow(
  table: CloneTable,
  row: Record<string, unknown>,
  idMaps: Record<string, Record<string, string>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row, env: "sandbox" };

  if (table.idColumn) {
    const original = row[table.idColumn];
    if (typeof original === "string") {
      const mapped = newId();
      idMaps[table.name] = idMaps[table.name] ?? {};
      idMaps[table.name][original] = mapped;
      next[table.idColumn] = mapped;
    }
  }

  for (const [column, source] of Object.entries(table.fks ?? {})) {
    const value = row[column];
    if (typeof value === "string") {
      next[column] = idMaps[source]?.[value] ?? null;
    }
  }

  for (const [column, source] of Object.entries(table.arrayFks ?? {})) {
    const value = row[column];
    if (Array.isArray(value)) {
      next[column] = value
        .map((item) => (typeof item === "string" ? idMaps[source]?.[item] ?? null : null))
        .filter((item): item is string => Boolean(item));
    }
  }

  return next;
}