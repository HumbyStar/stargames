/**
 * Dados Meta — normalização, filtros e geração de arquivos de exportação.
 *
 * Módulo 100% puro (sem rede, sem IA): recebe os leads já agregados pelo
 * servidor e devolve o conjunto filtrado + os arquivos prontos para o
 * Meta Business (Customer List), planilha analítica e XLSX.
 */

export interface MetaLeadFicha {
  fullName: string;
  cpfCnpj: string;
  email: string;
  phone: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface MetaLead {
  id: string;
  name: string;
  phone: string;
  clientType: "mgmv" | "common";
  createdAt: string;
  folder: string;
  productCount: number;
  totalValue: number;
  paidValue: number;
  openValue: number;
  avgTicket: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  platforms: string[];
  situations: string[];
  financialStatuses: string[];
  hasShipment: boolean;
  mgmvStatus: string;
  ficha: MetaLeadFicha;
}

export interface MetaFilters {
  clientType: "all" | "mgmv" | "common";
  totalMin: number | null;
  totalMax: number | null;
  states: string[];
  city: string;
  cepPrefix: string;
  ddd: string;
  onlyMobile: boolean;
  requirePhone: boolean;
  clientSinceDays: number | null;
  clientUntilDays: number | null;
  situations: string[];
  financialStatuses: string[];
  lastPurchaseWithinDays: number | null;
  inactiveForDays: number | null;
  minProducts: number | null;
  maxProducts: number | null;
  avgTicketMin: number | null;
  platforms: string[];
  openValue: "any" | "none" | "only";
  mgmvStatus: "any" | "active" | "settled";
  shipment: "any" | "with" | "without";
  requireEmail: boolean;
  requireCpf: boolean;
  requireAddress: boolean;
  folder: string;
  dedupePhone: boolean;
  search: string;
}

export const EMPTY_FILTERS: MetaFilters = {
  clientType: "all",
  totalMin: null,
  totalMax: null,
  states: [],
  city: "",
  cepPrefix: "",
  ddd: "",
  onlyMobile: false,
  requirePhone: false,
  clientSinceDays: null,
  clientUntilDays: null,
  situations: [],
  financialStatuses: [],
  lastPurchaseWithinDays: null,
  inactiveForDays: null,
  minProducts: null,
  maxProducts: null,
  avgTicketMin: null,
  platforms: [],
  openValue: "any",
  mgmvStatus: "any",
  shipment: "any",
  requireEmail: false,
  requireCpf: false,
  requireAddress: false,
  folder: "",
  dedupePhone: false,
  search: "",
};

/* -------------------------------------------------------------------------- */
/* Normalização                                                                */
/* -------------------------------------------------------------------------- */

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** Telefone brasileiro em E.164 (+55DDDNUMERO). Retorna "" se inválido. */
export function toE164(raw: string): string {
  let d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return "";
  return `+55${d}`;
}

export function phoneDdd(raw: string): string {
  const d = onlyDigits(raw).replace(/^55/, "");
  return d.length >= 10 ? d.slice(0, 2) : "";
}

export function isMobilePhone(raw: string): boolean {
  const d = onlyDigits(raw).replace(/^55/, "");
  return d.length === 11 && d[2] === "9";
}

export function normText(s: string): string {
  return stripAccents(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normEmail(s: string): string {
  return (s || "").trim().toLowerCase();
}

export function splitName(full: string): { first: string; last: string } {
  const parts = normText(full).split(" ").filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

export async function sha256Hex(value: string): Promise<string> {
  if (!value) return "";
  const buf = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Completude da ficha                                                         */
/* -------------------------------------------------------------------------- */

const FIELD_LABELS: Record<string, string> = {
  fullName: "nome completo",
  cpfCnpj: "CPF/CNPJ",
  email: "e-mail",
  phone: "telefone",
  cep: "CEP",
  city: "cidade",
  state: "UF",
  street: "endereço",
};

/**
 * Ficha considerada apta para campanha: nome + telefone + (e-mail ou CPF)
 * + localização (UF ou cidade). Sem isso o Meta casa muito pouco.
 */
export function missingFields(lead: MetaLead): string[] {
  const f = lead.ficha;
  const miss: string[] = [];
  if (!f.fullName && !lead.name) miss.push("fullName");
  if (!toE164(f.phone || lead.phone)) miss.push("phone");
  if (!f.email && !f.cpfCnpj) miss.push("email");
  if (!f.state && !f.city) miss.push("state");
  if (!f.cep) miss.push("cep");
  return miss;
}

export function missingLabels(lead: MetaLead): string[] {
  return missingFields(lead).map((k) => FIELD_LABELS[k] ?? k);
}

export function isLeadComplete(lead: MetaLead): boolean {
  return missingFields(lead).length === 0;
}

/* -------------------------------------------------------------------------- */
/* Filtro                                                                      */
/* -------------------------------------------------------------------------- */

function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

export function filterLeads(
  leads: MetaLead[],
  filters: MetaFilters,
  now: number = Date.now(),
): MetaLead[] {
  const f = filters;
  const search = normText(f.search);
  const states = new Set(f.states.map((s) => s.toUpperCase()));
  const city = normText(f.city);
  const platforms = new Set(f.platforms.map(normText));
  const situations = new Set(f.situations);
  const finStatuses = new Set(f.financialStatuses);
  const folder = normText(f.folder);

  const out = leads.filter((l) => {
    if (f.clientType !== "all" && l.clientType !== f.clientType) return false;
    if (f.totalMin !== null && l.totalValue < f.totalMin) return false;
    if (f.totalMax !== null && l.totalValue > f.totalMax) return false;

    if (states.size && !states.has((l.ficha.state || "").toUpperCase())) return false;
    if (city && !normText(l.ficha.city).includes(city)) return false;
    if (f.cepPrefix && !onlyDigits(l.ficha.cep).startsWith(onlyDigits(f.cepPrefix))) return false;

    const phone = l.ficha.phone || l.phone;
    if (f.requirePhone && !toE164(phone)) return false;
    if (f.ddd && phoneDdd(phone) !== onlyDigits(f.ddd)) return false;
    if (f.onlyMobile && !isMobilePhone(phone)) return false;

    const ageDays = daysBetween(l.createdAt, now);
    if (f.clientSinceDays !== null && (ageDays === null || ageDays < f.clientSinceDays)) return false;
    if (f.clientUntilDays !== null && (ageDays === null || ageDays > f.clientUntilDays)) return false;

    if (situations.size && !l.situations.some((s) => situations.has(s))) return false;
    if (finStatuses.size && !l.financialStatuses.some((s) => finStatuses.has(s))) return false;

    const lastDays = daysBetween(l.lastPurchase, now);
    if (f.lastPurchaseWithinDays !== null && (lastDays === null || lastDays > f.lastPurchaseWithinDays))
      return false;
    if (f.inactiveForDays !== null && (lastDays === null || lastDays < f.inactiveForDays)) return false;

    if (f.minProducts !== null && l.productCount < f.minProducts) return false;
    if (f.maxProducts !== null && l.productCount > f.maxProducts) return false;
    if (f.avgTicketMin !== null && l.avgTicket < f.avgTicketMin) return false;

    if (platforms.size && !l.platforms.some((p) => platforms.has(normText(p)))) return false;

    if (f.openValue === "none" && l.openValue > 0.009) return false;
    if (f.openValue === "only" && l.openValue <= 0.009) return false;

    if (f.mgmvStatus === "active" && l.mgmvStatus !== "Ativo") return false;
    if (f.mgmvStatus === "settled" && l.mgmvStatus !== "Quitado") return false;

    if (f.shipment === "with" && !l.hasShipment) return false;
    if (f.shipment === "without" && l.hasShipment) return false;

    if (f.requireEmail && !l.ficha.email) return false;
    if (f.requireCpf && !l.ficha.cpfCnpj) return false;
    if (f.requireAddress && !(l.ficha.cep && l.ficha.city && l.ficha.state)) return false;

    if (folder && !normText(l.folder).includes(folder)) return false;

    if (search) {
      const hay = normText(`${l.name} ${l.phone} ${l.ficha.fullName} ${l.ficha.email}`);
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (!f.dedupePhone) return out;
  const seen = new Set<string>();
  return out.filter((l) => {
    const key = onlyDigits(l.ficha.phone || l.phone).slice(-8);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export const META_HEADERS = [
  "email",
  "phone",
  "fn",
  "ln",
  "ct",
  "st",
  "zip",
  "country",
  "extern_id",
] as const;

/** Linha no padrão Customer List do Meta, já normalizada (e opcionalmente com hash). */
export async function metaRow(lead: MetaLead, hash: boolean): Promise<string[]> {
  const f = lead.ficha;
  const { first, last } = splitName(f.fullName || lead.name);
  const raw = {
    email: normEmail(f.email),
    phone: toE164(f.phone || lead.phone),
    fn: first,
    ln: last,
    ct: normText(f.city),
    st: (f.state || "").toLowerCase(),
    zip: onlyDigits(f.cep),
    country: "br",
  };
  const values = [raw.email, raw.phone, raw.fn, raw.ln, raw.ct, raw.st, raw.zip, raw.country];
  const out = hash
    ? await Promise.all(values.map((v) => sha256Hex(v)))
    : values;
  // country nunca é hasheado no padrão do Meta
  out[7] = raw.country;
  return [...out, lead.id];
}

export async function buildMetaCsv(leads: MetaLead[], hash: boolean): Promise<string> {
  const rows: (string | number)[][] = [[...META_HEADERS]];
  for (const l of leads) rows.push(await metaRow(l, hash));
  return toCsv(rows);
}

export const ANALYTIC_HEADERS = [
  "id",
  "nome_sistema",
  "nome_ficha",
  "telefone",
  "telefone_e164",
  "email",
  "cpf_cnpj",
  "cep",
  "rua",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "tipo_cliente",
  "status_mgmv",
  "pasta",
  "produtos",
  "total_comprado",
  "total_pago",
  "valor_em_aberto",
  "ticket_medio",
  "primeira_compra",
  "ultima_compra",
  "cliente_desde",
  "dias_como_cliente",
  "plataformas",
  "situacoes",
  "status_financeiros",
  "teve_envio",
  "ficha_completa",
  "campos_faltando",
] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function money(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

export function analyticRow(lead: MetaLead, now = Date.now()): (string | number)[] {
  const f = lead.ficha;
  const days = daysBetween(lead.createdAt, now);
  return [
    lead.id,
    lead.name,
    f.fullName,
    lead.phone,
    toE164(f.phone || lead.phone),
    f.email,
    f.cpfCnpj,
    f.cep,
    f.street,
    f.number,
    f.complement,
    f.neighborhood,
    f.city,
    f.state,
    lead.clientType === "mgmv" ? "MGMV" : "Comum",
    lead.mgmvStatus,
    lead.folder,
    lead.productCount,
    money(lead.totalValue),
    money(lead.paidValue),
    money(lead.openValue),
    money(lead.avgTicket),
    fmtDate(lead.firstPurchase),
    fmtDate(lead.lastPurchase),
    fmtDate(lead.createdAt),
    days ?? "",
    lead.platforms.join(" | "),
    lead.situations.join(" | "),
    lead.financialStatuses.join(" | "),
    lead.hasShipment ? "sim" : "não",
    isLeadComplete(lead) ? "sim" : "não",
    missingLabels(lead).join(", "),
  ];
}

export function buildAnalyticCsv(leads: MetaLead[], now = Date.now()): string {
  return toCsv([[...ANALYTIC_HEADERS], ...leads.map((l) => analyticRow(l, now))]);
}

export function buildPhoneList(leads: MetaLead[]): string {
  return leads
    .map((l) => toE164(l.ficha.phone || l.phone))
    .filter(Boolean)
    .join("\n");
}

/** Nome de arquivo com data e resumo curto do filtro aplicado. */
export function exportFileName(prefix: string, ext: string, summary: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const slug = stripAccents(summary)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return [prefix, stamp, slug].filter(Boolean).join("-") + "." + ext;
}

/** Resumo textual dos filtros ativos — usado no nome do arquivo e no log. */
export function summarizeFilters(f: MetaFilters): string {
  const parts: string[] = [];
  if (f.clientType !== "all") parts.push(f.clientType === "mgmv" ? "mgmv" : "comum");
  if (f.states.length) parts.push(f.states.join("+"));
  if (f.city) parts.push(f.city);
  if (f.totalMin !== null) parts.push(`min${f.totalMin}`);
  if (f.totalMax !== null) parts.push(`max${f.totalMax}`);
  if (f.clientSinceDays !== null) parts.push(`+${f.clientSinceDays}d`);
  if (f.inactiveForDays !== null) parts.push(`inativo${f.inactiveForDays}d`);
  if (f.lastPurchaseWithinDays !== null) parts.push(`recente${f.lastPurchaseWithinDays}d`);
  if (f.platforms.length) parts.push(f.platforms.slice(0, 2).join("+"));
  if (f.situations.length) parts.push(f.situations.slice(0, 2).join("+"));
  if (f.openValue !== "any") parts.push(f.openValue === "none" ? "sem-pendencia" : "com-pendencia");
  if (f.shipment !== "any") parts.push(f.shipment === "with" ? "com-envio" : "sem-envio");
  return parts.join("-") || "todos";
}
