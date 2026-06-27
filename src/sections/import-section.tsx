import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  calculateFinancialStatus,
  formatBRL,
  useStore,
  type Client,
  type FinancialStatus,
  type MGMVAgreement,
  type Situation,
} from "@/lib/store";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ImportProgressModal, type ImportProgressState } from "@/components/import-progress-modal";
import { supabase } from "@/integrations/supabase/client";

interface ParsedRow {
  line: number;
  date: string | null;
  name: string;
  phone: string;
  product: string;
  platform: string;
  totalValue: number | null;
  paidValue: number | null;
  financialStatus: string;
  originalFinancialStatus?: string;
  statusWarning?: string;
  situation: string;
  registerDate: string | null;
  dueDate: string | null;
  notes?: string;
  clientFound: boolean;
  result: "Pronto" | "Erro";
  errors: string[];
}

const VALID_STATUS = ["Pago", "Reserva", "Pendente", "MGMV"] as const;
const VALID_SITUATION = ["Em Aberto", "Enviado", "Desistiu", "Abandonou"] as const;

const SAMPLE_LIST = `Itens 25/06/2026

João - 11999999999 - GTA V - PS5 - 50 - Reserva
Pedro - 21988888888 - Figure Goku - Colecionável - 80 - Pago
Carlos - 41977777777 - PS2 Slim - PS2 - 300 - Pendente`;

// ===================== Notion HTML parser =====================

interface NotionProduct {
  line: number;
  product: string;
  platform: string;
  totalValue: number;
  paidValue: number;
  remainingValue: number;
  financialStatus: FinancialStatus;
  originalFinancialStatus?: FinancialStatus;
  statusWarning?: string;
  situation: Situation;
  registerDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  errors: string[];
  warnings: string[];
}

interface NotionParseResult {
  clients: NotionClientBlock[];
  errors: string[];
}

interface NotionClientBlock {
  index: number;
  client: {
    name: string;
    phone: string;
    phoneDisplay: string;
    wasAutoCorrected?: boolean;
    correctionReason?: string;
  };
  products: NotionProduct[];
  notes: string;
  errors: string[];
}

const normalizeMoney = (v: string) => {
  if (!v) return 0;
  return (
    Number(String(v).replace(/R\$/gi, "").replace(/\./g, "").replace(",", ".").trim()) || 0
  );
};

const normalizeStatusBR = (s: string): FinancialStatus => {
  const v = String(s ?? "").trim().toLowerCase();
  if (v.includes("pago")) return "Pago";
  if (v.includes("reserva")) return "Reserva";
  if (v.includes("mgmv")) return "MGMV";
  if (v.includes("pendente")) return "Pendente";
  return "Pendente";
};

const normalizeSituationBR = (s: string): Situation => {
  const v = String(s ?? "").trim().toLowerCase();
  if (v.includes("entregue") || v.includes("enviado")) return "Enviado";
  if (v.includes("desistiu")) return "Desistiu";
  if (v.includes("abandonou")) return "Abandonou";
  return "Em Aberto";
};

const normalizeDateBR = (s: string): string | null => {
  if (!s) return null;
  const trimmed = s.trim();
  // Aceita "DD/MM/AAAA" ou "DD/MM/AA"; rejeita qualquer outra coisa.
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year = 2000 + year;
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12 ||
    year < 1900 ||
    year > 2999
  ) {
    return null;
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Verifica se a data realmente existe (ex.: 31/02 inválido).
  const probe = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(probe.getTime())) return null;
  return iso;
};

const calculateDueDate = (status: FinancialStatus, registerDate: string | null) => {
  if (!registerDate) return null;
  if (status === "Reserva") {
    const d = new Date(`${registerDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return registerDate;
    d.setDate(d.getDate() + 30);
    if (Number.isNaN(d.getTime())) return registerDate;
    return d.toISOString().split("T")[0];
  }
  return registerDate;
};

function cleanClientName(name: string) {
  return String(name || "")
    .replace(/\s+\d{2}$/, "")
    .replace(/^~/, "")
    .trim();
}

function formatBRPhone(digits: string) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function findPossibleBrazilianPhone(digits: string) {
  const value = String(digits || "");
  const eleven = value.match(/\d{11}/);
  if (eleven) return eleven[0];
  const ten = value.match(/\d{10}/);
  if (ten) return ten[0];
  return null;
}

/**
 * Extrai cliente do título do HTML/arquivo Notion, tentando recuperar telefone
 * em casos comuns de erro de digitação. Ex.: "Julio Silva 11 - 98702-2518" →
 * nome "Julio Silva" / telefone "11987022518".
 */
function extractClientFromTitle(title: string, fileName?: string) {
  const rawTitle = String(title || "");
  const rawFile = String(fileName || "").replace(/\.(html?|HTML?)$/i, "");
  const rawSource = `${rawTitle} ${rawFile}`;

  const titleParts = rawTitle.split(/\s+-\s+/);
  let namePart = titleParts[0]?.trim() || "";
  const phonePart = titleParts.slice(1).join(" - ").trim();

  let phoneDigits = phonePart.replace(/\D/g, "");
  let wasAutoCorrected = false;
  let correctionReason: string | undefined;

  // 1) Se o telefone (após o hífen) está incompleto, tentar recuperar o DDD
  // que pode ter sido digitado no fim do nome. Ex.: "Julio Silva 11" - "98702-2518".
  if (phoneDigits.length > 0 && phoneDigits.length < 10) {
    const tail = namePart.match(/\b(\d{2})\s*$/);
    if (tail) {
      const combined = (tail[1] + phoneDigits).replace(/\D/g, "");
      if (combined.length === 10 || combined.length === 11) {
        phoneDigits = combined;
        namePart = namePart.replace(/\s*\b\d{2}\s*$/, "").trim();
        wasAutoCorrected = true;
        correctionReason = "DDD recuperado do final do nome.";
      }
    }
  }

  // 2) Se ainda inválido, procurar qualquer telefone BR no título inteiro.
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    const allDigits = rawTitle.replace(/\D/g, "");
    const possible = findPossibleBrazilianPhone(allDigits);
    if (possible) {
      phoneDigits = possible;
      wasAutoCorrected = true;
      correctionReason = correctionReason ?? "Telefone recuperado do título.";
    }
  }

  // 3) Última tentativa: olhar no nome do arquivo também.
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    const allDigits = rawSource.replace(/\D/g, "");
    const possible = findPossibleBrazilianPhone(allDigits);
    if (possible) {
      phoneDigits = possible;
      wasAutoCorrected = true;
      correctionReason = correctionReason ?? "Telefone recuperado do nome do arquivo.";
    }
  }

  const cleanedName = cleanClientName(namePart);
  const valid = phoneDigits.length === 10 || phoneDigits.length === 11;

  return {
    name: cleanedName,
    phone: valid ? phoneDigits : phoneDigits, // mantém dígitos brutos p/ debug
    phoneDisplay: valid ? formatBRPhone(phoneDigits) : phonePart || phoneDigits,
    wasAutoCorrected: valid && wasAutoCorrected,
    correctionReason: valid && wasAutoCorrected ? correctionReason : undefined,
  };
}

function extractClientNotes(root: Element): string {
  const lines: string[] = [];
  const paragraphs = Array.from(root.querySelectorAll("p, li"));
  paragraphs.forEach((p) => {
    // skip if inside a table
    if (p.closest("table")) return;
    const t = (p.textContent ?? "").trim();
    if (!t) return;
    lines.push(t);
  });
  if (lines.length === 0) {
    const text = root.textContent ?? "";
    const totalMatch = text.match(/TOTAL:[\s\S]*/i);
    if (totalMatch) lines.push(totalMatch[0].trim());
  }
  return lines.join("\n");
}

// Extrai o acordo MGMV consolidado do texto de observações do cliente.
// Padrão esperado: "TOTAL: 200 PENDENTES (4x Parcelas de 50 reais)" e
// opcionalmente "1º Pagamento -> 07/03/2025".
export function extractMGMVAgreementFromNotes(notes: string): MGMVAgreement | null {
  if (!notes) return null;
  const lower = notes.toLowerCase();
  // Sinais soltos: precisamos de menção a MGMV/parcelas/dividido em.
  const hasMgmvHint =
    /mgmv/.test(lower) ||
    /\bparcela(s)?\b/.test(lower) ||
    /dividido\s+em/.test(lower);
  if (!hasMgmvHint) return null;

  const totalMatch = notes.match(/TOTAL:\s*([\d.,]+)/i);
  const installmentsMatch = notes.match(/(\d+)\s*x\s*Parcelas?\s*de\s*([\d.,]+)/i);
  // "50 dividido em 2x de 25 reais"
  const dividedMatch = notes.match(
    /([\d.,]+)\s*dividido\s+em\s+(\d+)\s*x\s*(?:de\s*)?([\d.,]+)/i,
  );
  const firstPaymentMatch = notes.match(
    /1[ºo]?\s*Pagamento\s*[-–—>]+\s*(\d{2}\/\d{2}\/\d{4})/i,
  );

  let totalDebt = 0;
  let count = 0;
  let value = 0;
  if (totalMatch && installmentsMatch) {
    totalDebt = normalizeMoney(totalMatch[1]);
    count = Number(installmentsMatch[1]);
    value = normalizeMoney(installmentsMatch[2]);
  } else if (dividedMatch) {
    totalDebt = normalizeMoney(dividedMatch[1]);
    count = Number(dividedMatch[2]);
    value = normalizeMoney(dividedMatch[3]);
  } else if (installmentsMatch) {
    count = Number(installmentsMatch[1]);
    value = normalizeMoney(installmentsMatch[2]);
    totalDebt = count * value;
  }
  if (!totalDebt || !count || !value) return null;

  // Detecta parcelas já pagas pelas observações.
  let paidCount = 0;
  if (/pago\s+primeira\s+parcela/i.test(notes)) paidCount = Math.max(paidCount, 1);
  const pagasMatch = notes.match(/(\d+)\s*parcelas?\s*pagas?/i);
  if (pagasMatch) paidCount = Math.max(paidCount, Number(pagasMatch[1]));
  // Variações: "Pagou 2 parcelas", "quitou 3 parcelas".
  const pagouMatch = notes.match(/(?:pagou|quitou)\s+(\d+)\s*parcelas?/i);
  if (pagouMatch) paidCount = Math.max(paidCount, Number(pagouMatch[1]));
  paidCount = Math.min(paidCount, count);

  const firstDueIso =
    firstPaymentMatch && normalizeDateBR(firstPaymentMatch[1])
      ? new Date(`${normalizeDateBR(firstPaymentMatch[1])}T12:00:00`).toISOString()
      : new Date().toISOString();
  const start = new Date(firstDueIso);
  const installments = Array.from({ length: count }, (_, idx) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + idx);
    return {
      number: idx + 1,
      total: count,
      dueDate: d.toISOString(),
      value,
      paid: idx < paidCount,
    };
  });
  return {
    startDate: new Date().toISOString(),
    totalDebt,
    installments,
  };
}

function parseProductsTable(table: Element): NotionProduct[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  const dataRows = rows.slice(1);
  const products: NotionProduct[] = [];
  dataRows.forEach((row, idx) => {
    const cells = Array.from(row.querySelectorAll("td")).map((c) =>
      (c.textContent ?? "").trim(),
    );
    if (cells.length === 0) return;
    const [item, platform, totalRaw, paidRaw, status, date, situation] = cells;
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];
    if (!item) {
      rowErrors.push("Produto sem nome (linha ignorada).");
      products.push({
        line: idx + 1,
        product: "",
        platform: platform ?? "",
        totalValue: 0,
        paidValue: 0,
        remainingValue: 0,
        financialStatus: "Pendente",
        situation: "Em Aberto",
        registerDate: null,
        dueDate: null,
        errors: rowErrors,
        warnings: rowWarnings,
      });
      return;
    }
    const totalValue = normalizeMoney(totalRaw ?? "");
    const paidValue = normalizeMoney(paidRaw ?? "");
    if (!totalRaw) rowWarnings.push("Valor vazio (considerado 0).");
    const originalStatus = normalizeStatusBR(status ?? "");
    if (!status) rowWarnings.push('Status vazio (usado "Pendente").');
    // MGMV pode chegar via coluna Status OU via coluna Situação.
    const situationMentionsMgmv = /mgmv/i.test(String(situation ?? ""));
    const financialStatus =
      originalStatus === "MGMV" || situationMentionsMgmv
        ? "MGMV"
        : calculateFinancialStatus(totalValue, paidValue);
    let statusWarning: string | undefined;
    if (financialStatus !== originalStatus && !situationMentionsMgmv) {
      statusWarning =
        paidValue === 0
          ? "Valor pago é zero, portanto o status correto é Pendente."
          : paidValue >= totalValue && totalValue > 0
            ? "Valor pago quita o total, portanto o status correto é Pago."
            : "Existe valor pago de entrada, portanto o status correto é Reserva.";
      rowWarnings.push(`Status corrigido de "${originalStatus}" para "${financialStatus}". ${statusWarning}`);
    }
    const situationN = normalizeSituationBR(situation ?? "");
    if (!situation) rowWarnings.push('Situação vazia (usado "Em Aberto").');
    const registerDate = normalizeDateBR(date ?? "");
    const dueDate = calculateDueDate(financialStatus, registerDate);
    products.push({
      line: idx + 1,
      product: item,
      platform: platform ?? "",
      totalValue,
      paidValue,
      remainingValue: Math.max(0, totalValue - paidValue),
      financialStatus,
      originalFinancialStatus: originalStatus,
      statusWarning,
      situation: situationN,
      registerDate,
      dueDate,
      errors: rowErrors,
      warnings: rowWarnings,
    });
  });
  return products;
}

function parseClientArticle(
  article: Element,
  index: number,
  fileName?: string,
): NotionClientBlock {
  const errors: string[] = [];
  const title =
    article.querySelector(".page-title")?.textContent?.trim() ||
    article.querySelector("h1")?.textContent?.trim() ||
    "";
  const client = extractClientFromTitle(title, fileName);
  if (!client.name) errors.push(`Cliente #${index}: nome não encontrado.`);
  if (!client.phone || client.phone.length < 10 || client.phone.length > 11) {
    errors.push(
      `Cliente #${index}: telefone inválido e não foi possível corrigir automaticamente.`,
    );
  }
  const table =
    article.querySelector("table.simple-table") || article.querySelector("table");
  let products: NotionProduct[] = [];
  if (!table) {
    errors.push(`Cliente #${index} (${client.name || "sem nome"}): tabela não encontrada.`);
  } else {
    products = parseProductsTable(table);
  }
  return {
    index,
    client,
    products,
    notes: extractClientNotes(article),
    errors,
  };
}

function parseNotionHtml(html: string, fileName?: string): NotionParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const errors: string[] = [];
  let articles = Array.from(doc.querySelectorAll("article.page"));
  if (articles.length === 0) {
    // fallback: treat the whole body as a single client article
    if (doc.body) articles = [doc.body as unknown as Element];
  }
  const clients = articles.map((a, i) => parseClientArticle(a, i + 1, fileName));
  if (clients.length === 0) errors.push("Nenhum cliente encontrado no HTML.");
  return { clients, errors };
}

// =================================================================

// =================== ZIP do Notion (tipos) ===================

interface ZipFileEntry {
  folderName: string;
  fileName: string;
  fullPath: string;
  htmlContent: string;
}

interface ZipProductPreview extends NotionProduct {
  tempId: string;
  duplicate: boolean;
  duplicateAfterCorrection?: boolean;
  selected: boolean;
}

interface ZipClientPreview {
  id: string;
  folderName: string;
  fileName: string;
  fullPath: string;
  client: {
    name: string;
    phone: string;
    phoneDisplay: string;
    wasAutoCorrected?: boolean;
    correctionReason?: string;
  };
  products: ZipProductPreview[];
  notes: string;
  mgmv: MGMVAgreement | null;
  existingClient: Client | undefined;
  matchedAfterCorrection?: boolean;
  // Ação escolhida pelo usuário quando o cliente foi encontrado por causa de
  // uma auto-correção do telefone: "merge" (importar e mesclar — padrão) ou
  // "skip" (pular a importação deste cliente/itens).
  correctionAction?: "merge" | "skip";
  /**
   * Sinaliza que o cliente já tem um acordo MGMV ativo com parcelas pagas.
   * Quando o ZIP traz um novo acordo, sobrescrever apagaria o histórico de
   * pagamento — por isso exigimos uma decisão explícita do operador.
   */
  mgmvConflict?: {
    existingPaid: number;
    existingTotal: number;
    existingRemaining: number;
  };
  /**
   * Ação para o acordo MGMV detectado neste arquivo:
   * - "apply": aplica (padrão quando não há conflito)
   * - "replace": substitui o acordo existente (operador confirmou perda)
   * - "keep": mantém o acordo existente e descarta o do arquivo
   */
  mgmvAction?: "apply" | "replace" | "keep";
  errors: string[];
  criticalError: boolean;
  selected: boolean;
}

interface ZipPreviewData {
  folders: Set<string>;
  files: number;
  entries: ZipClientPreview[];
  globalErrors: string[];
  parseFailures: { path: string; reason: string }[];
  zipName: string;
  fileHash: string;
  /** Se este hash já apareceu antes no importHistory. */
  alreadyImported: boolean;
  previousImportDate?: string;
  /** Agrupamento de erros por causa para análise. */
  errorGroups: { reason: string; paths: string[] }[];
}

type ZipFilter =
  | "todos"
  | "prontos"
  | "novos"
  | "existentes"
  | "erro"
  | "duplicatas"
  | "mgmv"
  | "semTelefone"
  | "semProdutos"
  | "statusCorrigido"
  | "telefoneCorrigido";

// =============================================================

const normalizePhone = (p: string) => String(p ?? "").replace(/\D/g, "");
const maskPhone = (p: string) => {
  const d = normalizePhone(p);
  if (d.length < 6) return "***";
  return `${d.slice(0, 2)} ****-${d.slice(-4)}`;
};

/** Limites duros para abrir um ZIP — protege contra zip-bomb e travamento. */
const ZIP_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};

