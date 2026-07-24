/**
 * Parser da modalidade "Importação por Lista Colada".
 *
 * Reconhece blocos do formato:
 *
 *   Grupo 1:
 *   Nome - Telefone - Produto (...) - Plataforma/Categoria - Valor - Status
 *   Nome - Telefone - Produto - Plataforma - Valor - Status
 *
 *   Grupo Action Figures:
 *   Nome - Telefone - Produto - Plataforma - Valor - Status
 *
 * Regras de campo na linha:
 *  - primeiro = cliente
 *  - segundo = telefone
 *  - último = status financeiro
 *  - penúltimo = valor total
 *  - antepenúltimo = plataforma/categoria
 *  - tudo entre telefone e plataforma/categoria = produto (pode ter " - ")
 */

export type ListReviewStatus = "ok" | "review_required" | "error";

export type ListFinancialStatus = "Pago" | "Reserva" | "Pendente" | "Revisão necessária";

export interface ListImportRow {
  /** id estável só para UI */
  id: string;
  /** número da linha original (1-based) no texto colado */
  lineNumber: number;
  /** texto original da linha */
  rawLine: string;
  /** grupo origem (Grupo 1, Grupo Action Figures, etc.) */
  sourceGroup: string;

  clientName: string;
  phone: string;
  phoneValid: boolean;

  productName: string;
  platformOrCategory: string;

  totalValue: number | null;
  paidValue: number | null;
  remainingValue: number | null;

  financialStatus: ListFinancialStatus;

  /** 0..1 — confiança no parser */
  confidence: number;
  warnings: string[];
  reviewStatus: ListReviewStatus;

  /** Quando true, o usuário marcou "ignorar". */
  ignored?: boolean;

  /** Quando true, possível duplicidade detectada. */
  duplicateCandidate?: boolean;
}

export interface ListImportClientGroup {
  /** chave nome+telefone normalizado */
  key: string;
  clientName: string;
  phone: string;
  rowIds: string[];
  totalValue: number;
  paidValue: number;
  remainingValue: number;
  status: ListFinancialStatus;
}

export interface ListImportPreview {
  rows: ListImportRow[];
  groups: string[];
  clients: ListImportClientGroup[];
  /**
   * Data (YYYY-MM-DD) informada no cabeçalho da lista colada, quando presente.
   * Ex.: primeira linha "25/06/2026" ou "Itens 25/06/2026". Usada pelo modal
   * de importação para gravar `registerDate` do produto na data marcada.
   */
  headerDate?: string;
  /**
   * Data limite (YYYY-MM-DD) informada no cabeçalho como
   * "Data Limite: DD/MM/AA". Aplicada apenas a itens "Reserva" durante
   * a confirmação; se ausente ou inválida (<= headerDate), o modal cai
   * de volta em `calculateReservaDueDate(registerDate)`.
   */
  headerDueDate?: string;
  totals: {
    lines: number;
    validRows: number;
    errorRows: number;
    reviewRows: number;
    paidRows: number;
    reservaRows: number;
    totalValue: number;
    paidValue: number;
    openValue: number;
    validPhones: number;
    invalidPhones: number;
    duplicateCandidates: number;
    uniqueClients: number;
    products: number;
  };
}

const GROUP_HEADER_RE = /^grupo\s+.+:\s*$/i;
const RESERVA_WITH_VALUE_RE = /^reserva\s*\(\s*(\d+(?:[.,]\d+)?)\s*\)\s*$/i;
const RESERVA_RE = /^reserva\s*$/i;
const PAGO_RE = /^pago\s*$/i;
const PENDENTE_RE = /^pendente\s*$/i;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function normalizePhone(raw: string): { digits: string; valid: boolean } {
  const digits = (raw || "").replace(/\D+/g, "");
  const valid = digits.length === 10 || digits.length === 11;
  return { digits, valid };
}

