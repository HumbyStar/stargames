export const RESTORE_KEY_COLUMNS: Record<string, string[]> = {
  app_settings: ["id", "env"],
  ai_training_profile: ["user_id", "env"],
  team_punch_entries: ["user_id", "day", "kind", "env"],
};

export function restoreRowKey(table: string, row: Record<string, unknown>): string | null {
  const columns = RESTORE_KEY_COLUMNS[table] ?? ["id"];
  const values = columns.map((column) => row[column]);
  if (values.some((value) => value === null || value === undefined || value === "")) return null;
  return values.map((value) => String(value)).join("\u0000");
}

export function dedupeRestoreRows(
  table: string,
  rows: Array<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; removed: number } {
  const unique = new Map<string, Record<string, unknown>>();
  const withoutKey: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const key = restoreRowKey(table, row);
    if (key === null) withoutKey.push(row);
    else unique.set(key, row);
  }
  const deduped = [...unique.values(), ...withoutKey];
  return { rows: deduped, removed: rows.length - deduped.length };
}