/** sha1 hex via Web Crypto API. Usado como fingerprint do arquivo importado. */
async function sha1Hex(data: ArrayBuffer | string): Promise<string> {
  const buf =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Validação simples nos limites de campo para conter dados absurdos. */
function validateClientBlock(b: {
  name: string;
  phone: string;
  notes?: string;
}): string[] {
  const errs: string[] = [];
  if (b.name.length > 120) errs.push("Nome com mais de 120 caracteres.");
  if ((b.notes ?? "").length > 5000) errs.push("Observações com mais de 5000 caracteres.");
  return errs;
}
function validateProductValues(p: { totalValue: number; paidValue: number }): string[] {
  const errs: string[] = [];
  if (!Number.isFinite(p.totalValue) || p.totalValue < 0 || p.totalValue > 1_000_000)
    errs.push("Valor total fora do intervalo (0–1.000.000).");
  if (!Number.isFinite(p.paidValue) || p.paidValue < 0 || p.paidValue > 1_000_000)
    errs.push("Valor pago fora do intervalo (0–1.000.000).");
  if (p.paidValue > p.totalValue) errs.push("Valor pago maior que o total.");
  return errs;
}

/**
 * Agrupa falhas de parsing por causa para reduzir banner-blindness.
 * Mostrar "47 arquivos falharam por 'data inválida'" é mais acionável do
 * que 47 linhas idênticas com paths diferentes.
 */
function groupErrorsByReason(
  failures: { path: string; reason: string }[],
): { reason: string; paths: string[] }[] {
  const map = new Map<string, string[]>();
  failures.forEach((f) => {
    const key = f.reason.replace(/\s+/g, " ").trim().slice(0, 200);
    const arr = map.get(key) ?? [];
    arr.push(f.path);
    map.set(key, arr);
  });
  return Array.from(map.entries())
    .map(([reason, paths]) => ({ reason, paths }))
    .sort((a, b) => b.paths.length - a.paths.length);
}

const parseValue = (v: string | number | undefined | null) => {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") return v;
  return Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
};
const brDateToISO = (br: string) => {
  const m = br.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`).toISOString();
};
const toISO = (v: string | undefined | null) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v).toISOString();
  return brDateToISO(v);
};

function parseTextList(input: string): Omit<ParsedRow, "clientFound" | "result" | "errors">[] {
  const lines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const dateMatch = lines[0].match(/(\d{2}\/\d{2}\/\d{4})/);
  const headerDate = dateMatch ? dateMatch[1] : null;
  const productLines = dateMatch ? lines.slice(1) : lines;
  return productLines.map((line, idx) => {
    const parts = line.split("-").map((s) => s.trim());
    const [name, phone, product, platform, value, status] = parts;
    return {
      line: idx + 1,
      date: headerDate,
      name: name ?? "",
      phone: phone ?? "",
      product: product ?? "",
      platform: platform ?? "",
      totalValue: parseValue(value),
      paidValue: null,
      financialStatus: status ?? "",
      situation: "Em Aberto",
      registerDate: headerDate ? brDateToISO(headerDate) : null,
      dueDate: null,
    };
  });
}

function parseHTMLList(html: string) {
  const div = document.createElement("div");
  div.innerHTML = html;
  const text = (div.textContent ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return parseTextList(text);
}

function parseTabular(rows: Record<string, unknown>[]): Omit<ParsedRow, "clientFound" | "result" | "errors">[] {
  return rows.map((r, idx) => {
    const get = (k: string) => {
      const key = Object.keys(r).find((kk) => kk.toLowerCase().trim() === k);
      return key ? String(r[key] ?? "").trim() : "";
    };
    const reg = get("data_cadastro");
    const due = get("data_limite");
    return {
      line: idx + 1,
      date: reg || null,
      name: get("nome"),
      phone: get("telefone"),
      product: get("produto"),
      platform: get("plataforma"),
      totalValue: parseValue(get("valor_total") || get("valor")),
      paidValue: get("valor_pago") ? parseValue(get("valor_pago")) : null,
      financialStatus: get("status_financeiro") || get("status"),
      situation: get("situacao") || "Em Aberto",
      registerDate: toISO(reg),
      dueDate: toISO(due),
      notes: get("observacoes") || undefined,
    };
  });
}

function validateRows(
  raw: Omit<ParsedRow, "clientFound" | "result" | "errors">[],
  findClientByPhone: (phone: string) => { id: string } | undefined,
): ParsedRow[] {
  return raw.map((r) => {
    const errors: string[] = [];
    if (!r.name) errors.push("Nome obrigatório");
    const phoneDigits = normalizePhone(r.phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) errors.push("Telefone inválido");
    if (!r.product) errors.push("Produto sem nome");
    if (r.totalValue === null || !Number.isFinite(r.totalValue) || r.totalValue <= 0) errors.push("Valor inválido");
    if (r.situation && !VALID_SITUATION.includes(r.situation as (typeof VALID_SITUATION)[number])) errors.push("Situação inválida");
    const found = phoneDigits ? findClientByPhone(phoneDigits) : undefined;
    const originalStatus = r.financialStatus;
    const total = Number(r.totalValue) || 0;
    const paid = Number(r.paidValue ?? (originalStatus === "Pago" ? total : 0)) || 0;
    const correctedStatus: FinancialStatus =
      originalStatus === "MGMV"
        ? "MGMV"
        : calculateFinancialStatus(total, paid);
    let statusWarning: string | undefined;
    if (originalStatus && correctedStatus !== originalStatus) {
      statusWarning =
        paid === 0
          ? "Valor pago é zero, portanto o status correto é Pendente."
          : paid >= total && total > 0
            ? "Valor pago quita o total, portanto o status correto é Pago."
            : "Existe valor pago de entrada, portanto o status correto é Reserva.";
    }
    return {
      ...r,
      phone: phoneDigits,
      financialStatus: correctedStatus,
      originalFinancialStatus: originalStatus,
      statusWarning,
      clientFound: !!found,
      result: errors.length === 0 ? "Pronto" : "Erro",
      errors,
    };
  });
}

export function ImportSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const {
    findClientByPhone,
    addClient,
    updateClient,
    addProduct,
    openClient,
    updateClientNotes,
    setMGMVAgreement,
    addImportHistory,
  } = useStore();
  const products = useStore((s) => s.products);
  const clients = useStore((s) => s.clients);
  const importHistory = useStore((s) => s.importHistory);
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(SAMPLE_LIST);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [notion, setNotion] = useState<NotionParseResult | null>(null);
  const [htmlText, setHtmlText] = useState("");
  const [zipData, setZipData] = useState<ZipPreviewData | null>(null);
  const [zipProcessing, setZipProcessing] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [zipFailuresOpen, setZipFailuresOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [progressRowId, setProgressRowId] = useState<string | null>(null);

  // Persiste o estado de progresso no banco (best-effort, não bloqueia a UI).
  const persistProgress = async (state: ImportProgressState) => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const payload = {
        user_id: uid,
        file_hash: state.fileHash,
        zip_name: state.zipName,
        folders: state.folders,
        current_idx: state.currentIdx,
        total: state.folders.length,
        messages: state.messages.slice(-200),
        errors: state.errors.slice(-200),
        stats: state.stats,
        done: state.done,
        started_at: state.startedAt,
      };
      const { data, error } = await supabase
        .from("import_progress")
        .upsert(payload, { onConflict: "user_id,file_hash" })
        .select("id")
        .maybeSingle();
      if (error) {
        console.warn("[import_progress] upsert falhou", error.message);
        return;
      }
      if (data?.id) setProgressRowId(data.id);
    } catch (err) {
      console.warn("[import_progress] erro inesperado", err);
    }
  };

  // Ao montar, retoma uma importação não finalizada (se houver).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes.user?.id;
        if (!uid) return;
        const { data, error } = await supabase
          .from("import_progress")
          .select("*")
          .eq("user_id", uid)
          .eq("done", false)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || !data || cancelled) return;
        setProgressRowId(data.id);
        setImportProgress({
          fileHash: data.file_hash,
          zipName: data.zip_name,
          startedAt: data.started_at,
          folders: (data.folders as string[]) ?? [],
          currentIdx: data.current_idx ?? -1,
          messages: (data.messages as string[]) ?? [],
          errors: (data.errors as string[]) ?? [],
          stats: (data.stats as ImportProgressState["stats"]) ?? {
            createdClients: 0,
            updatedClients: 0,
            createdProducts: 0,
            createdAgreements: 0,
            replacedAgreements: 0,
            ignoredDuplicates: 0,
            errorEntries: 0,
            skippedAfterCorrection: 0,
          },
          done: false,
          resumed: true,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const discardProgress = async () => {
    if (progressRowId) {
      try {
        await supabase.from("import_progress").delete().eq("id", progressRowId);
      } catch {
        /* ignore */
      }
    }
    setProgressRowId(null);
    setImportProgress(null);
  };

  const handleZipFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return toast.error("Envie um arquivo .zip");
    }
    if (file.size > ZIP_LIMITS.maxTotalBytes) {
      return toast.error(
        `ZIP excede o limite de ${(ZIP_LIMITS.maxTotalBytes / 1024 / 1024) | 0} MB.`,
      );
    }
    setZipProcessing(true);
    setZipData(null);
    setZipProgress({ done: 0, total: 0 });
    const startedAt = performance.now();
    try {
      const fileBuffer = await file.arrayBuffer();
      const fileHash = await sha1Hex(fileBuffer);
      const previousImport = importHistory.find((h) => h.fileHash === fileHash);
      if (previousImport) {
        toast.warning(
          `Este ZIP já foi importado em ${new Date(previousImport.date).toLocaleString("pt-BR")}. Você ainda pode reimportar — duplicatas serão detectadas.`,
        );
      }
      const { default: JSZip } = await import("jszip");
      let zip;
      try {
        zip = await JSZip.loadAsync(fileBuffer);
      } catch (err) {
        console.error("JSZip load error", err);
        toast.error("Não foi possível abrir o ZIP. O arquivo pode estar corrompido ou protegido por senha.");
        return;
      }
      const htmlFiles: ZipFileEntry[] = [];
      const folders = new Set<string>();
      const globalErrors: string[] = [];
      const parseFailures: { path: string; reason: string }[] = [];
      // Collect entries first (sync) so we can stream extraction in chunks.
      const rawEntries: { path: string; fileName: string; folderName: string; entry: any }[] = [];
      zip.forEach((path, entry) => {
        if (entry.dir) return;
        const lower = path.toLowerCase();
        if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return;
        const parts = path.split("/");
        const fileName = parts[parts.length - 1];
        const folderName = parts.length > 1 ? parts.slice(0, -1).join("/") : "(raiz)";
        folders.add(folderName);
        rawEntries.push({ path, fileName, folderName, entry });
      });
      if (rawEntries.length > ZIP_LIMITS.maxFiles) {
        globalErrors.push(
          `ZIP contém ${rawEntries.length} arquivos — acima do limite de ${ZIP_LIMITS.maxFiles}. Apenas os primeiros serão processados.`,
        );
        rawEntries.length = ZIP_LIMITS.maxFiles;
      }
      setZipProgress({ done: 0, total: rawEntries.length });
      // Extract in chunks of 25 so the UI stays responsive on big archives.
      const CHUNK = 25;
      for (let i = 0; i < rawEntries.length; i += CHUNK) {
        const slice = rawEntries.slice(i, i + CHUNK);
        await Promise.all(
          slice.map(async (r) => {
            try {
              const content = await r.entry.async("string");
              if (content.length > ZIP_LIMITS.maxFileBytes) {
                parseFailures.push({
                  path: r.path,
                  reason: `Arquivo acima de ${(ZIP_LIMITS.maxFileBytes / 1024 / 1024).toFixed(1)} MB — ignorado por segurança.`,
                });
                return;
              }
              htmlFiles.push({
                folderName: r.folderName,
                fileName: r.fileName,
                fullPath: r.path,
                htmlContent: content,
              });
            } catch (err) {
              console.error("Falha ao ler", r.path, err);
              globalErrors.push(`Falha ao ler ${r.path}.`);
              parseFailures.push({
                path: r.path,
                reason: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
        setZipProgress({ done: Math.min(i + CHUNK, rawEntries.length), total: rawEntries.length });
        // Yield to the browser so the progress UI updates and we don't freeze the tab.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (htmlFiles.length === 0) {
        globalErrors.push("Nenhum arquivo .html encontrado no ZIP.");
      }
      const entries: ZipClientPreview[] = [];
      htmlFiles.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
      // Index existing products by clientId for O(1) duplicate lookups.
      const productIndexByClient = new Map<string, Set<string>>();
      products.forEach((p) => {
        const key = `${p.name.trim().toLowerCase()}|${new Date(p.registerDate).toISOString().slice(0, 10)}`;
        const set = productIndexByClient.get(p.clientId) ?? new Set<string>();
        set.add(key);
        productIndexByClient.set(p.clientId, set);
      });
      const clientByPhone = new Map<string, Client>();
      clients.forEach((c) => {
        const ph = c.phone.replace(/\D/g, "");
        if (ph) clientByPhone.set(ph, c);
      });
      // Parse in chunks too — DOMParser on hundreds of HTML files blocks the UI.
      for (let i = 0; i < htmlFiles.length; i += CHUNK) {
        const slice = htmlFiles.slice(i, i + CHUNK);
        slice.forEach((file, idx) => {
          const fileIdx = i + idx;
          let parsed: NotionParseResult;
          try {
            parsed = parseNotionHtml(file.htmlContent, file.fileName);
          } catch (err) {
            console.error("parseNotionHtml falhou em", file.fullPath, err);
            const raw = err instanceof Error ? err.message : String(err);
            const friendly =
              raw.includes("Invalid time value")
                ? "Data inválida em uma das linhas da tabela (formato esperado DD/MM/AAAA)."
                : raw;
            globalErrors.push(`Erro ao interpretar ${file.fullPath}: ${friendly}`);
            parseFailures.push({ path: file.fullPath, reason: friendly });
            return;
          }
          parsed.clients.forEach((block, blockIdx) => {
            const tempId = `zip-${fileIdx}-${blockIdx}-${Math.random().toString(36).slice(2, 8)}`;
            // Sempre comparamos pelo telefone normalizado (corrigido) — mesmo
            // que o título original viesse com erro de digitação, o phone aqui
            // já reflete a versão auto-corrigida em dígitos puros.
            const lookupPhone = (block.client.phone || "").replace(/\D/g, "");
            const existingClient = lookupPhone ? clientByPhone.get(lookupPhone) : undefined;
            const matchedAfterCorrection = !!existingClient && !!block.client.wasAutoCorrected;
            if (matchedAfterCorrection) {
              console.info(
                `[import] Duplicata de cliente após auto-correção: ${maskPhone(lookupPhone)} — arquivo ${file.fullPath}`,
              );
            }
            const errors = [...block.errors];
            errors.push(
              ...validateClientBlock({
                name: block.client.name,
                phone: block.client.phone,
                notes: block.notes,
              }),
            );
            if (!block.client.name) errors.push("Cliente sem nome.");
            if (!block.client.phone || block.client.phone.length < 10)
              errors.push("Telefone inválido ou ausente.");
            if (block.products.length === 0) errors.push("Sem produtos na tabela.");
            const productPreviews: ZipProductPreview[] = block.products.map((p, pIdx) => {
              let dup = false;
              if (existingClient && p.registerDate) {
                const set = productIndexByClient.get(existingClient.id);
                dup = !!set?.has(`${p.product.trim().toLowerCase()}|${p.registerDate}`);
              }
              const vErrs = validateProductValues({
                totalValue: p.totalValue,
                paidValue: p.paidValue,
              });
              const pErrors = vErrs.length ? [...p.errors, ...vErrs] : p.errors;
              return {
                ...p,
                errors: pErrors,
                tempId: `${tempId}-p${pIdx}`,
                duplicate: dup,
                duplicateAfterCorrection: dup && matchedAfterCorrection,
                selected: true,
              };
            });
            const mgmv = extractMGMVAgreementFromNotes(block.notes);
            // Conflito de MGMV: cliente já tem acordo com parcelas pagas e o
            // arquivo está trazendo um novo. Substituir apagaria o histórico.
            let mgmvConflict: ZipClientPreview["mgmvConflict"] = undefined;
            if (mgmv && existingClient?.mgmv) {
              const existPaid = existingClient.mgmv.installments.filter((i) => i.paid).length;
              if (existPaid > 0) {
                mgmvConflict = {
                  existingPaid: existPaid,
                  existingTotal: existingClient.mgmv.installments.length,
                  existingRemaining: existingClient.mgmv.installments
                    .filter((i) => !i.paid)
                    .reduce((s, i) => s + i.value, 0),
                };
              }
            }
            const criticalError =
              !block.client.name ||
              !block.client.phone ||
              block.client.phone.length < 10 ||
              block.products.length === 0;
            entries.push({
              id: tempId,
              folderName: file.folderName,
              fileName: file.fileName,
              fullPath: file.fullPath,
              client: block.client,
              products: productPreviews,
              notes: block.notes,
              mgmv,
              existingClient,
              matchedAfterCorrection,
              correctionAction: matchedAfterCorrection ? "merge" : undefined,
              mgmvConflict,
              mgmvAction: mgmv ? (mgmvConflict ? undefined : "apply") : undefined,
              errors,
              criticalError,
              selected: !criticalError,
            });
          });
        });
        // Yield to keep the UI alive during heavy parsing.
        await new Promise((r) => setTimeout(r, 0));
      }
      setZipData({
        folders,
        files: htmlFiles.length,
        entries,
        globalErrors,
        parseFailures,
        zipName: file.name,
        fileHash,
        alreadyImported: !!previousImport,
        previousImportDate: previousImport?.date,
        errorGroups: groupErrorsByReason(parseFailures),
      });
      toast.success(
        `${entries.length} cliente(s) lidos de ${htmlFiles.length} arquivo(s) em ${folders.size} pasta(s) em ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`,
      );
      if (parseFailures.length > 0) {
        setZipFailuresOpen(true);
      }
    } catch (err) {
      console.error(err);
      toast.error("Falha ao ler o ZIP. Verifique o arquivo.");
    } finally {
      setZipProcessing(false);
      setZipProgress(null);
    }
  };

  const setEntrySelected = (id: string, selected: boolean) => {
    setZipData((d) =>
      d
        ? { ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, selected } : e)) }
        : d,
    );
  };
  const setCorrectionAction = (id: string, action: "merge" | "skip") => {
    setZipData((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) =>
              e.id === id
                ? {
                    ...e,
                    correctionAction: action,
                    // Se o usuário escolher pular, desmarca a entry inteira
                    // para que nenhum produto/MGMV deste cliente seja importado.
                    selected: action === "skip" ? false : e.selected || !e.criticalError,
                  }
                : e,
            ),
          }
        : d,
    );
  };
  const setMgmvAction = (id: string, action: "apply" | "replace" | "keep") => {
    setZipData((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) => (e.id === id ? { ...e, mgmvAction: action } : e)),
          }
        : d,
    );
  };
  const setProductSelected = (entryId: string, productId: string, selected: boolean) => {
    setZipData((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) =>
              e.id === entryId
                ? {
                    ...e,
                    products: e.products.map((p) =>
                      p.tempId === productId ? { ...p, selected } : p,
                    ),
                  }
                : e,
            ),
          }
        : d,
    );
  };
  const setAllEntriesSelected = (selected: boolean) => {
    setZipData((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) => ({
              ...e,
              selected: selected && !e.criticalError,
            })),
          }
        : d,
    );
  };
  const setFolderSelected = (folderName: string, selected: boolean) => {
    setZipData((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) =>
              e.folderName === folderName
                ? { ...e, selected: selected && !e.criticalError }
                : e,
            ),
          }
        : d,
    );
  };

  const confirmZipImport = async () => {
    if (!zipData) return;
    // Pendência de decisão em conflitos MGMV bloqueia o import.
    const pendingMgmv = zipData.entries.filter(
      (e) => e.selected && !e.criticalError && e.mgmv && e.mgmvConflict && !e.mgmvAction,
    );
    if (pendingMgmv.length > 0) {
      toast.error(
        `${pendingMgmv.length} cliente(s) com MGMV em conflito ainda sem decisão (substituir ou manter).`,
      );
      return;
    }
    const todayISO = new Date().toISOString();
    const startedAt = performance.now();
    const stats = {
      createdClients: 0,
      updatedClients: 0,
      createdProducts: 0,
      createdAgreements: 0,
      replacedAgreements: 0,
      ignoredDuplicates: 0,
      errorEntries: 0,
      skippedAfterCorrection: 0,
    };

    // Agrupa entradas por pasta para processamento lazy/calmo.
    const byFolder = new Map<string, typeof zipData.entries>();
    zipData.entries.forEach((e) => {
      const key = e.folderName || "(raiz)";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(e);
    });
    const folders = Array.from(byFolder.keys());

    const startedAtISO = new Date().toISOString();
    const initialState: ImportProgressState = {
      fileHash: zipData.fileHash,
      zipName: zipData.zipName,
      startedAt: startedAtISO,
      folders,
      currentIdx: -1,
      messages: [`📦 Abrindo ZIP "${zipData.zipName}"…`, `🗂️ ${folders.length} pasta(s) na esteira.`],
      errors: [],
      stats: { ...stats },
      done: false,
    };
    setImportProgress(initialState);
    void persistProgress(initialState);

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // Respira antes de começar pra animação aparecer.
    await wait(700);

    const processEntry = (entry: typeof zipData.entries[number]) => {
      if (!entry.selected || entry.criticalError) {
        if (entry.criticalError) stats.errorEntries++;
        return;
      }
      if (entry.matchedAfterCorrection && entry.correctionAction === "skip") {
        stats.skippedAfterCorrection++;
        return;
      }
      let client = findClientByPhone(entry.client.phone);
      if (!client) {
        client = addClient({
          name: entry.client.name,
          phone: entry.client.phoneDisplay || entry.client.phone,
          folder: entry.folderName,
        });
        stats.createdClients++;
      } else {
        if (!client.folder && entry.folderName && entry.folderName !== "(raiz)") {
          updateClient(client.id, { folder: entry.folderName });
        }
        stats.updatedClients++;
      }
      entry.products.forEach((p) => {
        if (!p.selected || p.errors.length > 0 || !p.product) return;
        if (p.duplicate) {
          stats.ignoredDuplicates++;
          return;
        }
        // Se o cliente tem um acordo MGMV aplicado nesta importação, qualquer
        // produto ainda em aberto (Pendente/Reserva) é consolidado no acordo.
        // Isso evita cobrança individual duplicada — a Collection trata pelo
        // acordo. Produtos já Pagos preservam o status original.
        const mgmvBeingApplied =
          entry.mgmv &&
          (entry.mgmvAction ?? "apply") !== "keep";
        const effectiveStatus =
          mgmvBeingApplied && p.financialStatus !== "Pago"
            ? "MGMV"
            : p.financialStatus;
        const regISO = p.registerDate
          ? new Date(`${p.registerDate}T12:00:00`).toISOString()
          : todayISO;
        const dueISO = p.dueDate
          ? new Date(`${p.dueDate}T12:00:00`).toISOString()
          : effectiveStatus === "Reserva"
            ? new Date(new Date(regISO).getTime() + 30 * 86400000).toISOString()
            : regISO;
        addProduct({
          clientId: client!.id,
          name: p.product,
          platform: p.platform || "—",
          totalValue: p.totalValue,
          paidValue: p.paidValue,
          financialStatus: effectiveStatus,
          situation: p.situation,
          registerDate: regISO,
          dueDate: dueISO,
        });
        stats.createdProducts++;
      });
      if (entry.notes) {
        const existing = client!.notes ? client!.notes + "\n\n" : "";
        updateClientNotes(client!.id, existing + entry.notes);
      }
      if (entry.mgmv) {
        const action = entry.mgmvAction ?? "apply";
        if (action === "apply") {
          setMGMVAgreement(client!.id, entry.mgmv);
          stats.createdAgreements++;
        } else if (action === "replace") {
          setMGMVAgreement(client!.id, entry.mgmv);
          stats.replacedAgreements++;
        }
        // "keep" → mantém o acordo existente, nada a fazer.
      }
    };

    // Processa pasta por pasta com pausa pra animação respirar.
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const entries = byFolder.get(folder)!;
      setImportProgress((prev) =>
        prev
          ? {
              ...prev,
              currentIdx: i,
              messages: [...prev.messages, `📂 Entrando em "${folder}" (${entries.length} cliente${entries.length === 1 ? "" : "s"})…`],
            }
          : prev,
      );
      await wait(500);
      const before = { ...stats };
      const folderErrors: string[] = [];
      entries.forEach((entry) => {
        try {
          processEntry(entry);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          folderErrors.push(`${folder} › ${entry.client?.name ?? "?"}: ${msg}`);
          stats.errorEntries++;
        }
      });
      const dC = stats.createdClients - before.createdClients;
      const dU = stats.updatedClients - before.updatedClients;
      const dP = stats.createdProducts - before.createdProducts;
      let nextState: ImportProgressState | null = null;
      setImportProgress((prev) => {
        if (!prev) return prev;
        nextState = {
          ...prev,
          currentIdx: i + 1,
          stats: { ...stats },
          messages: [
            ...prev.messages,
            `✅ "${folder}" — ${dC} novo(s), ${dU} atualizado(s), ${dP} produto(s).`,
          ],
          errors: [...prev.errors, ...folderErrors],
        };
        return nextState;
      });
      if (nextState) void persistProgress(nextState);
      await wait(450);
    }

    addImportHistory({
      source: "HTML Notion",
      file: zipData.zipName,
      clientsCreated: stats.createdClients,
      productsAdded: stats.createdProducts,
      errors: stats.errorEntries,
      status: stats.errorEntries > 0 ? "Com avisos" : "Concluído",
      fileHash: zipData.fileHash,
      agreementsCreated: stats.createdAgreements,
      agreementsReplaced: stats.replacedAgreements,
      skippedDuplicates: stats.ignoredDuplicates,
      durationMs: Math.round(performance.now() - startedAt),
    });
    let finalState: ImportProgressState | null = null;
    setImportProgress((prev) => {
      if (!prev) return prev;
      finalState = {
        ...prev,
        currentIdx: folders.length,
        done: true,
        stats: { ...stats },
        messages: [
          ...prev.messages,
          `🏁 Concluído em ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`,
        ],
      };
      return finalState;
    });
    if (finalState) void persistProgress(finalState);
    toast.success(
      `ZIP importado: ${stats.createdClients} novo(s) • ${stats.updatedClients} atualizado(s) • ${stats.createdProducts} produto(s) • ${stats.createdAgreements} MGMV novo(s)${stats.replacedAgreements ? ` • ${stats.replacedAgreements} MGMV substituído(s)` : ""} • ${stats.ignoredDuplicates} duplicata(s) ignorada(s)${stats.skippedAfterCorrection > 0 ? ` • ${stats.skippedAfterCorrection} pulado(s) por correção` : ""}`,
    );
    setZipData(null);
  };

  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const parsed = validateRows(parseTabular(res.data as Record<string, unknown>[]), findClientByPhone);
          setRows(parsed);
          toast.success(`${parsed.length} linha(s) processadas`);
        },
      });
      setTab("csv");
    } else if (ext === "xlsx" || ext === "xls") {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = validateRows(parseTabular(json), findClientByPhone);
      setRows(parsed);
      toast.success(`${parsed.length} linha(s) processadas`);
      setTab("excel");
    } else if (ext === "html" || ext === "htm") {
      const txt = await file.text();
      setHtmlText(txt);
      setTab("html");
      const result = parseNotionHtml(txt);
      setNotion(result);
      setRows(null);
      if (result.errors.length) toast.error(result.errors[0]);
      else {
        const totalProducts = result.clients.reduce((s, c) => s + c.products.length, 0);
        toast.success(`${result.clients.length} cliente(s) • ${totalProducts} produto(s) extraído(s)`);
      }
    } else if (ext === "txt" || ext === "md" || !ext) {
      const txt = await file.text();
      setText(txt);
      setTab("text");
      const raw = /<[a-z][\s\S]*>/i.test(txt) ? parseHTMLList(txt) : parseTextList(txt);
      const parsed = validateRows(raw, findClientByPhone);
      setRows(parsed);
      toast.success(`${parsed.length} linha(s) processadas`);
    } else {
      toast.error("Formato não suportado");
    }
  };

  const validateText = () => {
    if (!text.trim()) return toast.error("Cole os dados para validar.");
    const raw = /<[a-z][\s\S]*>/i.test(text) ? parseHTMLList(text) : parseTextList(text);
    const parsed = validateRows(raw, findClientByPhone);
    setRows(parsed);
    toast.success(`${parsed.length} linha(s) processadas`);
  };

  const summary = useMemo(() => {
    if (!rows) return { ok: 0, err: 0, newC: 0, foundC: 0, ready: 0 };
    return {
      ok: rows.filter((r) => r.result === "Pronto").length,
      err: rows.filter((r) => r.result === "Erro").length,
      newC: rows.filter((r) => !r.clientFound && r.result === "Pronto").length,
      foundC: rows.filter((r) => r.clientFound).length,
      ready: rows.filter((r) => r.result === "Pronto").length,
    };
  }, [rows]);

  const confirmImport = () => {
    if (!rows) return;
    const ready = rows.filter((r) => r.result === "Pronto");
    if (ready.length === 0) return toast.error("Nenhuma linha válida.");
    let createdClients = 0;
    ready.forEach((r) => {
      let client = findClientByPhone(r.phone);
      if (!client) {
        client = addClient({ name: r.name, phone: r.phone });
        createdClients++;
      }
      const total = r.totalValue ?? 0;
      const regISO = r.registerDate ?? new Date().toISOString();
      const dueISO =
        r.dueDate ??
        (r.financialStatus === "Reserva"
          ? new Date(new Date(regISO).getTime() + 30 * 86400000).toISOString()
          : new Date(new Date(regISO).getTime() + 7 * 86400000).toISOString());
      const paid = r.paidValue ?? (r.financialStatus === "Pago" ? total : 0);
      const finalStatus: FinancialStatus =
        r.financialStatus === "MGMV"
          ? "MGMV"
          : calculateFinancialStatus(total, paid);
      addProduct({
        clientId: client.id,
        name: r.product,
        platform: r.platform || "—",
        totalValue: total,
        paidValue: paid,
        financialStatus: finalStatus,
        situation: (r.situation || "Em Aberto") as Situation,
        registerDate: regISO,
        dueDate: dueISO,
        notes: r.notes,
      });
    });
    toast.success(
      `${ready.length} registro(s) importados • ${createdClients} cliente(s) novos • ${rows.length - ready.length} erro(s) ignorados`,
    );
    setRows(null);
    setText("");
    onScrollTo("clientes");
  };

  const confirmNotionImport = () => {
    if (!notion) return;
    const usableClients = notion.clients.filter(
      (c) => c.client.phone && c.client.name && c.errors.length === 0,
    );
    if (usableClients.length === 0) return toast.error("Nenhum cliente válido para importar.");
    const todayISO = new Date().toISOString();
    let totalProducts = 0;
    let createdClients = 0;
    let createdAgreements = 0;
    let firstClientId: string | null = null;
    usableClients.forEach((block) => {
      const validProducts = block.products.filter((p) => p.product && p.errors.length === 0);
      let client = findClientByPhone(block.client.phone);
      if (!client) {
        client = addClient({
          name: block.client.name,
          phone: block.client.phoneDisplay || block.client.phone,
        });
        createdClients++;
      }
      if (!firstClientId) firstClientId = client.id;
      validProducts.forEach((p) => {
        const regISO = p.registerDate ? new Date(`${p.registerDate}T12:00:00`).toISOString() : todayISO;
        const dueISO = p.dueDate
          ? new Date(`${p.dueDate}T12:00:00`).toISOString()
          : p.financialStatus === "Reserva"
            ? new Date(new Date(regISO).getTime() + 30 * 86400000).toISOString()
            : regISO;
        addProduct({
          clientId: client!.id,
          name: p.product,
          platform: p.platform || "—",
          totalValue: p.totalValue,
          paidValue: p.paidValue,
          financialStatus: p.financialStatus,
          situation: p.situation,
          registerDate: regISO,
          dueDate: dueISO,
        });
        totalProducts++;
      });
      if (block.notes) {
        const existing = client!.notes ? client!.notes + "\n\n" : "";
        updateClientNotes(client!.id, existing + block.notes);
      }
      // Cria/atualiza acordo MGMV consolidado a partir do texto "TOTAL: ..."
      const agreement = extractMGMVAgreementFromNotes(block.notes);
      if (agreement) {
        setMGMVAgreement(client!.id, agreement);
        createdAgreements++;
      }
    });
    toast.success(
      `${usableClients.length} cliente(s) • ${totalProducts} produto(s) • ${createdAgreements} acordo(s) MGMV • ${createdClients} novo(s)`,
    );
    setNotion(null);
    setHtmlText("");
    if (usableClients.length === 1 && firstClientId) openClient(firstClientId);
    onScrollTo("clientes");
  };

  const downloadModel = (kind: "csv" | "xlsx") => {
    const headers = ["nome","telefone","produto","plataforma","valor_total","valor_pago","status_financeiro","situacao","data_cadastro","data_limite","observacoes"];
    const sample = ["João Silva","11999999999","GTA V","PS5","250","50","Reserva","Em Aberto","2026-06-25","2026-07-25","Cliente pediu prazo"];
    if (kind === "csv") {
      const csv = headers.join(",") + "\n" + sample.join(",");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "modelo-clientes.csv";
      a.click();
    } else {
      const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Clientes");
      XLSX.writeFile(wb, "modelo-clientes.xlsx");
    }
  };

  return (
    <section id="import" className="one-page-section">
      <PageHeader
        title="Importação em Massa"
        description="Importe clientes e produtos por lista, HTML, CSV ou Excel."
      />

      <div className="mb-4">
        <UploadArea
          accept=".txt,.html,.htm,.csv,.xlsx,.xls"
          onFile={handleFile}
          hint="Arraste qualquer arquivo aqui (lista, HTML, CSV ou Excel) ou clique para selecionar"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="text">Lista</TabsTrigger>
              <TabsTrigger value="html">HTML / Notion</TabsTrigger>
              <TabsTrigger value="zip">ZIP Notion</TabsTrigger>
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="excel">Excel</TabsTrigger>
              <TabsTrigger value="manual">Cadastro manual</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-4 space-y-3">
              <TextDropzone value={text} onChange={setText} onFile={handleFile} />
              <div className="flex justify-end">
                <Button onClick={validateText}>Validar Importação</Button>
              </div>
            </TabsContent>

            <TabsContent value="html" className="mt-4 space-y-3">
              <UploadArea
                accept=".html,.htm"
                onFile={handleFile}
                hint="Arraste um arquivo HTML exportado do Notion ou clique para selecionar"
              />
              <details className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                <summary className="cursor-pointer font-medium">Colar HTML manualmente</summary>
                <textarea
                  value={htmlText}
                  onChange={(e) => setHtmlText(e.target.value)}
                  placeholder="<h1 class='page-title'>Nome - Telefone</h1>..."
                  className="mt-2 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs outline-none"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!htmlText.trim()) return toast.error("Cole o HTML para validar.");
                      const result = parseNotionHtml(htmlText);
                      setNotion(result);
                      setRows(null);
                      if (result.errors.length) toast.error(result.errors[0]);
                      else {
                        const total = result.clients.reduce((s, c) => s + c.products.length, 0);
                        toast.success(`${result.clients.length} cliente(s) • ${total} produto(s) extraído(s)`);
                      }
                    }}
                  >
                    Validar HTML
                  </Button>
                </div>
              </details>
            </TabsContent>

            <TabsContent value="zip" className="mt-4 space-y-3" id="zip-import">
              <div>
                <h3 className="text-sm font-semibold">Importar ZIP do Notion</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Envie o arquivo ZIP contendo a pasta mãe exportada do Notion. O sistema irá ler o
                  ZIP, localizar os arquivos HTML, extrair clientes e produtos, comparar duplicatas
                  e mostrar uma prévia antes da importação.
                </p>
              </div>
              <UploadArea
                accept=".zip"
                onFile={handleZipFile}
                hint={
                  zipProcessing
                    ? zipProgress && zipProgress.total > 0
                      ? `Lendo ZIP... ${zipProgress.done}/${zipProgress.total} arquivos`
                      : "Lendo ZIP..."
                    : "Arraste o ZIP exportado do Notion ou clique para selecionar"
                }
              />
              <p className="text-xs text-muted-foreground">
                Nada é salvo nesta etapa. Apenas após confirmar a importação os dados são gravados.
              </p>
            </TabsContent>

            <TabsContent value="csv" className="mt-4 space-y-3">
              <UploadArea accept=".csv" onFile={handleFile} hint="Arraste um arquivo CSV ou clique para selecionar" />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => downloadModel("csv")}>Baixar modelo CSV</Button>
              </div>
            </TabsContent>

            <TabsContent value="excel" className="mt-4 space-y-3">
              <UploadArea accept=".xlsx,.xls" onFile={handleFile} hint="Arraste um .xlsx/.xls ou clique para selecionar" />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => downloadModel("xlsx")}>Baixar modelo Excel</Button>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="mt-4">
              <ManualEntryForm
                onConfirm={(entries) => {
                  let savedClients = 0;
                  let savedProducts = 0;
                  for (const entry of entries) {
                    const existing = findClientByPhone(entry.phone);
                    const client = existing
                      ? existing
                      : addClient({
                          name: entry.name,
                          phone: entry.phone,
                          notes: entry.notes || undefined,
                        });
                    if (!existing) savedClients++;
                    for (const p of entry.products) {
                      addProduct({
                        clientId: client.id,
                        name: p.name,
                        platform: p.platform,
                        totalValue: p.totalValue,
                        paidValue: p.paidValue,
                        financialStatus: calculateFinancialStatus(p.totalValue, p.paidValue),
                        situation: p.situation,
                        registerDate: p.date,
                        dueDate: p.date,
                        notes: p.notes || undefined,
                      });
                      savedProducts++;
                    }
                  }
                  toast.success(
                    `${savedClients} cliente(s) novo(s) • ${savedProducts} produto(s) cadastrado(s).`,
                  );
                  onScrollTo("clientes");
                }}
              />
            </TabsContent>
          </Tabs>
        </Card>

        <div className="space-y-4">
          <Card title="Formato esperado">
            <p className="text-xs text-muted-foreground">Lista:</p>
            <code className="block rounded-md bg-muted p-2 text-xs">Nome - Telefone - Produto - Plataforma - Valor - Status</code>
            <p className="mt-3 text-xs text-muted-foreground">HTML / Notion:</p>
            <code className="block rounded-md bg-muted p-2 text-[10px] leading-relaxed">
              Título "Nome - Telefone" + tabela com Item, Plataforma, Valor, Valor Pago, Status, Data, Situação.
            </code>
            <p className="mt-3 text-xs text-muted-foreground">CSV/Excel — colunas:</p>
            <code className="block rounded-md bg-muted p-2 text-[10px] leading-relaxed">
              nome, telefone, produto, plataforma, valor_total, valor_pago, status_financeiro, situacao, data_cadastro, data_limite, observacoes
            </code>
            <p className="mt-3 text-xs text-muted-foreground">
              Telefone é o identificador. Status: Pago, Reserva, Pendente, MGMV. Situação: Em Aberto, Enviado, Desistiu, Abandonou.
            </p>
          </Card>
        </div>
      </div>

      {notion && (
        <NotionPreview
          result={notion}
          findClientByPhone={findClientByPhone}
          onConfirm={confirmNotionImport}
          onClear={() => { setNotion(null); setHtmlText(""); }}
        />
      )}

      {zipData && (
        <ZipPreview
          data={zipData}
          onClear={() => setZipData(null)}
          onConfirm={confirmZipImport}
          onToggleEntry={setEntrySelected}
          onToggleProduct={setProductSelected}
          onToggleAll={setAllEntriesSelected}
          onToggleFolder={setFolderSelected}
          onCorrectionAction={setCorrectionAction}
          onMgmvAction={setMgmvAction}
        />
      )}

      <ImportProgressModal
        state={importProgress}
        open={!!importProgress}
        onClose={() => {
          // Limpa do banco se já terminou (não precisa mais retomar).
          if (importProgress?.done && progressRowId) {
            void supabase.from("import_progress").delete().eq("id", progressRowId);
          }
          setProgressRowId(null);
          setImportProgress(null);
          if (importProgress?.done) onScrollTo("clientes");
        }}
        onDiscard={discardProgress}
      />

      <Dialog open={zipFailuresOpen} onOpenChange={setZipFailuresOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {zipData?.parseFailures.length ?? 0} arquivo(s) não puderam ser lidos
            </DialogTitle>
            <DialogDescription>
              Os arquivos abaixo foram ignorados na importação. Os demais foram processados
              normalmente e estão na prévia.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Arquivo</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {zipData?.parseFailures.map((f, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-mono text-[11px] break-all">{f.path}</td>
                    <td className="px-3 py-2 text-destructive">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Dica: o erro mais comum é uma data inválida na coluna "Data" da tabela do cliente
            (use o formato DD/MM/AAAA). Corrija no Notion, reexporte e tente novamente.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZipFailuresOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rows && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <MetricCard label="Registros válidos" value={summary.ok} status="success" />
            <MetricCard label="Registros com erro" value={summary.err} status="danger" />
            <MetricCard label="Clientes encontrados" value={summary.foundC} />
            <MetricCard label="Clientes novos" value={summary.newC} />
            <MetricCard label="Produtos prontos" value={summary.ready} status="primary" />
          </div>

          <Card
            title="Preview dos Dados"
            action={<Button onClick={confirmImport} disabled={summary.ok === 0}>Confirmar Importação</Button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Linha</th>
                    <th className="py-2 pr-3 font-medium">Data</th>
                    <th className="py-2 pr-3 font-medium">Nome</th>
                    <th className="py-2 pr-3 font-medium">Telefone</th>
                    <th className="py-2 pr-3 font-medium">Produto</th>
                    <th className="py-2 pr-3 font-medium">Plataforma</th>
                    <th className="py-2 pr-3 font-medium">Valor</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Aviso</th>
                    <th className="py-2 pr-3 font-medium">Cliente</th>
                    <th className="py-2 pr-3 font-medium">Resultado</th>
                    <th className="py-2 pr-3 font-medium">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-3 text-muted-foreground">{r.line}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{r.date ?? "—"}</td>
                      <td className="py-3 pr-3">{r.name || "—"}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{r.phone || "—"}</td>
                      <td className="py-3 pr-3">{r.product || "—"}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{r.platform || "—"}</td>
                      <td className="py-3 pr-3 tabular-nums">{Number.isFinite(r.totalValue ?? NaN) ? formatBRL(r.totalValue!) : "—"}</td>
                      <td className="py-3 pr-3">
                        <Tag variant={r.financialStatus === "Pago" ? "success" : r.financialStatus === "Pendente" ? "danger" : "warning"}>
                          {r.financialStatus || "—"}
                        </Tag>
                        {r.statusWarning && r.originalFinancialStatus && (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            original: <span className="line-through">{r.originalFinancialStatus}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs text-amber-600 dark:text-amber-400">
                        {r.statusWarning ?? "—"}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">{r.clientFound ? "Encontrado" : "Será criado"}</td>
                      <td className="py-3 pr-3"><Tag variant={r.result === "Pronto" ? "success" : "danger"}>{r.result}</Tag></td>
                      <td className="py-3 pr-3 text-destructive">{r.errors.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

function UploadArea({ accept, onFile, hint }: { accept: string; onFile: (f: File) => void; hint: string }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={
        "flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center text-sm transition " +
        (drag ? "border-primary bg-primary/5" : "border-input bg-muted/30 hover:bg-muted/50")
      }
    >
      <p className="font-medium">{hint}</p>
      <p className="mt-1 text-xs text-muted-foreground">Aceita: {accept}</p>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function TextDropzone({
  value,
  onChange,
  onFile,
}: {
  value: string;
  onChange: (v: string) => void;
  onFile: (f: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={
        "relative rounded-md border-2 border-dashed transition " +
        (drag ? "border-primary bg-primary/5" : "border-input bg-background")
      }
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Cole sua lista ou HTML aqui, ou arraste um arquivo..."
        className="min-h-64 w-full resize-y rounded-md bg-transparent p-3 font-mono text-sm outline-none"
      />
      {drag && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-primary/10 text-sm font-medium text-primary">
          Solte para importar
        </div>
      )}
    </div>
  );
}

function NotionPreview({
  result,
  findClientByPhone,
  onConfirm,
  onClear,
}: {
  result: NotionParseResult;
  findClientByPhone: (phone: string) => { id: string; name: string } | undefined;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const totalProducts = result.clients.reduce((s, c) => s + c.products.length, 0);
  const totalValid = result.clients.reduce(
    (s, c) => s + c.products.filter((p) => p.product && p.errors.length === 0).length,
    0,
  );
  const totalErrors = totalProducts - totalValid;
  const clientsWithError = result.clients.filter((c) => c.errors.length > 0).length;
  const canConfirm =
    result.clients.some(
      (c) => c.client.phone && c.client.name && c.errors.length === 0 && c.products.some((p) => p.product && p.errors.length === 0),
    );

  return (
    <div className="mt-6 space-y-4">
      {result.errors.length > 0 && (
        <Card>
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Clientes encontrados" value={result.clients.length} status="primary" />
        <MetricCard label="Clientes com erro" value={clientsWithError} status={clientsWithError > 0 ? "danger" : undefined} />
        <MetricCard label="Produtos válidos" value={totalValid} status="success" />
        <MetricCard label="Produtos com erro" value={totalErrors} status={totalErrors > 0 ? "danger" : undefined} />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClear}>Cancelar</Button>
        <Button onClick={onConfirm} disabled={!canConfirm}>Confirmar Importação</Button>
      </div>

      <div className="space-y-4">
        {result.clients.map((block) => {
          const existing = block.client.phone ? findClientByPhone(block.client.phone) : undefined;
          const validCount = block.products.filter((p) => p.product && p.errors.length === 0).length;
          return (
            <Card
              key={block.index}
              title={`Cliente ${block.index}: ${block.client.name || "(sem nome)"}`}
              action={
                <Tag variant={existing ? "success" : "warning"}>
                  {existing ? `Atualizar (${existing.name})` : "Será criado"}
                </Tag>
              }
            >
              <div className="grid gap-3 md:grid-cols-3 text-xs">
                <div><span className="text-muted-foreground">Telefone:</span> <span className="font-mono">{block.client.phone || "—"}</span></div>
                <div><span className="text-muted-foreground">Exibição:</span> {block.client.phoneDisplay || "—"}</div>
                <div><span className="text-muted-foreground">Produtos:</span> {validCount} / {block.products.length}</div>
              </div>

              {block.errors.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-destructive">
                  {block.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}

              {block.products.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Produto</th>
                        <th className="py-2 pr-3 font-medium">Plataforma</th>
                        <th className="py-2 pr-3 font-medium">Total</th>
                        <th className="py-2 pr-3 font-medium">Pago</th>
                        <th className="py-2 pr-3 font-medium">Restante</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Aviso</th>
                        <th className="py-2 pr-3 font-medium">Situação</th>
                        <th className="py-2 pr-3 font-medium">Cadastro</th>
                        <th className="py-2 pr-3 font-medium">Limite</th>
                        <th className="py-2 pr-3 font-medium">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.products.map((p, idx) => {
                        const ok = p.product && p.errors.length === 0;
                        return (
                          <tr key={idx} className="border-b border-border/60 last:border-0">
                            <td className="py-3 pr-3">{p.product || "—"}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.platform || "—"}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(p.totalValue)}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(p.paidValue)}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(p.remainingValue)}</td>
                            <td className="py-3 pr-3">
                              <Tag variant={p.financialStatus === "Pago" ? "success" : p.financialStatus === "Pendente" ? "danger" : "warning"}>{p.financialStatus}</Tag>
                              {p.statusWarning && p.originalFinancialStatus && p.originalFinancialStatus !== p.financialStatus && (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  original: <span className="line-through">{p.originalFinancialStatus}</span>
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-3 text-xs text-amber-600 dark:text-amber-400">{p.statusWarning ?? "—"}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.situation}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.registerDate ?? "—"}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.dueDate ?? "—"}</td>
                            <td className="py-3 pr-3">
                              <Tag variant={ok ? "success" : "danger"}>{ok ? "Pronto" : "Erro"}</Tag>
                              {(p.errors.length > 0 || p.warnings.length > 0) && (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  {[...p.errors, ...p.warnings].join(" • ")}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {block.notes && (
                <details className="mt-3 rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">Observações</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-xs">{block.notes}</pre>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// =================== ZIP Preview ===================

function ZipPreview({
  data,
  onClear,
  onConfirm,
  onToggleEntry,
  onToggleProduct,
  onToggleAll,
  onToggleFolder,
  onCorrectionAction,
  onMgmvAction,
}: {
  data: ZipPreviewData;
  onClear: () => void;
  onConfirm: () => void;
  onToggleEntry: (id: string, selected: boolean) => void;
  onToggleProduct: (entryId: string, productId: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onToggleFolder: (folder: string, selected: boolean) => void;
  onCorrectionAction: (id: string, action: "merge" | "skip") => void;
  onMgmvAction: (id: string, action: "apply" | "replace" | "keep") => void;
}) {
  const [filter, setFilter] = useState<ZipFilter>("todos");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const stats = useMemo(() => {
    const totalProducts = data.entries.reduce((s, e) => s + e.products.length, 0);
    const newClients = data.entries.filter((e) => !e.existingClient && !e.criticalError).length;
    const existing = data.entries.filter((e) => e.existingClient).length;
    const duplicates = data.entries.reduce(
      (s, e) => s + e.products.filter((p) => p.duplicate).length,
      0,
    );
    const mgmv = data.entries.filter((e) => e.mgmv).length;
    const mgmvConflicts = data.entries.filter((e) => e.mgmv && e.mgmvConflict).length;
    const mgmvPending = data.entries.filter(
      (e) => e.mgmv && e.mgmvConflict && !e.mgmvAction,
    ).length;
    const errors = data.entries.filter((e) => e.criticalError).length;
    const corrected = data.entries.reduce(
      (s, e) => s + e.products.filter((p) => p.statusWarning).length,
      0,
    );
    const phoneCorrected = data.entries.filter((e) => e.client.wasAutoCorrected).length;
    return {
      totalProducts,
      newClients,
      existing,
      duplicates,
      mgmv,
      mgmvConflicts,
      mgmvPending,
      errors,
      corrected,
      phoneCorrected,
    };
  }, [data]);

  // Itens MGMV separados — alimentam a seção dedicada de resultados.
  const mgmvEntries = useMemo(
    () => data.entries.filter((e) => !!e.mgmv),
    [data],
  );
  const mgmvTotals = useMemo(() => {
    let totalDebt = 0;
    let installments = 0;
    let installmentSum = 0;
    mgmvEntries.forEach((e) => {
      if (!e.mgmv) return;
      totalDebt += e.mgmv.totalDebt;
      installments += e.mgmv.installments.length;
      installmentSum += e.mgmv.installments[0]?.value ?? 0;
    });
    return {
      clients: mgmvEntries.length,
      totalDebt,
      installments,
      avgInstallment: mgmvEntries.length ? installmentSum / mgmvEntries.length : 0,
    };
  }, [mgmvEntries]);

  const filtered = useMemo(() => {
    return data.entries.filter((e) => {
      switch (filter) {
        case "prontos":
          return !e.criticalError;
        case "novos":
          return !e.existingClient && !e.criticalError;
        case "existentes":
          return !!e.existingClient;
        case "erro":
          return e.criticalError;
        case "duplicatas":
          return e.products.some((p) => p.duplicate);
        case "mgmv":
          return !!e.mgmv;
        case "semTelefone":
          return !e.client.phone || e.client.phone.length < 10;
        case "semProdutos":
          return e.products.length === 0;
        case "statusCorrigido":
          return e.products.some((p) => p.statusWarning);
        case "telefoneCorrigido":
          return !!e.client.wasAutoCorrected;
        default:
          return true;
      }
    });
  }, [data, filter]);
  const filteredIds = useMemo(() => new Set(filtered.map((e) => e.id)), [filtered]);

  const byFolder = useMemo(() => {
    const m = new Map<string, ZipClientPreview[]>();
    data.entries.forEach((e) => {
      const arr = m.get(e.folderName) ?? [];
      arr.push(e);
      m.set(e.folderName, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  // Pastas visíveis após filtro — fonte de verdade para a sanfona.
  const visibleFolders = useMemo(
    () =>
      byFolder
        .map(([folder, entries]) => {
          const visible = entries.filter((e) => filteredIds.has(e.id));
          return { folder, entries, visible };
        })
        .filter((g) => g.visible.length > 0),
    [byFolder, filteredIds],
  );

  // Mantém sempre uma pasta aberta. Se a aberta sumir do filtro, abre a próxima.
  const [openFolder, setOpenFolder] = useState<string>("");
  useEffect(() => {
    if (visibleFolders.length === 0) {
      if (openFolder) setOpenFolder("");
      return;
    }
    if (!visibleFolders.some((g) => g.folder === openFolder)) {
      setOpenFolder(visibleFolders[0].folder);
    }
  }, [visibleFolders, openFolder]);

  const selectedEntries = data.entries.filter((e) => e.selected && !e.criticalError);
  const summary = useMemo(() => {
    let newCount = 0;
    let updateCount = 0;
    let productCount = 0;
    let mgmvCount = 0;
    let dupCount = 0;
    selectedEntries.forEach((e) => {
      if (e.existingClient) updateCount++;
      else newCount++;
      e.products.forEach((p) => {
        if (!p.selected) return;
        if (p.duplicate) dupCount++;
        else if (p.product && p.errors.length === 0) productCount++;
      });
      if (e.mgmv) mgmvCount++;
    });
    return { newCount, updateCount, productCount, mgmvCount, dupCount, errCount: stats.errors };
  }, [selectedEntries, stats.errors]);

  // Default inteligente: se há qualquer warning grave, abre na visão "requer atenção".
  const hasAttentionItems =
    stats.errors > 0 ||
    stats.duplicates > 0 ||
    stats.mgmvPending > 0 ||
    stats.phoneCorrected > 0;
  // Move o default só uma vez (inicialização do hook).
  // Nota: useState init function abaixo cobre isso — esta variável é só para o filtro de UI.

  const filters: { key: ZipFilter; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "prontos", label: "Prontos" },
    { key: "novos", label: "Novos clientes" },
    { key: "existentes", label: "Existentes" },
    { key: "erro", label: "Com erro" },
    { key: "duplicatas", label: "Duplicatas" },
    { key: "mgmv", label: "MGMV" },
    { key: "semTelefone", label: "Sem telefone" },
    { key: "semProdutos", label: "Sem produtos" },
    { key: "statusCorrigido", label: "Status corrigido" },
    { key: "telefoneCorrigido", label: "Telefone corrigido" },
  ];
  // Silencia warning de variável não-usada quando não há decisão automática.
  void hasAttentionItems;

  return (
    <div className="mt-6 space-y-4">
      {data.globalErrors.length > 0 && (
        <Card>
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {data.globalErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}

      {data.alreadyImported && (
        <Card>
          <div className="text-sm">
            <strong className="text-amber-600 dark:text-amber-400">Este ZIP já foi importado anteriormente</strong>
            {data.previousImportDate && (
              <span className="text-muted-foreground">
                {" "}em {new Date(data.previousImportDate).toLocaleString("pt-BR")}
              </span>
            )}
            . O sistema continuará detectando duplicatas item a item — você pode
            seguir com a importação, mas revise antes de confirmar.
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            sha1: {data.fileHash}
          </div>
        </Card>
      )}

      {data.errorGroups.length > 0 && (
        <Card>
          <div className="mb-2 text-sm font-semibold">
            Falhas de leitura agrupadas por causa
          </div>
          <ul className="space-y-1 text-xs">
            {data.errorGroups.slice(0, 6).map((g, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span className="text-destructive">{g.reason}</span>
                <span className="shrink-0 text-muted-foreground">
                  {g.paths.length} arquivo(s)
                </span>
              </li>
            ))}
          </ul>
          {data.errorGroups.length > 6 && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              + {data.errorGroups.length - 6} causa(s) adicional(is)…
            </div>
          )}
        </Card>
      )}

      {/* Métricas ordenadas por severidade: problemas primeiro, depois números frios. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <MetricCard
          label="Com erro"
          value={stats.errors}
          status={stats.errors > 0 ? "danger" : "default"}
        />
        <MetricCard
          label="MGMV em conflito"
          value={stats.mgmvConflicts}
          status={stats.mgmvConflicts > 0 ? "danger" : "default"}
        />
        <MetricCard
          label="Duplicatas"
          value={stats.duplicates}
          status={stats.duplicates > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Telefone corrigido"
          value={stats.phoneCorrected}
          status={stats.phoneCorrected > 0 ? "warning" : "default"}
        />
        <MetricCard label="Novos clientes" value={stats.newClients} status="success" />
        <MetricCard label="Existentes" value={stats.existing} />
        <MetricCard label="Produtos" value={stats.totalProducts} />
        <MetricCard label="Acordos MGMV" value={stats.mgmv} status={stats.mgmv > 0 ? "warning" : "default"} />
      </div>

      {/* ============= Seção dedicada de resultados MGMV ============= */}
      {mgmvEntries.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">
                MGMV detectados na extração
              </div>
              <div className="text-xs text-muted-foreground">
                Acordos parcelados identificados nas observações dos clientes.
                A cobrança passa a ser feita pela parcela; os itens originais
                viram informação.
              </div>
            </div>
            {stats.mgmvPending > 0 && (
              <Tag variant="danger">
                {stats.mgmvPending} aguardando decisão
              </Tag>
            )}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Clientes em MGMV" value={mgmvTotals.clients} status="warning" />
            <MetricCard label="Dívida total" value={formatBRL(mgmvTotals.totalDebt)} />
            <MetricCard label="Parcelas no total" value={mgmvTotals.installments} />
            <MetricCard
              label="Parcela média"
              value={formatBRL(mgmvTotals.avgInstallment)}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Cliente</th>
                  <th className="py-2 pr-2 font-medium">Telefone</th>
                  <th className="py-2 pr-2 font-medium">Dívida</th>
                  <th className="py-2 pr-2 font-medium">Parcelas</th>
                  <th className="py-2 pr-2 font-medium">Valor parcela</th>
                  <th className="py-2 pr-2 font-medium">Conflito</th>
                  <th className="py-2 pr-2 font-medium">Decisão</th>
                </tr>
              </thead>
              <tbody>
                {mgmvEntries.map((e) => {
                  if (!e.mgmv) return null;
                  const ins = e.mgmv.installments;
                  return (
                    <tr key={e.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-2">{e.client.name || "—"}</td>
                      <td className="py-2 pr-2 font-mono text-muted-foreground">
                        {e.client.phoneDisplay || "—"}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">
                        {formatBRL(e.mgmv.totalDebt)}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">{ins.length}x</td>
                      <td className="py-2 pr-2 tabular-nums">
                        {formatBRL(ins[0]?.value ?? 0)}
                      </td>
                      <td className="py-2 pr-2">
                        {e.mgmvConflict ? (
                          <Tag variant="danger">
                            {e.mgmvConflict.existingPaid}/{e.mgmvConflict.existingTotal} pagas
                          </Tag>
                        ) : e.existingClient?.mgmv ? (
                          <Tag variant="warning">Substitui acordo</Tag>
                        ) : (
                          <Tag variant="success">Novo</Tag>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {e.mgmvConflict ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant={e.mgmvAction === "replace" ? "default" : "ghost"}
                              onClick={() => onMgmvAction(e.id, "replace")}
                            >
                              Substituir
                            </Button>
                            <Button
                              size="sm"
                              variant={e.mgmvAction === "keep" ? "default" : "ghost"}
                              onClick={() => onMgmvAction(e.id, "keep")}
                            >
                              Manter atual
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Aplicar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Pastas" value={data.folders.size} status="primary" />
        <MetricCard label="Arquivos HTML" value={data.files} />
        <MetricCard label="Clientes detectados" value={data.entries.length} />
        <MetricCard label="Status corrigido" value={stats.corrected} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                "rounded-full border px-3 py-1 text-xs transition " +
                (filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted")
              }
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onToggleAll(true)}>
              Selecionar todos
            </Button>
            <Button size="sm" variant="outline" onClick={() => onToggleAll(false)}>
              Limpar seleção
            </Button>
            <Button variant="outline" onClick={onClear}>Cancelar</Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={selectedEntries.length === 0}
            >
              Confirmar Importação
            </Button>
          </div>
        </div>
      </Card>

      <Accordion
        type="single"
        collapsible
        value={openFolder}
        onValueChange={(v) => setOpenFolder(v)}
        className="space-y-4"
      >
        {visibleFolders.map(({ folder, entries: entriesInFolder, visible }) => {
          const allSel = entriesInFolder.every((e) => e.selected || e.criticalError);
          const isOpenFolder = openFolder === folder;
          return (
            <AccordionItem
              key={folder}
              value={folder}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-2">
                <AccordionTrigger className="flex-1 py-2 text-left text-sm font-semibold hover:no-underline">
                  <span>
                    {folder} <span className="text-muted-foreground font-normal">• {visible.length} cliente(s)</span>
                  </span>
                </AccordionTrigger>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onToggleFolder(folder, !allSel);
                  }}
                >
                  {allSel ? "Desmarcar pasta" : "Selecionar pasta"}
                </Button>
              </div>
              <AccordionContent>
                <div className="p-5">
                  {isOpenFolder && (
                  <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Sel</th>
                      <th className="py-2 pr-3 font-medium">Arquivo</th>
                      <th className="py-2 pr-3 font-medium">Cliente</th>
                      <th className="py-2 pr-3 font-medium">Telefone</th>
                      <th className="py-2 pr-3 font-medium">Produtos</th>
                      <th className="py-2 pr-3 font-medium">Total</th>
                      <th className="py-2 pr-3 font-medium">Pago</th>
                      <th className="py-2 pr-3 font-medium">Restante</th>
                      <th className="py-2 pr-3 font-medium">MGMV</th>
                      <th className="py-2 pr-3 font-medium">Resultado</th>
                      <th className="py-2 pr-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => {
                      const totals = e.products.reduce(
                        (s, p) => {
                          s.total += p.totalValue;
                          s.paid += p.paidValue;
                          return s;
                        },
                        { total: 0, paid: 0 },
                      );
                      const remaining = Math.max(0, totals.total - totals.paid);
                      const result = e.criticalError
                        ? { label: "Erro", variant: "danger" as const }
                        : e.existingClient
                          ? { label: "Atualizar", variant: "success" as const }
                          : { label: "Novo cliente", variant: "primary" as const };
                      const isOpen = expanded.has(e.id);
                      return (
                        <Fragment key={e.id}>
                          <tr className="border-b border-border/60">
                            <td className="py-3 pr-3">
                              <input
                                type="checkbox"
                                checked={e.selected}
                                disabled={e.criticalError}
                                onChange={(ev) => onToggleEntry(e.id, ev.target.checked)}
                              />
                            </td>
                            <td className="py-3 pr-3 text-xs text-muted-foreground">{e.fileName}</td>
                            <td className="py-3 pr-3">{e.client.name || "—"}</td>
                            <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">
                              {e.client.phoneDisplay || e.client.phone || "—"}
                            </td>
                            <td className="py-3 pr-3 tabular-nums">{e.products.length}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(totals.total)}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(totals.paid)}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(remaining)}</td>
                            <td className="py-3 pr-3">
                              {e.mgmv ? (
                                <Tag variant="warning">
                                  {e.mgmv.installments.length}x {formatBRL(e.mgmv.installments[0]?.value ?? 0)}
                                </Tag>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-3 pr-3">
                              <Tag variant={result.variant}>{result.label}</Tag>
                              {e.client.wasAutoCorrected && !e.criticalError && (
                                <div className="mt-1">
                                  <Tag variant="warning">Corrigido automaticamente</Tag>
                                </div>
                              )}
                              {e.matchedAfterCorrection && (
                                <div className="mt-1 space-y-1">
                                  <Tag variant="warning">Match após correção</Tag>
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant={e.correctionAction !== "skip" ? "default" : "ghost"}
                                      onClick={() => onCorrectionAction(e.id, "merge")}
                                    >
                                      Mesclar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={e.correctionAction === "skip" ? "default" : "ghost"}
                                      onClick={() => onCorrectionAction(e.id, "skip")}
                                    >
                                      Pular
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {e.client.correctionReason && !e.criticalError && (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  {e.client.correctionReason}
                                </div>
                              )}
                              {e.errors.length > 0 && (
                                <div className="mt-1 text-[10px] text-destructive">
                                  {e.errors.join("; ")}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-3">
                              <Button size="sm" variant="ghost" onClick={() => toggleExpand(e.id)}>
                                {isOpen ? "Recolher" : "Expandir"}
                              </Button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-border/60 bg-muted/20">
                              <td colSpan={11} className="p-3">
                                {e.products.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">Sem produtos.</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                                          <th className="py-1 pr-2 font-medium">Sel</th>
                                          <th className="py-1 pr-2 font-medium">Produto</th>
                                          <th className="py-1 pr-2 font-medium">Plataforma</th>
                                          <th className="py-1 pr-2 font-medium">Total</th>
                                          <th className="py-1 pr-2 font-medium">Pago</th>
                                          <th className="py-1 pr-2 font-medium">Restante</th>
                                          <th className="py-1 pr-2 font-medium">Status orig.</th>
                                          <th className="py-1 pr-2 font-medium">Status calc.</th>
                                          <th className="py-1 pr-2 font-medium">Situação</th>
                                          <th className="py-1 pr-2 font-medium">Cadastro</th>
                                          <th className="py-1 pr-2 font-medium">Limite</th>
                                          <th className="py-1 pr-2 font-medium">Dup.</th>
                                          <th className="py-1 pr-2 font-medium">Aviso</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {e.products.map((p) => (
                                          <tr key={p.tempId} className="border-b border-border/40 last:border-0">
                                            <td className="py-2 pr-2">
                                              <input
                                                type="checkbox"
                                                checked={p.selected}
                                                onChange={(ev) =>
                                                  onToggleProduct(e.id, p.tempId, ev.target.checked)
                                                }
                                              />
                                            </td>
                                            <td className="py-2 pr-2">{p.product || "—"}</td>
                                            <td className="py-2 pr-2 text-muted-foreground">{p.platform || "—"}</td>
                                            <td className="py-2 pr-2 tabular-nums">{formatBRL(p.totalValue)}</td>
                                            <td className="py-2 pr-2 tabular-nums">{formatBRL(p.paidValue)}</td>
                                            <td className="py-2 pr-2 tabular-nums">{formatBRL(p.remainingValue)}</td>
                                            <td className="py-2 pr-2 text-muted-foreground">
                                              {p.originalFinancialStatus ?? "—"}
                                            </td>
                                            <td className="py-2 pr-2">
                                              <Tag
                                                variant={
                                                  p.financialStatus === "Pago"
                                                    ? "success"
                                                    : p.financialStatus === "Pendente"
                                                      ? "danger"
                                                      : "warning"
                                                }
                                              >
                                                {p.financialStatus}
                                              </Tag>
                                            </td>
                                            <td className="py-2 pr-2 text-muted-foreground">{p.situation}</td>
                                            <td className="py-2 pr-2 text-muted-foreground">{p.registerDate ?? "—"}</td>
                                            <td className="py-2 pr-2 text-muted-foreground">{p.dueDate ?? "—"}</td>
                                            <td className="py-2 pr-2">
                                              {p.duplicate ? (
                                                <Tag variant="warning">
                                                  {p.duplicateAfterCorrection ? "Duplicata (após correção)" : "Duplicata"}
                                                </Tag>
                                              ) : (
                                                <span className="text-muted-foreground">—</span>
                                              )}
                                            </td>
                                            <td className="py-2 pr-2 text-[10px] text-amber-600 dark:text-amber-400">
                                              {p.statusWarning ?? (p.warnings.length ? p.warnings.join("; ") : "—")}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {e.notes && (
                                  <details className="mt-2 rounded-md border border-border bg-background p-2 text-xs">
                                    <summary className="cursor-pointer font-medium">Observações</summary>
                                    <pre className="mt-1 whitespace-pre-wrap text-xs">{e.notes}</pre>
                                  </details>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                  </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Importação</DialogTitle>
            <DialogDescription>
              Os dados abaixo serão gravados no sistema. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            <li>• {summary.newCount} cliente(s) novo(s) serão criados</li>
            <li>• {summary.updateCount} cliente(s) existente(s) serão atualizados</li>
            <li>• {summary.productCount} produto(s) serão adicionados</li>
            <li>• {summary.mgmvCount} acordo(s) MGMV serão criados</li>
            <li>• {summary.dupCount} duplicata(s) serão ignoradas</li>
            <li>• {summary.errCount} registro(s) com erro não serão importados</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                onConfirm();
              }}
            >
              Confirmar Importação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Cadastro manual estruturado por inputs
// ============================================================================

interface ManualProduct {
  id: string;
  name: string;
  platform: string;
  totalValue: number;
  paidValue: number;
  date: string; // ISO
  situation: Situation;
  notes: string;
}

interface ManualClient {
  id: string;
  name: string;
  phone: string;
  notes: string;
  products: ManualProduct[];
}

const SITUATIONS: Situation[] = ["Em Aberto", "Enviado", "Desistiu", "Abandonou"];

const newProduct = (): ManualProduct => ({
  id: crypto.randomUUID(),
  name: "",
  platform: "",
  totalValue: 0,
  paidValue: 0,
  date: new Date().toISOString().slice(0, 10),
  situation: "Em Aberto",
  notes: "",
});

const newClient = (): ManualClient => ({
  id: crypto.randomUUID(),
  name: "",
  phone: "",
  notes: "",
  products: [newProduct()],
});

function ManualEntryForm({ onConfirm }: { onConfirm: (entries: ManualClient[]) => void }) {
  const [clients, setClients] = useState<ManualClient[]>([newClient()]);
  const [preview, setPreview] = useState<ManualClient[] | null>(null);

  const updateClient = (id: string, patch: Partial<ManualClient>) =>
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updateProduct = (cid: string, pid: string, patch: Partial<ManualProduct>) =>
    setClients((cs) =>
      cs.map((c) =>
        c.id === cid
          ? { ...c, products: c.products.map((p) => (p.id === pid ? { ...p, ...patch } : p)) }
          : c,
      ),
    );
  const addProduct = (cid: string) =>
    setClients((cs) => cs.map((c) => (c.id === cid ? { ...c, products: [...c.products, newProduct()] } : c)));
  const removeProduct = (cid: string, pid: string) =>
    setClients((cs) =>
      cs.map((c) =>
        c.id === cid ? { ...c, products: c.products.filter((p) => p.id !== pid) } : c,
      ),
    );
  const addClientRow = () => setClients((cs) => [...cs, newClient()]);
  const removeClient = (cid: string) => setClients((cs) => cs.filter((c) => c.id !== cid));

  const validate = (): { ok: true; data: ManualClient[] } | { ok: false; error: string } => {
    const cleaned = clients.map((c) => ({
      ...c,
      name: c.name.trim(),
      phone: c.phone.trim(),
      products: c.products.filter((p) => p.name.trim() || p.platform.trim()),
    }));
    for (const c of cleaned) {
      if (!c.name) return { ok: false, error: "Todo cliente precisa de nome." };
      if (!c.phone) return { ok: false, error: `Cliente "${c.name}" precisa de telefone.` };
      if (c.products.length === 0)
        return { ok: false, error: `Cliente "${c.name}" precisa de ao menos um produto.` };
      for (const p of c.products) {
        if (!p.name.trim()) return { ok: false, error: `Produto sem nome em "${c.name}".` };
        if (!p.platform.trim())
          return { ok: false, error: `Produto "${p.name}" precisa de plataforma.` };
      }
    }
    return { ok: true, data: cleaned };
  };

  const onPreview = () => {
    const r = validate();
    if (!r.ok) return toast.error(r.error);
    setPreview(r.data);
  };

  const onSave = () => {
    if (!preview) return toast.error("Gere o preview antes de salvar.");
    onConfirm(preview);
    setPreview(null);
    setClients([newClient()]);
  };

  const inputCls =
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-primary/40";

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Cadastre clientes e produtos por formulário. Sempre gere o preview antes de salvar.
      </p>

      <div className="space-y-4">
        {clients.map((c, ci) => (
          <div key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Cliente {ci + 1}</h4>
              {clients.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeClient(c.id)}>
                  Remover cliente
                </Button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className={inputCls}
                placeholder="Nome do cliente"
                value={c.name}
                onChange={(e) => updateClient(c.id, { name: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Telefone (com DDD)"
                value={c.phone}
                onChange={(e) => updateClient(c.id, { phone: e.target.value })}
              />
            </div>
            <textarea
              className={`${inputCls} min-h-16`}
              placeholder="Observações do cliente (opcional)"
              value={c.notes}
              onChange={(e) => updateClient(c.id, { notes: e.target.value })}
            />

            <div className="space-y-2">
              {c.products.map((p, pi) => (
                <div key={p.id} className="rounded-md border border-dashed border-border p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Produto {pi + 1}</span>
                    {c.products.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline"
                        onClick={() => removeProduct(c.id, p.id)}
                      >
                        remover
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className={inputCls} placeholder="Produto" value={p.name}
                      onChange={(e) => updateProduct(c.id, p.id, { name: e.target.value })} />
                    <input className={inputCls} placeholder="Plataforma (PS5, Xbox, PC...)" value={p.platform}
                      onChange={(e) => updateProduct(c.id, p.id, { platform: e.target.value })} />
                    <input className={inputCls} type="number" min={0} step="0.01" placeholder="Valor total"
                      value={p.totalValue || ""}
                      onChange={(e) => updateProduct(c.id, p.id, { totalValue: Number(e.target.value) || 0 })} />
                    <input className={inputCls} type="number" min={0} step="0.01" placeholder="Valor pago"
                      value={p.paidValue || ""}
                      onChange={(e) => updateProduct(c.id, p.id, { paidValue: Number(e.target.value) || 0 })} />
                    <input className={inputCls} type="date" value={p.date.slice(0, 10)}
                      onChange={(e) => updateProduct(c.id, p.id, { date: e.target.value })} />
                    <select className={inputCls} value={p.situation}
                      onChange={(e) => updateProduct(c.id, p.id, { situation: e.target.value as Situation })}>
                      {SITUATIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  <textarea className={`${inputCls} min-h-12`} placeholder="Observações do produto (opcional)"
                    value={p.notes}
                    onChange={(e) => updateProduct(c.id, p.id, { notes: e.target.value })} />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => addProduct(c.id)}>
                + Adicionar produto para este cliente
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button variant="outline" onClick={addClientRow}>+ Adicionar mais um cliente</Button>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="outline" onClick={onPreview}>Pré-visualizar cadastro</Button>
        <Button onClick={onSave} disabled={!preview}>Confirmar cadastro</Button>
      </div>

      {preview && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <h4 className="text-sm font-semibold mb-2">Preview ({preview.length} cliente(s))</h4>
          <ul className="space-y-1 text-xs">
            {preview.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong> — {c.phone} • {c.products.length} produto(s):{" "}
                {c.products.map((p) => `${p.name} (${formatBRL(p.totalValue)})`).join(", ")}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Confirme o cadastro para gravar. Clientes já existentes pelo telefone receberão apenas os novos produtos.
          </p>
        </div>
      )}
    </div>
  );
}