export function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/r\$/g, "")
    .replace(/reais?/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface ParsedStatus {
  status: ListFinancialStatus;
  paidValue: number | null;
  reviewRequired: boolean;
  warning?: string;
}

function parseStatusToken(token: string, totalValue: number | null): ParsedStatus {
  const t = token.trim();
  if (PAGO_RE.test(t)) {
    return {
      status: "Pago",
      paidValue: totalValue,
      reviewRequired: totalValue === null,
      warning: totalValue === null ? "Valor total não reconhecido para status PAGO." : undefined,
    };
  }
  const withVal = t.match(RESERVA_WITH_VALUE_RE);
  if (withVal) {
    const paid = parseMoney(withVal[1]);
    if (paid === null) {
      return {
        status: "Reserva",
        paidValue: null,
        reviewRequired: true,
        warning: "Valor pago da reserva inválido.",
      };
    }
    if (totalValue !== null && paid > totalValue) {
      return {
        status: "Reserva",
        paidValue: paid,
        reviewRequired: true,
        warning: "Valor pago maior que o valor total.",
      };
    }
    return { status: "Reserva", paidValue: paid, reviewRequired: false };
  }
  if (RESERVA_RE.test(t)) {
    return {
      status: "Reserva",
      paidValue: 10,
      reviewRequired: false,
    };
  }
  if (PENDENTE_RE.test(t)) {
    return { status: "Pendente", paidValue: 0, reviewRequired: false };
  }
  return {
    status: "Revisão necessária",
    paidValue: null,
    reviewRequired: true,
    warning: `Status financeiro não reconhecido: "${t}".`,
  };
}

function splitLineFields(line: string): string[] {
  // Split por " - " preservando hífen dentro dos campos.
  return line
    .split(/\s-\s/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function buildErrorRow(
  lineNumber: number,
  rawLine: string,
  sourceGroup: string,
  warning: string,
): ListImportRow {
  return {
    id: uid(),
    lineNumber,
    rawLine,
    sourceGroup,
    clientName: "",
    phone: "",
    phoneValid: false,
    productName: "",
    platformOrCategory: "",
    totalValue: null,
    paidValue: null,
    remainingValue: null,
    financialStatus: "Revisão necessária",
    confidence: 0,
    warnings: [warning],
    reviewStatus: "error",
  };
}

function parseSingleLine(
  lineNumber: number,
  rawLine: string,
  sourceGroup: string,
): ListImportRow {
  const fields = splitLineFields(rawLine);
  if (fields.length < 5) {
    return buildErrorRow(
      lineNumber,
      rawLine,
      sourceGroup,
      `Esperado pelo menos 5 campos separados por " - ", encontrado ${fields.length}.`,
    );
  }

  const clientName = fields[0];
  const phoneRaw = fields[1];
  const statusToken = fields[fields.length - 1];
  const valueToken = fields[fields.length - 2];
  const platformToken = fields[fields.length - 3];
  const productParts = fields.slice(2, fields.length - 3);
  const productName = productParts.join(" - ");

  const warnings: string[] = [];
  const { digits: phone, valid: phoneValid } = normalizePhone(phoneRaw);
  if (!phoneValid) {
    warnings.push(`Telefone "${phoneRaw}" inválido (${phone.length} dígitos).`);
  }

  const totalValue = parseMoney(valueToken);
  if (totalValue === null) {
    warnings.push(`Valor "${valueToken}" não reconhecido.`);
  }

  if (!productName) {
    warnings.push("Nome do produto não identificado.");
  }
  if (!platformToken) {
    warnings.push("Plataforma/categoria não identificada.");
  }

  const statusParsed = parseStatusToken(statusToken, totalValue);
  if (statusParsed.warning) warnings.push(statusParsed.warning);

  const paidValue = statusParsed.paidValue;
  const remainingValue =
    totalValue !== null && paidValue !== null ? totalValue - paidValue : null;

  if (statusParsed.status === "Pago" && paidValue !== null && totalValue !== null && paidValue !== totalValue) {
    warnings.push("Status PAGO mas valor pago difere do total.");
  }
  if (statusParsed.status === "Reserva" && totalValue !== null && paidValue !== null && paidValue >= totalValue) {
    warnings.push("Status RESERVA mas valor pago cobre o total.");
  }

  let reviewStatus: ListReviewStatus = "ok";
  if (statusParsed.reviewRequired || !phoneValid || totalValue === null) {
    reviewStatus = "review_required";
  }

  const confidence = Math.max(0, 1 - warnings.length * 0.18);

  return {
    id: uid(),
    lineNumber,
    rawLine,
    sourceGroup,
    clientName,
    phone,
    phoneValid,
    productName,
    platformOrCategory: platformToken,
    totalValue,
    paidValue,
    remainingValue,
    financialStatus: statusParsed.status,
    confidence,
    warnings,
    reviewStatus,
  };
}

function clientKey(name: string, phone: string): string {
  return `${name.trim().toLowerCase()}::${phone}`;
}

export function buildClientGroups(rows: ListImportRow[]): ListImportClientGroup[] {
  const map = new Map<string, ListImportClientGroup>();
  for (const r of rows) {
    if (r.reviewStatus === "error") continue;
    const key = clientKey(r.clientName, r.phone);
    const existing = map.get(key);
    const total = r.totalValue ?? 0;
    const paid = r.paidValue ?? 0;
    if (existing) {
      existing.rowIds.push(r.id);
      existing.totalValue += total;
      existing.paidValue += paid;
      existing.remainingValue = existing.totalValue - existing.paidValue;
      if (existing.remainingValue > 0) existing.status = "Reserva";
    } else {
      map.set(key, {
        key,
        clientName: r.clientName,
        phone: r.phone,
        rowIds: [r.id],
        totalValue: total,
        paidValue: paid,
        remainingValue: total - paid,
        status: r.financialStatus,
      });
    }
  }
  return Array.from(map.values());
}

function markDuplicateCandidates(rows: ListImportRow[]): void {
  const byPhone = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.phone || !r.clientName) continue;
    const namesForPhone = byPhone.get(r.phone) ?? new Set();
    namesForPhone.add(r.clientName.trim().toLowerCase());
    byPhone.set(r.phone, namesForPhone);

    const phonesForName = byName.get(r.clientName.trim().toLowerCase()) ?? new Set();
    phonesForName.add(r.phone);
    byName.set(r.clientName.trim().toLowerCase(), phonesForName);
  }
  for (const r of rows) {
    if (!r.phone || !r.clientName) continue;
    const namesForPhone = byPhone.get(r.phone);
    const phonesForName = byName.get(r.clientName.trim().toLowerCase());
    if ((namesForPhone && namesForPhone.size > 1) || (phonesForName && phonesForName.size > 1)) {
      r.duplicateCandidate = true;
      if (!r.warnings.some((w) => w.includes("Possível duplicidade"))) {
        r.warnings.push("Possível duplicidade de cliente.");
      }
      if (r.reviewStatus === "ok") r.reviewStatus = "review_required";
    }
  }
}

export function parseListText(raw: string): ListImportPreview {
  const rows: ListImportRow[] = [];
  const groupsSeen = new Set<string>();
  let currentGroup = "(sem grupo)";

  const lines = (raw || "").split(/\r?\n/);
  // Detecta datas BR (DD/MM/AA[AA]) no cabeçalho — precisa aparecer nas
  // primeiras linhas não vazias antes de qualquer registro de produto/grupo,
  // caso contrário poderíamos confundir com valores dentro das linhas.
  //
  // Formatos suportados:
  //   - "23/07/2026" ou "Itens 23/07/2026"       → headerDate
  //   - "Data de Entrada: 23/07/26"              → headerDate
  //   - "Data Limite: 23/08/26"                  → headerDueDate
  //
  // IMPORTANTE: usar \d{4} antes de \d{2} — alternação em regex é
  // avaliada da esquerda p/ a direita, então (\d{2}|\d{4}) casaria "20"
  // em "2026" e transformaria o ano em 2020.
  const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/;
  const toISO = (m: RegExpMatchArray): string | undefined => {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (m[3].length === 2) year = 2000 + year;
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return undefined;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return Number.isNaN(new Date(`${iso}T12:00:00`).getTime()) ? undefined : iso;
  };
  let headerDate: string | undefined;
  let headerDueDate: string | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (GROUP_HEADER_RE.test(line) || /\s-\s/.test(line)) break;
    const m = line.match(DATE_RE);
    if (!m) continue;
    const iso = toISO(m);
    if (!iso) continue;
    const lower = line.toLowerCase();
    const isLimite = /data\s*limite/.test(lower) || /\blimite\b/.test(lower);
    const isEntrada =
      /data\s*de\s*entrada/.test(lower) || /\bentrada\b/.test(lower) || /\bcadastro\b/.test(lower);
    if (isLimite && !headerDueDate) {
      headerDueDate = iso;
      continue;
    }
    if (!headerDate) {
      headerDate = iso;
      if (!isEntrada && !headerDueDate) {
        // Data solta (sem rótulo) e sem par "Data Limite" — mantém o
        // comportamento antigo de parar no primeiro achado.
        // Continua o loop caso venha "Data Limite" abaixo.
      }
    }
    if (headerDate && headerDueDate) break;
  }
  // Se "Data Limite" veio antes ou igual à "Data de Entrada", ignora — a
  // regra de negócio exige que Reserva seja cobrada depois do cadastro.
  if (headerDate && headerDueDate && headerDueDate <= headerDate) {
    headerDueDate = undefined;
  }
  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    if (GROUP_HEADER_RE.test(line)) {
      currentGroup = line.replace(/:\s*$/, "").trim();
      groupsSeen.add(currentGroup);
      return;
    }
    if (currentGroup !== "(sem grupo)" || /\s-\s/.test(line)) {
      rows.push(parseSingleLine(idx + 1, line, currentGroup));
    }
  });

  markDuplicateCandidates(rows);
  const clients = buildClientGroups(rows);
  return {
    rows,
    groups: Array.from(groupsSeen),
    clients,
    headerDate,
    headerDueDate,
    totals: computeTotals(rows, clients),
  };
}

