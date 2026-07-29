import { formatBRL } from "@/lib/store";
import type { CustomerFiscalData } from "@/lib/customer-data-ai.functions";

export interface NfProduct {
  id: string;
  name: string;
  platform: string;
  totalValue: number;
}

export interface NfClassification {
  id: string;
  ncm: string; // dígitos ou já mascarado
  category: string;
}

export interface NfGroup {
  ncm: string; // mascarado
  category: string;
  items: NfProduct[];
  subtotal: number;
}

export const REQUIRED_FISCAL_FIELDS: Array<keyof CustomerFiscalData> = [
  "fullName",
  "cpfCnpj",
  "cep",
  "street",
  "number",
  "neighborhood",
  "city",
  "state",
];

export function missingFiscalFields(f: CustomerFiscalData): string[] {
  const labels: Record<string, string> = {
    fullName: "Nome",
    cpfCnpj: "CPF/CNPJ",
    cep: "CEP",
    street: "Endereço",
    number: "Número",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "UF",
  };
  return REQUIRED_FISCAL_FIELDS.filter((k) => !String(f[k] ?? "").trim()).map(
    (k) => labels[k as string],
  );
}

/** Formata NCM como 0000.00.00. Aceita entrada com ou sem pontos. */
export function formatNcm(raw: string): string {
  const d = (raw || "").replace(/\D/g, "").slice(0, 8);
  if (d.length < 8) return raw || "—";
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

function formatCpfCnpj(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 11)
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return raw;
}

function formatCep(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return raw;
}

export function buildFiscalHeader(f: CustomerFiscalData): string {
  const addr = [f.street, f.number].filter(Boolean).join(", ");
  const complement = f.complement ? ` – ${f.complement}` : "";
  const neighborhood = f.neighborhood ? ` – ${f.neighborhood}` : "";
  const cityUf = [f.city, f.state].filter(Boolean).join("/");
  const line3 = `Endereço: ${addr}${complement}${neighborhood}${cityUf ? ` – ${cityUf}` : ""}`;
  return [
    f.fullName,
    `CPF: ${formatCpfCnpj(f.cpfCnpj)}`,
    line3,
    `CEP: ${formatCep(f.cep)}`,
  ].join("\n");
}

const UNCLASSIFIED_KEY = "__unclassified__";

export function groupByNcm(
  products: NfProduct[],
  classifications: NfClassification[],
): NfGroup[] {
  const byId = new Map(classifications.map((c) => [c.id, c]));
  const groups = new Map<string, NfGroup>();
  for (const p of products) {
    const cls = byId.get(p.id);
    const digits = (cls?.ncm ?? "").replace(/\D/g, "");
    const key = digits.length === 8 ? digits : UNCLASSIFIED_KEY;
    const category =
      key === UNCLASSIFIED_KEY
        ? "Sem classificação (revisar)"
        : cls?.category?.trim() || "Sem categoria";
    const ncm = key === UNCLASSIFIED_KEY ? "—" : formatNcm(digits);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(p);
      existing.subtotal += p.totalValue;
    } else {
      groups.set(key, { ncm, category, items: [p], subtotal: p.totalValue });
    }
  }
  const arr = Array.from(groups.entries());
  arr.sort(([ka, a], [kb, b]) => {
    if (ka === UNCLASSIFIED_KEY) return 1;
    if (kb === UNCLASSIFIED_KEY) return -1;
    return a.category.localeCompare(b.category, "pt-BR");
  });
  return arr.map(([, g]) => g);
}

export function renderNfText(header: string, groups: NfGroup[]): string {
  const total = groups.reduce((s, g) => s + g.subtotal, 0);
  const lines: string[] = [header, ""];
  groups.forEach((g, i) => {
    lines.push(`Lote ${i + 1} – ${g.category}`);
    g.items.forEach((it) => {
      const platform = it.platform ? ` (${it.platform})` : "";
      lines.push(`  • ${it.name}${platform} — ${formatBRL(it.totalValue)}`);
    });
    lines.push(`Quantidade: ${g.items.length}`);
    lines.push(`NCM: ${g.ncm}`);
    lines.push(`Subtotal lote: ${formatBRL(g.subtotal)}`);
    lines.push("");
  });
  lines.push(`VALOR TOTAL DA NOTA: ${formatBRL(total)}`);
  return lines.join("\n");
}