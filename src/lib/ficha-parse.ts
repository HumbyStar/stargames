import type { CustomerFiscalData } from "@/lib/customer-data-ai.functions";

/**
 * Ficha do Cliente — formato canônico plain-text.
 *
 * Este módulo faz o round-trip entre um `CustomerFiscalData` estruturado e a
 * string armazenada em `clients.customer_data`. É puro, síncrono e testável,
 * sem qualquer chamada de rede/IA.
 */

export type FichaData = Partial<CustomerFiscalData>;

const LABELS: Array<[keyof CustomerFiscalData, string]> = [
  ["fullName", "Nome"],
  ["cpfCnpj", "CPF"],
  ["state", "Estado"],
  ["city", "Cidade"],
  ["neighborhood", "Bairro"],
  ["street", "Rua"],
  ["number", "Número"],
  ["cep", "CEP"],
  ["complement", "Complemento"],
  ["phone", "Telefone"],
  ["email", "E-mail"],
  ["notes", "Obs"],
];

const LABEL_TO_KEY: Record<string, keyof CustomerFiscalData> = (() => {
  const map: Record<string, keyof CustomerFiscalData> = {};
  for (const [k, label] of LABELS) map[normalizeLabel(label)] = k;
  // Aliases tolerantes
  map[normalizeLabel("Nome completo")] = "fullName";
  map[normalizeLabel("CPF/CNPJ")] = "cpfCnpj";
  map[normalizeLabel("CNPJ")] = "cpfCnpj";
  map[normalizeLabel("UF")] = "state";
  map[normalizeLabel("Endereço")] = "street";
  map[normalizeLabel("Numero")] = "number";
  map[normalizeLabel("Email")] = "email";
  map[normalizeLabel("Celular")] = "phone";
  map[normalizeLabel("Observação")] = "notes";
  map[normalizeLabel("Observações")] = "notes";
  return map;
})();

function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Faz o parse de um texto no formato canônico (ou próximo dele) em campos
 * estruturados. Linhas que não batem com um label conhecido são ignoradas
 * pelo parser, mas continuam sendo válidas para o modo textarea livre.
 */
export function parseFichaFromText(text: string): FichaData {
  const out: FichaData = {};
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:]{1,40}?)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = LABEL_TO_KEY[normalizeLabel(m[1])];
    if (!key) continue;
    const value = m[2].trim();
    if (!value) continue;
    if (key === "cpfCnpj") out.cpfCnpj = value.replace(/\D/g, "");
    else if (key === "cep") out.cep = value.replace(/\D/g, "").slice(0, 8);
    else if (key === "phone") out.phone = value.replace(/\D/g, "");
    else if (key === "state") out.state = value.toUpperCase().slice(0, 2);
    else out[key] = value as never;
  }
  return out;
}

/**
 * Considera a ficha "preenchida" quando Nome + CPF + CEP existem.
 * Esses três campos são o mínimo para gerar cabeçalho de nota fiscal.
 */
export function isFichaComplete(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  const f = parseFichaFromText(text);
  return Boolean(f.fullName && f.cpfCnpj && f.cep);
}

/**
 * Serializa a ficha no formato canônico. Campos vazios são omitidos.
 * Telefone cai para `phoneFallback` (client.phone) se não informado.
 */
export function renderFichaText(f: FichaData, phoneFallback?: string): string {
  const merged: FichaData = { ...f };
  if (!merged.phone && phoneFallback) merged.phone = phoneFallback.replace(/\D/g, "");
  const lines: string[] = [];
  for (const [key, label] of LABELS) {
    const raw = merged[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

/** Retorna uma ficha pronta para edição, priorizando parse do texto e caindo
 * para valores default (ex.: telefone do cliente). */
export function fichaFromTextWithDefaults(
  text: string | null | undefined,
  defaults: { phone?: string } = {},
): FichaData {
  const parsed = parseFichaFromText(text ?? "");
  if (!parsed.phone && defaults.phone) {
    parsed.phone = defaults.phone.replace(/\D/g, "");
  }
  return parsed;
}

const FISCAL_KEYS: Array<Exclude<keyof CustomerFiscalData, "missing">> = [
  "fullName",
  "cpfCnpj",
  "email",
  "phone",
  "cep",
  "street",
  "number",
  "complement",
  "neighborhood",
  "city",
  "state",
  "notes",
];

/**
 * Converte a ficha em `CustomerFiscalData` completo, 100% determinístico
 * (sem IA). Usa o parser canônico e preenche `missing` com os campos vazios.
 */
export function fiscalDataFromFichaText(
  text: string | null | undefined,
  defaults: { phone?: string } = {},
): CustomerFiscalData {
  const parsed = fichaFromTextWithDefaults(text, defaults);
  const out = {} as CustomerFiscalData;
  const missing: string[] = [];
  for (const key of FISCAL_KEYS) {
    const value = typeof parsed[key] === "string" ? (parsed[key] as string).trim() : "";
    out[key] = value;
    if (!value) missing.push(key);
  }
  out.missing = missing;
  return out;
}