export function computeTotals(
  rows: ListImportRow[],
  clients: ListImportClientGroup[],
) {
  const active = rows.filter((r) => !r.ignored);
  const errorRows = active.filter((r) => r.reviewStatus === "error").length;
  const reviewRows = active.filter((r) => r.reviewStatus === "review_required").length;
  const validRows = active.filter((r) => r.reviewStatus === "ok").length;
  const paidRows = active.filter((r) => r.financialStatus === "Pago").length;
  const reservaRows = active.filter((r) => r.financialStatus === "Reserva").length;
  const totalValue = active.reduce((s, r) => s + (r.totalValue ?? 0), 0);
  const paidValue = active.reduce((s, r) => s + (r.paidValue ?? 0), 0);
  const validPhones = active.filter((r) => r.phoneValid).length;
  const invalidPhones = active.filter((r) => !r.phoneValid).length;
  const duplicateCandidates = active.filter((r) => r.duplicateCandidate).length;
  return {
    lines: rows.length,
    validRows,
    errorRows,
    reviewRows,
    paidRows,
    reservaRows,
    totalValue,
    paidValue,
    openValue: Math.max(0, totalValue - paidValue),
    validPhones,
    invalidPhones,
    duplicateCandidates,
    uniqueClients: clients.length,
    products: active.filter((r) => r.reviewStatus !== "error").length,
  };
}

export function recalcRow(row: ListImportRow): ListImportRow {
  const next = { ...row, warnings: [] as string[] };
  const { valid } = normalizePhone(next.phone);
  next.phoneValid = valid;
  if (!valid) next.warnings.push("Telefone inválido.");

  if (next.totalValue === null) next.warnings.push("Valor total não informado.");
  if (next.totalValue !== null && next.paidValue !== null) {
    next.remainingValue = next.totalValue - next.paidValue;
    if (next.paidValue > next.totalValue) {
      next.warnings.push("Valor pago maior que o total.");
    }
  } else {
    next.remainingValue = null;
  }

  if (next.financialStatus === "Pago" && next.totalValue !== null) {
    next.paidValue = next.totalValue;
    next.remainingValue = 0;
  }
  if (next.financialStatus === "Reserva" && (next.paidValue === null || next.paidValue === 0)) {
    next.paidValue = 10;
    if (next.totalValue !== null) {
      next.remainingValue = Math.max(0, next.totalValue - 10);
    }
  }

  const review =
    next.warnings.length > 0 || next.totalValue === null ? "review_required" : "ok";
  next.reviewStatus = review;
  next.confidence = Math.max(0, 1 - next.warnings.length * 0.18);
  return next;
}