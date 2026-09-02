/**
 * Formatação pura da Segmentação de Clientes (testável, sem I/O).
 */
import { toCsv, toE164 } from "@/lib/meta-export-format";

export type SegmentBasis = "total" | "paid" | "total_all";
export type SegmentSort =
  | "value_desc"
  | "value_asc"
  | "count_desc"
  | "count_asc"
  | "name_asc"
  | "name_desc";

export interface SegmentRow {
  clientId: string;
  name: string;
  phone: string;
  email: string;
  productsCount: number;
  spent: number;
}

export interface SegmentProduct {
  id: string;
  name: string;
  platform: string;
  category: string;
  registerDate: string;
  situation: string;
  financialStatus: string;
  value: number;
}

export const BASIS_LABEL: Record<SegmentBasis, string> = {
  total: "Valor total dos produtos válidos",
  paid: "Somente valor efetivamente pago",
  total_all: "Valor total sem exclusões",
};

export const SORT_LABEL: Record<SegmentSort, string> = {
  value_desc: "Maior valor gasto",
  value_asc: "Menor valor gasto",
  count_desc: "Mais produtos",
  count_asc: "Menos produtos",
  name_asc: "Nome A-Z",
  name_desc: "Nome Z-A",
};

/** Situações consideradas inválidas por padrão (canceladas / devolvidas). */
export const DEFAULT_EXCLUDED = ["Cancelado", "Devolvido", "Estornado", "Reembolsado"];

export const FULL_HEADERS = [
  "nome",
  "telefone",
  "email",
  "produtos",
  "valor_gasto",
  "categoria_filtro",
] as const;

export const MARKETING_HEADERS = ["nome", "telefone", "email"] as const;

/** Telefone no padrão de mídia paga: país+DDD+número, só dígitos. */
export function marketingPhone(raw: string): string {
  return toE164(raw).replace(/^\+/, "");
}

export function fullRow(r: SegmentRow, categoryLabel: string): (string | number)[] {
  return [r.name, marketingPhone(r.phone) || r.phone, r.email, r.productsCount, r.spent, categoryLabel];
}

export function marketingRow(r: SegmentRow): string[] {
  return [r.name, marketingPhone(r.phone), r.email];
}

export function buildFullCsv(rows: SegmentRow[], categoryLabel: string): string {
  return toCsv([[...FULL_HEADERS], ...rows.map((r) => fullRow(r, categoryLabel))]);
}

export function buildMarketingCsv(rows: SegmentRow[]): string {
  return toCsv([[...MARKETING_HEADERS], ...rows.map(marketingRow)]);
}

export function buildMarketingTxt(rows: SegmentRow[]): string {
  return rows
    .map((r) => marketingPhone(r.phone))
    .filter(Boolean)
    .join("\n");
}

export function segmentFileName(prefix: string, ext: string, summary: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = summary
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${prefix}-${date}${slug ? `-${slug}` : ""}.${ext}`;
}
