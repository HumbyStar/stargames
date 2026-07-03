/**
 * Parser da modalidade "Importar HTML de cliente (Notion)".
 *
 * Formato esperado:
 * - Um arquivo HTML por cliente (export tipo Notion).
 * - `<title>` / `<h1>` no formato "Nome - (DD) NNNNN-NNNN".
 * - Uma ou mais `<table>` com colunas na ordem:
 *     Item | Plataforma | Valor total | Valor Pago | Status | Data | Situação
 *   Tabelas sem <thead> são tratadas por posição.
 * - Headings intermediários (h1/h2/h3) entre tabelas viram o `sourceGroup`
 *   das tabelas seguintes.
 *
 * O parser reaproveita os tipos `ListImportRow`, `ListImportClientGroup` e
 * `ListImportPreview` do parser de lista colada, e adiciona o campo
 * `situation` (coluna 7) para o caminho de import HTML.
 */

import { parse, type HTMLElement } from "node-html-parser";
import {
  buildClientGroups,
  computeTotals,
  normalizePhone,
  parseMoney,
  type ListImportPreview,
  type ListImportRow,
  type ListFinancialStatus,
} from "./list-import-parser";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function textOf(el: HTMLElement | null | undefined): string {
  if (!el) return "";
  return el.text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export interface ClientHeader {
  name: string;
  phone: string;
  phoneValid: boolean;
  raw: string;
}

/** Situação operacional na 7ª coluna do HTML importado. */
export type ImportedSituation =
  | "Retirado"
  | "Retirar"
  | "Enviado"
  | "Abandonou"
  | null;

/** Extrai "Nome - (DD) NNNNN-NNNN" do topo do arquivo. */
export function extractClientHeader(root: HTMLElement): ClientHeader {
  const h1 = root.querySelector("h1");
  const title = root.querySelector("title");
  const raw = textOf(h1) || textOf(title) || "";
  // separa nome / telefone no ÚLTIMO " - " para tolerar nomes com hífen.
  const idx = raw.lastIndexOf(" - ");
  let name = raw;
  let phoneRaw = "";
  if (idx > 0) {
    name = raw.slice(0, idx).trim();
    phoneRaw = raw.slice(idx + 3).trim();
  }
  const { digits, valid } = normalizePhone(phoneRaw);
  return { name, phone: digits, phoneValid: valid, raw };
}

function normalizeStatus(token: string): {
  status: ListFinancialStatus;
  reviewRequired: boolean;
  warning?: string;
} {
  const t = (token || "").trim().toLowerCase();
  if (!t || t === "-" || t === "—") {
    return {
      status: "Revisão necessária",
      reviewRequired: true,
      warning: "Status financeiro ausente.",
    };
  }
  if (t === "pago") return { status: "Pago", reviewRequired: false };
  if (t.startsWith("reserva")) return { status: "Reserva", reviewRequired: false };
  if (t.startsWith("pendente")) return { status: "Pendente", reviewRequired: false };
  return {
    status: "Revisão necessária",
    reviewRequired: true,
    warning: `Status "${token}" não reconhecido.`,
  };
}

function normalizeSituation(token: string): {
  situation: ImportedSituation;
  warning?: string;
} {
  const t = (token || "").trim().toLowerCase();
  if (!t || t === "-" || t === "—") return { situation: null };
  // REMOVIDO no HTML = cliente desistiu do produto -> já entra como Retirado
  // (semanticamente "removido do estoque" na terminologia do usuário).
  if (t === "removido") return { situation: "Retirado" };
  if (t === "retirado") return { situation: "Retirado" };
  if (t === "retirar") return { situation: "Retirar" };
  if (t === "enviado") return { situation: "Enviado" };
  if (
    t === "desistiu" ||
    t === "desistência" ||
    t === "desistencia" ||
    t.startsWith("desist")
  ) {
    return { situation: "Abandonou" };
  }
  return {
    situation: null,
    warning: `Situação "${token}" não reconhecida.`,
  };
}

/**
 * Detecta se uma linha é linha de cabeçalho (ex.: "Item | Plataforma | ...").
 * Ignora essas linhas ao parsear dados.
 */
function isHeaderRow(cells: string[]): boolean {
  const joined = cells.map((c) => c.toLowerCase()).join("|");
  if (!joined.trim().replace(/\|/g, "")) return true; // linha totalmente vazia
  return (
    joined.includes("item") &&
    joined.includes("plataforma") &&
    joined.includes("valor")
  );
}

export interface HtmlImportRow extends ListImportRow {
  situation: ImportedSituation;
  rawDate: string;
}

function buildRow(
  header: ClientHeader,
  cells: string[],
  sourceGroup: string,
  lineNumber: number,
  rawLine: string,
): HtmlImportRow {
  const [item = "", platform = "", totalStr = "", paidStr = "", statusStr = "", dateStr = "", situationStr = ""] = cells;

  const warnings: string[] = [];
  const totalValue = parseMoney(totalStr);
  if (totalValue === null) warnings.push(`Valor total "${totalStr}" não reconhecido.`);

  const paidValueParsed = parseMoney(paidStr);
  const paidStrTrim = (paidStr || "").trim();
  const paidIsMissing = paidStrTrim === "" || paidStrTrim === "-" || paidStrTrim === "—";

  const status = normalizeStatus(statusStr);
  if (status.warning) warnings.push(status.warning);

  const sit = normalizeSituation(situationStr);
  if (sit.warning) warnings.push(sit.warning);

  let paidValue: number | null;
  if (status.status === "Pago" && totalValue !== null) {
    // PAGO: valor pago = total (mesmo que a coluna 4 esteja preenchida com o mesmo valor)
    paidValue = totalValue;
  } else if (paidIsMissing) {
    paidValue = status.status === "Pendente" ? 0 : null;
    if (status.status === "Reserva") warnings.push("Reserva sem valor pago.");
  } else {
    paidValue = paidValueParsed;
    if (paidValueParsed === null) warnings.push(`Valor pago "${paidStr}" não reconhecido.`);
  }

  if (!item) warnings.push("Nome do produto não identificado.");
  if (!platform) warnings.push("Plataforma/categoria não identificada.");
  if (!header.phoneValid) warnings.push(`Telefone "${header.raw}" inválido.`);

  const remainingValue =
    totalValue !== null && paidValue !== null ? totalValue - paidValue : null;

  const reviewRequired =
    status.reviewRequired ||
    !header.phoneValid ||
    totalValue === null ||
    (status.status === "Reserva" && paidValue === null);

  return {
    id: uid(),
    lineNumber,
    rawLine,
    sourceGroup,
    clientName: header.name,
    phone: header.phone,
    phoneValid: header.phoneValid,
    productName: item,
    platformOrCategory: platform,
    totalValue,
    paidValue,
    remainingValue,
    financialStatus: status.status,
    confidence: Math.max(0, 1 - warnings.length * 0.15),
    warnings,
    reviewStatus: reviewRequired ? "review_required" : "ok",
    situation: sit.situation,
    rawDate: (dateStr || "").trim(),
  };
}

export interface HtmlImportPreview extends ListImportPreview {
  clientHeader: ClientHeader;
  rows: HtmlImportRow[];
}

export function parseClientHtml(rawHtml: string): HtmlImportPreview {
  const root = parse(rawHtml, { comment: false });
  const header = extractClientHeader(root);

  // Percorre em ordem: headings viram sourceGroup das tabelas seguintes.
  const rows: HtmlImportRow[] = [];
  const groupsSeen = new Set<string>();
  let currentGroup = "(sem grupo)";
  let lineNumber = 0;

  const walker = root.querySelectorAll("h1, h2, h3, table");
  // O <h1> do próprio cabeçalho do cliente não deve virar grupo.
  const clientH1 = root.querySelector("h1");

  for (const el of walker) {
    const tag = el.tagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      if (el === clientH1) continue;
      const txt = textOf(el);
      if (txt) {
        currentGroup = txt;
        groupsSeen.add(currentGroup);
      }
      continue;
    }
    if (tag !== "table") continue;
    const trs = el.querySelectorAll("tr");
    for (const tr of trs) {
      const cells = tr
        .querySelectorAll("th, td")
        .map((c) => textOf(c));
      // ignora linhas vazias ou linhas de cabeçalho de tabela
      if (isHeaderRow(cells)) continue;
      // Garante 7 posições
      const padded = [...cells];
      while (padded.length < 7) padded.push("");
      lineNumber++;
      const raw = padded.join(" | ");
      rows.push(buildRow(header, padded.slice(0, 7), currentGroup, lineNumber, raw));
    }
  }

  const clients = buildClientGroups(rows);
  const groups = Array.from(groupsSeen);
  return {
    clientHeader: header,
    rows,
    groups,
    clients,
    totals: computeTotals(rows, clients),
  };
}