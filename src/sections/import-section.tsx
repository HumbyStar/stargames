import { BackupImportCard } from "@/components/backup-import-card";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
  calculateReservaDueDate,
  calculateDueDateForStatus,
  formatBRL,
  useStore,
  getResetVersion,
  type Client,
  type FinancialStatus,
  type MGMVAgreement,
  type MGMVInstallment,
  type Product,
  type Situation,
} from "@/lib/store";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ImportProgressModal, type ImportProgressState } from "@/components/import-progress-modal";
import { ImportCard, ImportCardsGrid } from "@/components/import-cards";
import { ListImportModal } from "@/components/list-import-modal";
import { ImportConveyor } from "@/components/import-conveyor";
import {
  Users,
  ShieldCheck,
  Box,
  Wallet,
  AlertOctagon,
  Brain,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  ChevronDown,
  Search,
  Loader2,
  ClipboardPaste,
  ClipboardCopy,
  Eraser,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeListWithAI } from "@/lib/list-ai-analyze.functions";
import { useBlocker } from "@tanstack/react-router";
import { usePersistedState } from "@/lib/use-persisted-state";
import { Download, AlertCircle } from "lucide-react";
import { normalizeSituation } from "@/lib/situation-normalizer";

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
  /** Onde este registro cai no sistema após importação. */
  clientCategory: "mgmv" | "common";
  /** O que a importação vai fazer com o cliente. */
  clientAction: "create" | "update_existing" | "reuse_existing";
  /** O que a importação vai fazer com o produto. */
  productAction: "new_product_new_client" | "add_to_existing_client" | "duplicate_product";
  /** Nome salvo no banco (quando cliente já existe). */
  existingClientName?: string;
}

const VALID_SITUATION = [
  "Em Aberto",
  "Enviado",
  "Retirado",
  "Removido",
  "Desistiu",
  "Abandonou",
  "Resolvido",
] as const;

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

/**
 * Normaliza a coluna "Situação" da planilha do Notion conforme regra de negócio:
 * - Enviado/Entregue/Retirado → produto entregue (Enviado)
 * - Removido → Removido
 * - Desistiu/Cancelou → Desistiu
 * - Abandonou → Abandonou
 * - MGMV/Acordo/Parcelado → Resolvido (também marca financialStatus como MGMV
 *   no caller, via `situationMentionsMgmv`)
 * - Vazio → "Em Aberto" (ÚNICO caso legítimo)
 * - Texto preenchido mas não reconhecido → "Resolvido" + flag de revisão,
 *   pois a regra do Notion é: "se há texto na coluna, há uma solução vigente".
 *   Isso evita dupla cobrança apontada no bug.
 */
const normalizeSituationBR = (
  s: string,
): { situation: Situation; unrecognized: boolean } => {
  // Delegado ao normalizador canônico compartilhado por toda a importação
  // (ZIP/Notion, CSV, IA e lista colada). Buckets oficiais: Enviado, Retirado,
  // Retirar, Removido, MGMV, Pago.
  const r = normalizeSituation(s);
  if (r.unknown) return { situation: "Resolvido", unrecognized: true };
  return { situation: (r.situation ?? "Em Aberto") as Situation, unrecognized: false };
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
  return calculateDueDateForStatus(status, registerDate).split("T")[0];
};

// ---- Helpers MGMV ----
const ORDINAL_WORDS: Record<string, number> = {
  primeira: 1,
  segunda: 2,
  terceira: 3,
  quarta: 4,
  quinta: 5,
  sexta: 6,
  setima: 7,
  oitava: 8,
  nona: 9,
  decima: 10,
};

const MONTH_NAMES: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

function stripAccents(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Soma `months` mantendo o mesmo dia; se o mês destino não tiver o dia,
 * usa o último dia válido (ex.: 31/01 + 1 mês = 28/02 ou 29/02). */
export function addMonthsClampDay(base: Date, months: number): Date {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  const target = new Date(y, m + months, 1, 12, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return target;
}

/** Procura uma data BR num trecho de texto.
 * Aceita "DD/MM/AAAA", "DD-MM-AAAA" e "dia DD de MES (de AAAA)?".
 * Sem ano, usa `refYear`. Retorna ISO ou undefined. */
export function extractPaymentDate(
  fragment: string,
  refYear: number,
): string | undefined {
  // DD/MM/YYYY ou DD-MM-YYYY ou DD/MM/YY
  // Ordem \d{4}|\d{2} é obrigatória: alternação testa esquerda p/ direita e
  // (\d{2}|\d{4}) casaria "20" em "2026" quando não há âncora de fim.
  const numeric = fragment.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}|\d{2})(?!\d)/);
  if (numeric) {
    const iso = normalizeDateBR(
      `${numeric[1]}/${numeric[2]}/${numeric[3].length === 2 ? "20" + numeric[3] : numeric[3]}`,
    );
    if (iso) return new Date(`${iso}T12:00:00`).toISOString();
  }
  // "dia DD de MES (de AAAA)?", ou "DD de MES (de AAAA)?" (sem "dia"),
  // ou "DD MES" (ex.: "6 Junho"). Só aceita quando MES é um nome de mês
  // reconhecido (MONTH_NAMES), para evitar falsos positivos.
  const named =
    fragment.match(
      /(?:\bdia\s+)?(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)(?:\s+de\s+(\d{4}))?/i,
    ) ||
    fragment.match(/\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})(?:\s+de\s+(\d{4}))?/i);
  if (named) {
    const day = Number(named[1]);
    const monthKey = stripAccents(named[2]);
    const month = MONTH_NAMES[monthKey];
    if (Number.isFinite(day) && month !== undefined) {
      const year = named[3] ? Number(named[3]) : refYear;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const safeDay = Math.min(day, lastDay);
      return new Date(year, month, safeDay, 12, 0, 0).toISOString();
    }
  }
  return undefined;
}

/** Ano de referência: usa o primeiro ano de 4 dígitos achado nas notas
 * (incluindo o do "1º Pagamento"), senão o ano corrente. */
export function inferReferenceYear(notes: string, firstPaymentRaw?: string): number {
  if (firstPaymentRaw) {
    const m = firstPaymentRaw.match(/\d{4}/);
    if (m) return Number(m[0]);
  }
  const m = notes.match(/\b(20\d{2})\b/);
  if (m) return Number(m[1]);
  return new Date().getFullYear();
}

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

  // ---- Detecta parcelas pagas + datas individuais ----
  // paidByNumber[N] = ISO date | undefined (paga sem data)
  const paidByNumber = new Map<number, string | undefined>();
  // paidAmountByNumber[N] = valor parcial pago (quando explicitado entre
  // parênteses e MENOR que o valor da parcela). Ex.: "1/4 Parcela paga (50 reais)"
  // com parcela de R$150 → registra 50 como pagamento parcial da parcela 1.
  const paidAmountByNumber = new Map<number, number>();
  // Sinais de conflito que forçam reviewStatus = "review_required".
  const conflictSignals: string[] = [];
  const refYear = inferReferenceYear(notes, firstPaymentMatch?.[1]);

  // 1) Linhas com número explícito: "→ 2 Parcela ... paga dia 29 de Maio"
  //    ou "2ª parcela paga dia 29/05/2026". Rejeita dígito precedido por
  //    "/" ou "," (para não casar o "4" de "1/4 Parcela paga" como
  //    parcela nº 4 — cenário real observado em produção).
  const perLineNum =
    /(?<![\d/,])(\d+)\s*[ªº]?\s*Parcela[^\n]*?\b(?:paga|pago|quitada|quitado)\b[^\n]*/gi;
  for (const m of notes.matchAll(perLineNum)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= count) {
      const date = extractPaymentDate(m[0], refYear);
      if (!paidByNumber.has(n) || (date && !paidByNumber.get(n))) {
        paidByNumber.set(n, date);
      }
      // Detecta pagamento parcial: "(50 reais)" ou "(R$ 50)" com valor
      // menor que o valor da parcela.
      const partialMatch = m[0].match(
        /\((?:R\$\s*)?([\d.,]+)\s*(?:reais|rs)?\)/i,
      );
      if (partialMatch) {
        const amount = normalizeMoney(partialMatch[1]);
        if (amount > 0 && amount < value) {
          paidAmountByNumber.set(n, amount);
          conflictSignals.push(
            `Parcela ${n} paga parcialmente (R$ ${amount} de R$ ${value})`,
          );
        }
      }
    }
  }

  // 1b) Padrão "X/Y Parcela paga" — X = parcela paga; Y = total previsto
  //     pela nota. Se Y != count captura o Y como conflito de contagem.
  const fracRe =
    /(\d+)\s*\/\s*(\d+)\s*[ªº]?\s*Parcela[^\n]*?\b(?:paga|pago|quitada|quitado)\b[^\n]*/gi;
  for (const m of notes.matchAll(fracRe)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (Number.isFinite(x) && x > 0 && x <= count) {
      const date = extractPaymentDate(m[0], refYear);
      if (!paidByNumber.has(x) || (date && !paidByNumber.get(x))) {
        paidByNumber.set(x, date);
      }
      const partialMatch = m[0].match(
        /\((?:R\$\s*)?([\d.,]+)\s*(?:reais|rs)?\)/i,
      );
      if (partialMatch) {
        const amount = normalizeMoney(partialMatch[1]);
        if (amount > 0 && amount < value) {
          paidAmountByNumber.set(x, amount);
          conflictSignals.push(
            `Parcela ${x} paga parcialmente (R$ ${amount} de R$ ${value})`,
          );
        }
      }
    }
    if (Number.isFinite(y) && y > 0 && y !== count) {
      conflictSignals.push(
        `Nota diz "${x}/${y}" mas parser identificou ${count} parcelas`,
      );
    }
  }

  // 2) Linhas com ordinal por extenso: "Primeira parcela paga dia 30 de Abril"
  //    "pagou segunda parcela", "segunda paga dia 29 de Maio".
  const perLineOrd =
    /(primeira|segunda|terceira|quarta|quinta|sexta|s[ée]tima|oitava|nona|d[ée]cima)[^\n]*?(?:\bparcela\b)?[^\n]*?\b(?:paga|pago|quitada|quitado)\b[^\n]*/gi;
  for (const m of notes.matchAll(perLineOrd)) {
    const n = ORDINAL_WORDS[stripAccents(m[1])];
    if (n && n <= count) {
      const date = extractPaymentDate(m[0], refYear);
      if (!paidByNumber.has(n) || (date && !paidByNumber.get(n))) {
        paidByNumber.set(n, date);
      }
    }
  }
  // "pagou primeira parcela" / "pagou a segunda" — captura sem exigir "parcela" após
  const pagouOrdRe =
    /pagou\s+(?:a\s+)?(primeira|segunda|terceira|quarta|quinta|sexta|s[ée]tima|oitava|nona|d[ée]cima)/gi;
  for (const m of notes.matchAll(pagouOrdRe)) {
    const n = ORDINAL_WORDS[stripAccents(m[1])];
    if (n && n <= count && !paidByNumber.has(n)) paidByNumber.set(n, undefined);
  }

  // 3) Bulk: "2 parcelas pagas", "Pagou 3 parcelas", "quitou 1 parcela".
  //    Só aceita a forma "N parcelas pagas" no plural OU quando N não
  //    está precedido por "/" ou "," (evita "1/4 Parcela paga" virar
  //    bulk=4). Também exige "parcelas" no plural para números > 1.
  let bulkPaidCount = 0;
  if (/pago\s+primeira\s+parcela/i.test(notes)) bulkPaidCount = Math.max(bulkPaidCount, 1);
  const pagasMatch = notes.match(
    /(?<![\d/,])(\d+)\s*parcelas\s*pagas/i,
  );
  if (pagasMatch) bulkPaidCount = Math.max(bulkPaidCount, Number(pagasMatch[1]));
  const pagouMatch = notes.match(
    /(?:pagou|quitou)\s+(\d+)\s*parcelas?/i,
  );
  if (pagouMatch) bulkPaidCount = Math.max(bulkPaidCount, Number(pagouMatch[1]));
  bulkPaidCount = Math.min(bulkPaidCount, count);
  if (paidByNumber.size === 0 && bulkPaidCount > 0) {
    for (let i = 1; i <= bulkPaidCount; i++) paidByNumber.set(i, undefined);
  } else if (paidByNumber.size < bulkPaidCount) {
    // garante que o total quitado é pelo menos bulkPaidCount, preenchendo
    // sequencialmente os números ainda não marcados.
    let n = 1;
    while (paidByNumber.size < bulkPaidCount && n <= count) {
      if (!paidByNumber.has(n)) paidByNumber.set(n, undefined);
      n++;
    }
  }

  // ---- Datas de vencimento ----
  const firstDueIso =
    firstPaymentMatch && normalizeDateBR(firstPaymentMatch[1])
      ? new Date(`${normalizeDateBR(firstPaymentMatch[1])}T12:00:00`).toISOString()
      : null;

  // Última parcela paga com data (regra do próximo vencimento).
  let lastPaidDate: Date | null = null;
  let lastPaidNumber = 0;
  for (const [n, iso] of paidByNumber.entries()) {
    if (iso && n > lastPaidNumber) {
      lastPaidNumber = n;
      lastPaidDate = new Date(iso);
    }
  }

  // Calcula a base de vencimento para a primeira parcela pendente.
  // Regra: lastPaid + 1 mês (mesmo dia, clampado). Fallback: firstDueIso, depois hoje.
  const installments: MGMVInstallment[] = [];
  for (let i = 1; i <= count; i++) {
    const paidIso = paidByNumber.get(i);
    const partialAmount = paidAmountByNumber.get(i);
    const isPartial = partialAmount !== undefined;
    // Pagamento parcial NÃO conta como parcela quitada.
    const paid = paidByNumber.has(i) && !isPartial;
    let dueIso: string;
    if (paid && paidIso) {
      dueIso = paidIso;
    } else if (isPartial && paidIso) {
      // Parcela com pagamento parcial permanece pendente, mas o vencimento
      // exibido segue a data do pagamento parcial (dá contexto ao usuário).
      dueIso = paidIso;
    } else if (lastPaidDate && i > lastPaidNumber) {
      const offset = i - lastPaidNumber;
      dueIso = addMonthsClampDay(lastPaidDate, offset).toISOString();
    } else if (firstDueIso) {
      dueIso = addMonthsClampDay(new Date(firstDueIso), i - 1).toISOString();
    } else {
      dueIso = addMonthsClampDay(new Date(), i - 1).toISOString();
    }
    installments.push({
      number: i,
      total: count,
      dueDate: dueIso,
      value,
      paid,
      paidAt: paid ? paidIso : undefined,
      paidAmount: isPartial ? partialAmount : paid ? value : undefined,
    });
  }

  return {
    startDate: new Date().toISOString(),
    totalDebt,
    installments,
    reviewStatus: conflictSignals.length > 0 ? "review_required" : undefined,
  };
}

function parseProductsTable(
  table: Element,
  lineOffset = 0,
  opts: { forceMgmv?: boolean; mgmvHeading?: string } = {},
): NotionProduct[] {
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
        line: lineOffset + idx + 1,
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
    const financialStatus: FinancialStatus =
      opts.forceMgmv || originalStatus === "MGMV" || situationMentionsMgmv
        ? "MGMV"
        : calculateFinancialStatus(totalValue, paidValue);
    if (
      opts.forceMgmv &&
      originalStatus !== "MGMV" &&
      !situationMentionsMgmv
    ) {
      const label = opts.mgmvHeading
        ? `"${opts.mgmvHeading}"`
        : "cabeçalho da tabela";
      rowWarnings.push(
        `Item classificado como MGMV pelo ${label}.`,
      );
    }
    let statusWarning: string | undefined;
    if (
      financialStatus !== originalStatus &&
      !situationMentionsMgmv &&
      !opts.forceMgmv
    ) {
      statusWarning =
        paidValue === 0
          ? "Valor pago é zero, portanto o status correto é Pendente."
          : paidValue >= totalValue && totalValue > 0
            ? "Valor pago quita o total, portanto o status correto é Pago."
            : "Existe valor pago de entrada, portanto o status correto é Reserva.";
      rowWarnings.push(`Status corrigido de "${originalStatus}" para "${financialStatus}". ${statusWarning}`);
    }
    const situationResult = normalizeSituationBR(situation ?? "");
    const situationN = situationResult.situation;
    if (!String(situation ?? "").trim()) {
      rowWarnings.push('Situação vazia (usado "Em Aberto").');
    } else if (situationResult.unrecognized) {
      rowWarnings.push(
        `Situação "${String(situation).trim()}" não reconhecida — marcada como "Resolvido". Verifique a observação no Notion.`,
      );
    }
    const registerDate = normalizeDateBR(date ?? "");
    const dueDate = calculateDueDate(financialStatus, registerDate);
    products.push({
      line: lineOffset + idx + 1,
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
  // Um mesmo cliente do Notion pode ter várias <table> (histórico separado
  // por período, lotes MGMV, itens removidos etc.). Concatenamos os produtos
  // de todas elas para não perder linhas na migração.
  let tables = Array.from(article.querySelectorAll("table.simple-table"));
  if (tables.length === 0) {
    tables = Array.from(article.querySelectorAll("table"));
  }
  let products: NotionProduct[] = [];
  if (tables.length === 0) {
    errors.push(`Cliente #${index} (${client.name || "sem nome"}): tabela não encontrada.`);
  } else {
    for (const t of tables) {
      const ctx = collectTableContext(t);
      const mgmvHit = tableHeadingMentionsMgmv(ctx);
      const parsed = parseProductsTable(t, products.length, {
        forceMgmv: !!mgmvHit,
        mgmvHeading: mgmvHit || undefined,
      });
      products = products.concat(parsed);
    }
  }
  return {
    index,
    client,
    products,
    notes: extractClientNotes(article),
    errors,
  };
}

/**
 * Concatena o texto dos elementos imediatamente anteriores à tabela — subindo
 * pelos `previousElementSibling` até encontrar outra `<table>` ou o topo do
 * artigo. É esse contexto que decide se a tabela pertence a uma seção MGMV
 * (ex.: heading "LOTE FECHADO MEU GAME MINHA VIDA" antes da tabela).
 */
function collectTableContext(table: Element): string {
  const parts: string[] = [];
  let node: Element | null = table.previousElementSibling;
  // Também sobe um nível se necessário para pegar heading dentro de wrapper.
  let hops = 0;
  while (node && hops < 12) {
    const tag = node.tagName.toLowerCase();
    if (tag === "table") break;
    // ignora elementos vazios
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) parts.unshift(text);
    node = node.previousElementSibling;
    hops++;
  }
  return parts.join(" \u2022 ");
}

/**
 * Retorna o trecho do heading que menciona MGMV (para uso como label em
 * warning), ou `null` quando não há match ou o contexto contém negação
 * explícita ("fora do MGMV", "não MGMV").
 */
export function tableHeadingMentionsMgmv(context: string): string | null {
  if (!context) return null;
  const lower = context.toLowerCase();
  if (/(fora\s+do\s+mgmv|n[aã]o\s+mgmv|sem\s+mgmv)/.test(lower)) return null;
  const re = /(mgmv|meu\s*game\s*minha\s*vida|lote\s*fechado|acordo)/i;
  const m = context.match(re);
  if (!m) return null;
  // Tenta devolver a "linha" (trecho separado por • ou quebra) que contém o
  // match, para o warning ficar informativo.
  const chunks = context.split(/[\u2022\n]/).map((c) => c.trim());
  const hit = chunks.find((c) => re.test(c));
  return (hit || m[0]).slice(0, 80);
}

export function parseNotionHtml(html: string, fileName?: string): NotionParseResult {
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

/**
 * Tetos de sanidade para abrir um ZIP — existem APENAS para conter zip-bomb
 * e travamento do navegador. Não são cortes de "primeiros N": quando o ZIP
 * cabe nos tetos, todos os arquivos são processados em lotes (CHUNK abaixo).
 * Volumes muito altos disparam aviso e processam mesmo assim.
 */
const ZIP_LIMITS = {
  /** Apenas para alertar — não trunca mais. Importação processa todos. */
  highVolumeFiles: 2000,
  /** Por arquivo HTML individual — apenas aviso, não bloqueia. */
  maxFileBytes: Number.POSITIVE_INFINITY,
  /** ZIP inteiro — sem teto. Importação não pode ser interrompida por limite. */
  maxTotalBytes: Number.POSITIVE_INFINITY,
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

type RawParsedRow = Omit<
  ParsedRow,
  "clientFound" | "result" | "errors" | "clientCategory" | "clientAction" | "productAction" | "existingClientName"
>;

function parseTextList(input: string): RawParsedRow[] {
  const lines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const dateMatch = lines[0].match(/(\d{2}\/\d{2}\/\d{4})/);
  const headerDate = dateMatch ? dateMatch[1] : null;
  const productLines = dateMatch ? lines.slice(1) : lines;
  return productLines.map((line, idx) => {
    const parts = line.split("-").map((s) => s.trim());
    const [name, phone, product, platform, value, status] = parts;
    // Normaliza status do formato padrão. Regras:
    //  - "Reserva"        → financialStatus "Reserva", paidValue padrão R$10
    //  - "Reserva(30)"    → financialStatus "Reserva", paidValue R$30
    //  - "Pago"/"Pendente"/"MGMV" passam direto
    //  - vazio/desconhecido fica como veio para o validateRows tratar
    const rawStatus = String(status ?? "").trim();
    const statusLower = rawStatus.toLowerCase();
    let normalizedStatus = rawStatus;
    let paidValue: number | null = null;
    if (/^reserva\b/.test(statusLower)) {
      const m = rawStatus.match(/\(\s*([\d.,]+)\s*\)/);
      paidValue = m ? parseValue(m[1]) : 10;
      if (!Number.isFinite(paidValue)) paidValue = 10;
      normalizedStatus = "Reserva";
    } else if (statusLower.includes("pago")) {
      normalizedStatus = "Pago";
    } else if (statusLower.includes("mgmv")) {
      normalizedStatus = "MGMV";
    } else if (statusLower.includes("pendente")) {
      normalizedStatus = "Pendente";
    }
    return {
      line: idx + 1,
      date: headerDate,
      name: name ?? "",
      phone: phone ?? "",
      product: product ?? "",
      platform: platform ?? "",
      totalValue: parseValue(value),
      paidValue,
      financialStatus: normalizedStatus,
      situation: "Em Aberto",
      registerDate: headerDate ? normalizeDateBR(headerDate) : null,
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

function parseTabular(rows: Record<string, unknown>[]): RawParsedRow[] {
  const toYMD = (v: string | undefined | null): string | null => {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return normalizeDateBR(s);
  };
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
      registerDate: toYMD(reg),
      dueDate: toYMD(due),
      notes: get("observacoes") || undefined,
    };
  });
}

function validateRows(
  raw: RawParsedRow[],
  findClientByPhone: (phone: string) => Client | undefined,
  products: Product[],
): ParsedRow[] {
  return raw.map((r) => {
    const errors: string[] = [];
    if (!r.name) errors.push("Nome obrigatório");
    const phoneDigits = normalizePhone(r.phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) errors.push("Telefone inválido");
    if (!r.product) errors.push("Produto sem nome");
    if (r.totalValue === null || !Number.isFinite(r.totalValue) || r.totalValue <= 0) errors.push("Valor inválido");
    if (r.situation && !VALID_SITUATION.includes(r.situation as (typeof VALID_SITUATION)[number])) errors.push("Situação inválida");
    if (
      String(r.financialStatus).toLowerCase() === "reserva" &&
      r.paidValue !== null &&
      Number.isFinite(r.paidValue) &&
      (r.paidValue as number) < 10
    ) {
      errors.push("Valor mínimo de reserva é R$ 10");
    }
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
    // Mesma regra usada em Clientes / MGMV / Cobrança:
    //   clientType === "mgmv" OU acordo ativo com parcelas.
    // No importador, também consideramos MGMV se a própria linha vier com
    // status financeiro MGMV (a confirmação promove o cliente).
    const clientIsMgmv =
      !!found &&
      (found.clientType === "mgmv" ||
        (!!found.mgmv && found.mgmv.installments.length > 0));
    const isMgmv = correctedStatus === "MGMV" || clientIsMgmv;
    const clientCategory: "mgmv" | "common" = isMgmv ? "mgmv" : "common";
    let clientAction: ParsedRow["clientAction"] = "create";
    if (found) {
      const sameName =
        found.name.trim().toLowerCase() === r.name.trim().toLowerCase();
      clientAction = sameName ? "reuse_existing" : "update_existing";
    }
    const normalizedProduct = r.product.trim().toLowerCase();
    const normalizedPlatform = r.platform.trim().toLowerCase();
    const duplicateProduct =
      !!found &&
      normalizedProduct.length > 0 &&
      products.some(
        (p) =>
          p.clientId === found.id &&
          p.name.trim().toLowerCase() === normalizedProduct &&
          p.platform.trim().toLowerCase() === normalizedPlatform,
      );
    let productAction: ParsedRow["productAction"] = "new_product_new_client";
    if (duplicateProduct) productAction = "duplicate_product";
    else if (found) productAction = "add_to_existing_client";
    if (duplicateProduct) {
      errors.push(`Produto "${r.product}" já existe para este cliente.`);
    }
    return {
      ...r,
      phone: phoneDigits,
      financialStatus: correctedStatus,
      originalFinancialStatus: originalStatus,
      statusWarning,
      clientFound: !!found,
      clientCategory,
      clientAction,
      productAction,
      existingClientName: found?.name,
      result: errors.length === 0 ? "Pronto" : "Erro",
      errors,
    };
  });
}

export function ImportSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const findClientByPhone = useStore((s) => s.findClientByPhone);
  const addClient = useStore((s) => s.addClient);
  const updateClient = useStore((s) => s.updateClient);
  const addProduct = useStore((s) => s.addProduct);
  const openClient = useStore((s) => s.openClient);
  const updateClientNotes = useStore((s) => s.updateClientNotes);
  const setMGMVAgreement = useStore((s) => s.setMGMVAgreement);
  const addImportHistory = useStore((s) => s.addImportHistory);
  const persistConfirmedImport = useStore((s) => s.persistConfirmedImport);
  const products = useStore((s) => s.products);
  const clients = useStore((s) => s.clients);
  const importHistory = useStore((s) => s.importHistory);
  const hydrated = useStore((s) => s.hydrated);
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(SAMPLE_LIST);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Trava síncrona contra duplo clique nos botões de confirmação de import.
  // O estado React só muda no render seguinte, então dois cliques rápidos
  // podem entrar duas vezes no mesmo fluxo e duplicar clientes/produtos.
  const importBusyRef = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const guardImport = (fn: () => unknown) => async () => {
    if (importBusyRef.current) return;
    importBusyRef.current = true;
    setImportBusy(true);
    try {
      await fn();
    } finally {
      importBusyRef.current = false;
      setImportBusy(false);
    }
  };
  const [notion, setNotion] = useState<NotionParseResult | null>(null);
  const [htmlText, setHtmlText] = useState("");
  const [zipData, setZipData] = useState<ZipPreviewData | null>(null);
  const [zipProcessing, setZipProcessing] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [zipFailuresOpen, setZipFailuresOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [progressRowId, setProgressRowId] = useState<string | null>(null);
  const importRunning = !!(importProgress && !importProgress.done && !importProgress.resumed);

  // Trava de navegação reforçada: intercepta qualquer mudança de rota e
  // dispara um modal de confirmação enquanto a importação está rodando.
  // `enableBeforeUnload` também segura reload/fechar aba.
  const blocker = useBlocker({
    shouldBlockFn: () => importRunning,
    enableBeforeUnload: () => importRunning,
    withResolver: true,
  });

  // Persiste o estado de progresso no banco (best-effort, não bloqueia a UI).
  const persistProgress = async (state: ImportProgressState) => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return { ok: false as const, error: "Sem usuário autenticado" };
      const payload = {
        user_id: uid,
        file_hash: state.fileHash,
        zip_name: state.zipName,
        folders: state.folders,
        current_idx: state.currentIdx,
        total: state.folders.length,
        messages: state.messages.slice(-200),
        errors: state.errors.slice(-200),
        stats: {
          ...state.stats,
          resetVersion: getResetVersion(),
          ignoredItems: (state.ignoredItems ?? []).slice(-500),
          recordsTotal: state.recordsTotal ?? 0,
          recordsProcessed: state.recordsProcessed ?? 0,
        },
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
        return { ok: false as const, error: error.message };
      }
      if (data?.id) setProgressRowId(data.id);
      return { ok: true as const };
    } catch (err) {
      console.warn("[import_progress] erro inesperado", err);
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  };

  // Persiste com retentativa exponencial. Sob falhas de rede, NÃO perde o progresso:
  // mantém o estado em memória, sinaliza retentativa no modal e tenta novamente até
  // suceder (ou até o usuário fechar a aba). Continua no mesmo lote depois.
  const persistProgressWithRetry = async (state: ImportProgressState, batchIdx: number) => {
    const maxBackoffMs = 15000;
    let attempt = 0;
    while (true) {
      const res = await persistProgress(state);
      if (res?.ok) {
        if (attempt > 0) {
          setImportProgress((prev) => (prev ? { ...prev, retrying: null } : prev));
        }
        return;
      }
      attempt++;
      const reason = res?.error ?? "rede indisponível";
      console.warn(`[import_progress] tentativa ${attempt} no lote ${batchIdx} falhou: ${reason}`);
      setImportProgress((prev) =>
        prev ? { ...prev, retrying: { attempt, reason } } : prev,
      );
      const wait = Math.min(maxBackoffMs, 800 * 2 ** Math.min(attempt - 1, 6));
      await new Promise<void>((r) => setTimeout(r, wait));
      // Loop indefinidamente — o modal exibe a retentativa; o lote não avança até persistir.
      if (attempt >= 50) {
        // safety: após 50 tentativas (~10 min), encerra a espera e segue, mas mantém aviso
        setImportProgress((prev) =>
          prev ? { ...prev, retrying: { attempt, reason: `${reason} (continuando offline)` } } : prev,
        );
        return;
      }
    }
  };

  // Ao montar, retoma uma importação não finalizada (se houver).
  useEffect(() => {
    if (!hydrated) return;
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
        // Se a versão de reset mudou desde que esse progresso foi salvo,
        // descartar silenciosamente — não é mais válido.
        const stats = (data.stats as Record<string, unknown>) ?? {};
        const progressResetVersion = String(stats.resetVersion ?? "");
        const currentResetVersion = getResetVersion();
        if (!progressResetVersion || (currentResetVersion && progressResetVersion !== currentResetVersion)) {
          void supabase.from("import_progress").delete().eq("id", data.id);
          try {
            const { clearImportRuntimeState } = await import("@/lib/db-sync");
            clearImportRuntimeState();
          } catch {
            /* ignore */
          }
          return;
        }
        setProgressRowId(data.id);
        const restoredIgnored =
          (stats as { ignoredItems?: ImportProgressState["ignoredItems"] }).ignoredItems ?? [];
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
          ignoredItems: restoredIgnored,
          recordsTotal: Number((stats as { recordsTotal?: number }).recordsTotal ?? 0),
          recordsProcessed: Number((stats as { recordsProcessed?: number }).recordsProcessed ?? 0),
          currentBatchSize: 0,
          currentBatchProcessed: 0,
          retrying: null,
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
  }, [hydrated]);

  const discardProgress = async () => {
    // Apaga TODOS os progressos do usuário, não apenas o atual — evita
    // que outro registro órfão volte a aparecer como "importação interrompida".
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (uid) {
        await supabase.from("import_progress").delete().eq("user_id", uid);
      } else if (progressRowId) {
        await supabase.from("import_progress").delete().eq("id", progressRowId);
      }
    } catch {
      /* ignore */
    }
    // Limpa também qualquer cache local de importação.
    try {
      const { clearImportRuntimeState } = await import("@/lib/db-sync");
      clearImportRuntimeState();
    } catch {
      /* ignore */
    }
    setProgressRowId(null);
    setImportProgress(null);
    toast.success("Progresso de importação descartado.");
  };

  const handleZipFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return toast.error("Envie um arquivo .zip");
    }
    // Sem teto de tamanho — a importação processa o ZIP inteiro em lotes.
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
      if (rawEntries.length > ZIP_LIMITS.highVolumeFiles) {
        // Não corta mais. Apenas avisa que será processado em lotes.
        globalErrors.push(
          `Volume alto detectado: ${rawEntries.length} arquivos HTML. A importação será processada em lotes para evitar travamentos — pode levar alguns minutos. Não feche esta tela até concluir.`,
        );
        toast.warning(
          `Volume alto: ${rawEntries.length} arquivos. Processando em lotes…`,
          { duration: 6000 },
        );
      }
      setZipProgress({ done: 0, total: rawEntries.length });
      // Extrai em lotes para manter a UI responsiva em arquivos grandes.
      // Lote maior em ZIPs grandes ajuda a throughput sem travar a aba.
      const CHUNK = rawEntries.length > 1000 ? 100 : 50;
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
    const ignoredItems: NonNullable<ImportProgressState["ignoredItems"]> = [];
    // Ids criados nesta importação — usados na confirmação de exibição na tela.
    const zipCreatedClientIds: string[] = [];
    const zipCreatedProductIds: string[] = [];
    const zipTouchedClientIds = new Set<string>();

    // Agrupa entradas por pasta para processamento lazy/calmo.
    const byFolder = new Map<string, typeof zipData.entries>();
    zipData.entries.forEach((e) => {
      const key = e.folderName || "(raiz)";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(e);
    });
    const folders = Array.from(byFolder.keys());

    const startedAtISO = new Date().toISOString();
    const recordsTotal = Array.from(byFolder.values()).reduce((acc, arr) => acc + arr.length, 0);
    let recordsProcessed = 0;
    const initialState: ImportProgressState = {
      fileHash: zipData.fileHash,
      zipName: zipData.zipName,
      startedAt: startedAtISO,
      folders,
      currentIdx: -1,
      messages: [`📦 Abrindo ZIP "${zipData.zipName}"…`, `🗂️ ${folders.length} pasta(s) na esteira.`],
      errors: [],
      stats: { ...stats },
      recordsTotal,
      recordsProcessed: 0,
      currentBatchSize: 0,
      currentBatchProcessed: 0,
      retrying: null,
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
          if (ignoredItems.length < 500) {
            ignoredItems.push({
              client: entry.client.name || entry.client.phone || "?",
              product: p.product,
              date: p.registerDate || "",
              folder: entry.folderName || "(raiz)",
            });
          }
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
          ? effectiveStatus === "Reserva"
            ? calculateReservaDueDate(regISO)
            : new Date(`${p.dueDate}T12:00:00`).toISOString()
          : calculateDueDateForStatus(effectiveStatus, regISO);
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
      // Produtos marcados como MGMV (via tabela contextual "LOTE FECHADO MEU
      // GAME MINHA VIDA" ou coluna Status=MGMV) precisam gerar um acordo
      // MGMV sintético quando não há acordo consolidado nas observações.
      // Cada produto vira uma parcela, preservando o histórico de pagamento.
      const mgmvProducts = entry.products.filter(
        (p) =>
          p.selected &&
          p.errors.length === 0 &&
          !!p.product &&
          !p.duplicate &&
          p.financialStatus === "MGMV",
      );
      const alreadyHasAgreement =
        !!entry.mgmv && (entry.mgmvAction ?? "apply") !== "keep";
      if (mgmvProducts.length > 0 && !alreadyHasAgreement) {
        const sorted = [...mgmvProducts].sort((a, b) =>
          (a.registerDate ?? "").localeCompare(b.registerDate ?? ""),
        );
        const totalDebt = sorted.reduce((s, p) => s + (p.totalValue || 0), 0);
        const startDate =
          (sorted[0]?.registerDate
            ? new Date(`${sorted[0].registerDate}T12:00:00`).toISOString()
            : todayISO);
        const installments: MGMVInstallment[] = sorted.map((p, idx) => {
          const value = p.totalValue || 0;
          const paid = (p.paidValue || 0) >= value && value > 0;
          const dueISO = p.dueDate
            ? new Date(`${p.dueDate}T12:00:00`).toISOString()
            : p.registerDate
              ? new Date(`${p.registerDate}T12:00:00`).toISOString()
              : todayISO;
          return {
            number: idx + 1,
            total: sorted.length,
            dueDate: dueISO,
            value,
            paid,
            paidAt: paid
              ? p.registerDate
                ? new Date(`${p.registerDate}T12:00:00`).toISOString()
                : todayISO
              : undefined,
            paidAmount: p.paidValue || 0,
          };
        });
        const synthetic: MGMVAgreement = {
          startDate,
          totalDebt,
          installments,
          reviewStatus: "review_required",
        };
        setMGMVAgreement(client!.id, synthetic);
        stats.createdAgreements++;
      }
      // Garante clientType = "mgmv" quando há produtos MGMV, mesmo que o
      // acordo já exista (caso "keep").
      if (mgmvProducts.length > 0 && client!.clientType !== "mgmv") {
        updateClient(client!.id, { clientType: "mgmv" });
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
              currentBatchSize: entries.length,
              currentBatchProcessed: 0,
              messages: [...prev.messages, `📂 Entrando em "${folder}" (${entries.length} cliente${entries.length === 1 ? "" : "s"})…`],
            }
          : prev,
      );
      await wait(500);
      const before = { ...stats };
      const folderErrors: string[] = [];
      let batchDone = 0;
      entries.forEach((entry) => {
        try {
          processEntry(entry);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          folderErrors.push(`${folder} › ${entry.client?.name ?? "?"}: ${msg}`);
          stats.errorEntries++;
        }
        batchDone++;
        recordsProcessed++;
        if (batchDone % 25 === 0) {
          setImportProgress((prev) =>
            prev ? { ...prev, currentBatchProcessed: batchDone, recordsProcessed } : prev,
          );
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
          ignoredItems: ignoredItems.slice(),
          recordsProcessed,
          currentBatchProcessed: entries.length,
          messages: [
            ...prev.messages,
            `✅ "${folder}" — ${dC} novo(s), ${dU} atualizado(s), ${dP} produto(s).`,
          ],
          errors: [...prev.errors, ...folderErrors],
        };
        return nextState;
      });
      if (nextState) {
        // Aguarda persistência com retentativa automática — não perde progresso de rede.
        await persistProgressWithRetry(nextState, i);
      }
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
    const savedHistory = useStore.getState().importHistory[0];
    if (savedHistory) {
      await persistConfirmedImport({
        clients: useStore.getState().clients,
        products: useStore.getState().products,
        history: savedHistory,
      });
    }
    let finalState: ImportProgressState | null = null;
    setImportProgress((prev) => {
      if (!prev) return prev;
      finalState = {
        ...prev,
        currentIdx: folders.length,
        done: true,
        stats: { ...stats },
        ignoredItems: ignoredItems.slice(),
        messages: [
          ...prev.messages,
          `🏁 Concluído em ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`,
        ],
      };
      return finalState;
    });
    if (finalState) await persistProgressWithRetry(finalState, folders.length);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (uid) {
        await supabase.from("import_progress").delete().eq("user_id", uid).eq("file_hash", zipData.fileHash);
      }
    } catch {
      /* ignore */
    }
    toast.success(
      `ZIP importado: ${stats.createdClients} novo(s) • ${stats.updatedClients} atualizado(s) • ${stats.createdProducts} produto(s) • ${stats.createdAgreements} MGMV novo(s)${stats.replacedAgreements ? ` • ${stats.replacedAgreements} MGMV substituído(s)` : ""} • ${stats.ignoredDuplicates} duplicata(s) ignorada(s)${stats.skippedAfterCorrection > 0 ? ` • ${stats.skippedAfterCorrection} pulado(s) por correção` : ""}`,
    );
    // Reprocessa acordos MGMV a partir das observações automaticamente,
    // para que o usuário não precise clicar em "Reprocessar MGMV por
    // observações" após cada importação. Dynamic import evita ciclo com
    // src/sections/import-section.tsx.
    try {
      const { reprocessMGMVFromNotes } = await import("@/lib/mgmv-reprocess");
      const { updatedIds: updated } = reprocessMGMVFromNotes();
      if (updated.length > 0) {
        toast.success(`MGMV reprocessado automaticamente: ${updated.length} acordo(s) atualizado(s).`);
      }
    } catch (err) {
      console.warn("Reprocesso automático de MGMV falhou:", err);
    }
    setZipData(null);
  };

  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const parsed = validateRows(parseTabular(res.data as Record<string, unknown>[]), findClientByPhone, products);
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
      const parsed = validateRows(parseTabular(json), findClientByPhone, products);
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
      const parsed = validateRows(raw, findClientByPhone, products);
      setRows(parsed);
      toast.success(`${parsed.length} linha(s) processadas`);
    } else {
      toast.error("Formato não suportado");
    }
  };

  const [aiLoading, setAiLoading] = useState(false);
  // Modal da Importação Assistida com IA (recebe o texto colado e roda o fluxo dedicado).
  const [aiListModal, setAiListModal] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  // Token incremental para descartar respostas obsoletas / fluxos cancelados.
  // Não dá para abortar a chamada do server function por dentro, mas
  // ignorar o resultado garante que estado e toasts não escapem.
  const aiRequestIdRef = useRef(0);
  useEffect(() => {
    return () => {
      // Marca todas as requisições pendentes como obsoletas no unmount.
      aiRequestIdRef.current += 1;
    };
  }, []);
  const validateText = async () => {
    if (!text.trim()) return toast.error("Cole os dados para validar.");
    // HTML continua com parser dedicado; texto puro vai direto para a IA.
    if (/<[a-z][\s\S]*>/i.test(text)) {
      const raw = parseHTMLList(text);
      const parsed = validateRows(raw, findClientByPhone, products);
      setRows(parsed);
      toast.success(`${parsed.length} linha(s) processadas`);
      return;
    }
    setAiLoading(true);
    const requestId = ++aiRequestIdRef.current;
    try {
      const { rows: aiRows } = await analyzeListWithAI({ data: { text } });
      if (requestId !== aiRequestIdRef.current) return; // resposta obsoleta
      if (aiRows.length === 0) {
        toast.warning("A IA não identificou clientes na lista.");
        return;
      }
      // Converte para o formato do parser para reaproveitar validateRows.
      const raw = aiRows.map((r, idx) => ({
        line: r.line || idx + 1,
        date: null,
        name: r.name,
        phone: r.phone,
        product: r.product,
        platform: r.platform,
        totalValue: r.totalValue,
        paidValue: r.paidValue,
        financialStatus: r.financialStatus,
        situation: r.situation,
        registerDate: null,
        dueDate: null,
        notes: [r.notes, r.fixes.length ? `IA: ${r.fixes.join("; ")}` : null]
          .filter(Boolean)
          .join(" • ") || undefined,
      }));
      const parsed = validateRows(raw, findClientByPhone, products);
      setRows(parsed);
      const fixed = aiRows.filter((r) => r.fixes.length > 0).length;
      toast.success(
        `IA encontrou ${aiRows.length} cliente(s)${fixed ? ` • ${fixed} com correções automáticas` : ""}`,
      );
    } catch (err) {
      if (requestId !== aiRequestIdRef.current) return;
      const msg = err instanceof Error ? err.message : "Falha ao analisar com IA";
      toast.error("Não foi possível analisar a lista", { description: msg });
    } finally {
      if (requestId === aiRequestIdRef.current) setAiLoading(false);
    }
  };

  const summary = useMemo(() => {
    if (!rows) return { ok: 0, err: 0, newC: 0, foundC: 0, ready: 0, mgmv: 0, common: 0, addProduct: 0, duplicate: 0 };
    return {
      ok: rows.filter((r) => r.result === "Pronto").length,
      err: rows.filter((r) => r.result === "Erro").length,
      newC: rows.filter((r) => !r.clientFound && r.result === "Pronto").length,
      foundC: rows.filter((r) => r.clientFound).length,
      ready: rows.filter((r) => r.result === "Pronto").length,
      mgmv: rows.filter((r) => r.clientCategory === "mgmv").length,
      common: rows.filter((r) => r.clientCategory === "common").length,
      addProduct: rows.filter((r) => r.productAction === "add_to_existing_client").length,
      duplicate: rows.filter((r) => r.productAction === "duplicate_product").length,
    };
  }, [rows]);

  const confirmImport = async () => {
    if (!rows) return;
    const ready = rows.filter((r) => r.result === "Pronto");
    if (ready.length === 0) return toast.error("Nenhuma linha válida.");
    setConfirming(true);
    const toastId = toast.loading(`Importando ${ready.length} registro(s)...`);
    try {
      let createdClients = 0;
      let promotedMgmv = 0;
      let addedToExisting = 0;
      const affectedClientIds = new Set<string>();
      const productsBefore = useStore.getState().products.length;
      ready.forEach((r) => {
      let client = findClientByPhone(r.phone);
      if (!client) {
        // Novo cliente — já classifica como MGMV se a linha for MGMV, para
        // aparecer imediatamente na seção MGMV (mesma regra de Clientes/Cobrança).
        client = addClient({
          name: r.name,
          phone: r.phone,
          ...(r.clientCategory === "mgmv" ? { clientType: "mgmv" as const } : {}),
        });
        createdClients++;
      } else {
        addedToExisting++;
        // Cliente existente: sincroniza clientType para MGMV quando necessário
        // (mesma condição usada em Clientes/MGMV/Cobrança). Não sobrescreve
        // um cliente MGMV para "common".
        if (r.clientCategory === "mgmv" && client.clientType !== "mgmv") {
          updateClient(client.id, { clientType: "mgmv" });
          promotedMgmv++;
        }
      }
      affectedClientIds.add(client.id);
      const total = r.totalValue ?? 0;
      const regISO = r.registerDate ?? new Date().toISOString();
      const paid = r.paidValue ?? (r.financialStatus === "Pago" ? total : 0);
      const finalStatus: FinancialStatus =
        r.financialStatus === "MGMV"
          ? "MGMV"
          : calculateFinancialStatus(total, paid);
      const dueISO =
        finalStatus === "Reserva"
          ? calculateReservaDueDate(regISO)
          : r.dueDate ?? calculateDueDateForStatus(finalStatus, regISO);
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
      const importSource = tab === "csv" ? "CSV" : tab === "excel" ? "Excel" : "Texto";
      const fileHash = await sha1Hex(JSON.stringify(ready));
      addImportHistory({
      source: importSource,
      file: importSource === "Texto" ? "importacao-manual.txt" : `importacao-${tab}`,
      clientsCreated: createdClients,
      productsAdded: ready.length,
      errors: rows.length - ready.length,
      status: rows.length - ready.length > 0 ? "Com avisos" : "Concluído",
      fileHash,
      rawContent: importSource === "Texto" ? text : undefined,
      });
      const savedHistory = useStore.getState().importHistory[0];
      if (savedHistory) {
      // Sincroniza APENAS os registros afetados por esta confirmação —
      // evita reenviar toda a base (que estava causando dezenas de POSTs
      // sequenciais e travando a UI por vários segundos).
      const state = useStore.getState();
      const affectedClients = state.clients.filter((c) => affectedClientIds.has(c.id));
      const affectedProducts = state.products.slice(productsBefore);
      await persistConfirmedImport({
        clients: affectedClients,
        products: affectedProducts,
        history: savedHistory,
      });
      }
      toast.success(
        `${ready.length} registro(s) importados • ${createdClients} cliente(s) novos • ${addedToExisting} produto(s) adicionados a clientes existentes${promotedMgmv ? ` • ${promotedMgmv} promovido(s) a MGMV` : ""} • ${rows.length - ready.length} erro(s) ignorados`,
        { id: toastId },
      );
      // Reprocesso automático de MGMV a partir das observações — evita
      // que o usuário precise clicar em "Reprocessar MGMV por observações"
      // após confirmar uma importação de lista/CSV/Excel.
      try {
        const { reprocessMGMVFromNotes } = await import("@/lib/mgmv-reprocess");
        const { updatedIds: updated } = reprocessMGMVFromNotes();
        if (updated.length > 0) {
          toast.success(`MGMV reprocessado automaticamente: ${updated.length} acordo(s) atualizado(s).`);
        }
      } catch (err) {
        console.warn("Reprocesso automático de MGMV falhou:", err);
      }
      setRows(null);
      setText("");
      onScrollTo("clientes");
    } catch (err) {
      toast.error(`Falha ao importar: ${(err as Error).message ?? "erro inesperado"}`, { id: toastId });
    } finally {
      setConfirming(false);
    }
  };

  const confirmNotionImport = async () => {
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
          ? p.financialStatus === "Reserva"
            ? calculateReservaDueDate(regISO)
            : new Date(`${p.dueDate}T12:00:00`).toISOString()
          : calculateDueDateForStatus(p.financialStatus, regISO);
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
    const fileHash = await sha1Hex(htmlText || JSON.stringify(notion));
    addImportHistory({
      source: "HTML Notion",
      file: "notion.html",
      clientsCreated: createdClients,
      productsAdded: totalProducts,
      errors: notion.errors.length,
      status: notion.errors.length > 0 ? "Com avisos" : "Concluído",
      fileHash,
      agreementsCreated: createdAgreements,
    });
    const savedHistory = useStore.getState().importHistory[0];
    if (savedHistory) {
      await persistConfirmedImport({
        clients: useStore.getState().clients,
        products: useStore.getState().products,
        history: savedHistory,
      });
    }
    toast.success(
      `${usableClients.length} cliente(s) • ${totalProducts} produto(s) • ${createdAgreements} acordo(s) MGMV • ${createdClients} novo(s)`,
    );
    // Reprocessa MGMV automaticamente após confirmar a importação Notion,
    // eliminando o passo manual do botão "Reprocessar MGMV por observações".
    try {
      const { reprocessMGMVFromNotes } = await import("@/lib/mgmv-reprocess");
      const { updatedIds: updated } = reprocessMGMVFromNotes();
      if (updated.length > 0) {
        toast.success(`MGMV reprocessado automaticamente: ${updated.length} acordo(s) atualizado(s).`);
      }
    } catch (err) {
      console.warn("Reprocesso automático de MGMV falhou:", err);
    }
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

  const hasPreview = !!rows || !!notion || !!zipData;
  const [importAccordion, setImportAccordion] = useState<string[]>(["import-mass"]);
  useEffect(() => {
    if (!hasPreview) return;
    setImportAccordion((prev) => (prev.includes("import-preview") ? prev : [...prev, "import-preview"]));
    if (typeof document === "undefined") return;
    // pequeno delay para o accordion abrir antes do scroll
    const t = window.setTimeout(() => {
      document.getElementById("import-preview-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [hasPreview]);

  return (
    <section id="import" className="one-page-section">
      <PageHeader
        title="Importação"
        description="Importe clientes e produtos em duas etapas: massa e preview. A validação assistida com IA já está integrada."
      />

      <Accordion
        type="multiple"
        value={importAccordion}
        onValueChange={(v) => setImportAccordion(v as string[])}
        className="space-y-3"
      >
        {/* Parte 0 — Importação exclusiva a partir de backup */}
        <AccordionItem
          value="import-backup"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
        >
          <AccordionTrigger className="px-4 py-3 text-left text-sm font-semibold hover:no-underline">
            <span className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                <FileArchive className="size-3.5" />
              </span>
              Importar de backup (ZIP)
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <BackupImportCard />
          </AccordionContent>
        </AccordionItem>

        {/* Parte 1 — Importação em massa */}
        <AccordionItem
          value="import-mass"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
        >
          <AccordionTrigger className="px-4 py-3 text-left text-sm font-semibold hover:no-underline">
            <span className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">1</span>
              Importação em massa
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3">
                <UploadArea
                  accept=".txt,.html,.htm,.csv,.xlsx,.xls,.zip"
                  onFile={(f) => {
                    const ext = f.name.toLowerCase().split(".").pop();
                    if (ext === "zip") void handleZipFile(f);
                    else void handleFile(f);
                  }}
                  hint="Arraste qualquer arquivo (lista, HTML, CSV, Excel ou ZIP) ou clique"
                />
                <Card title="Formato esperado">
                  <Collapsible defaultOpen={false}>
                    <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-2 text-left">
                      <div className="flex flex-wrap gap-3">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FileText className="size-4" /> Lista
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FileCode className="size-4" /> HTML / Notion
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FileSpreadsheet className="size-4" /> CSV / Excel
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FileArchive className="size-4" /> ZIP
                        </span>
                      </div>
                      <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid gap-2 pt-2 text-[11px]">
                        <div>
                          <span className="text-muted-foreground">Lista:</span>
                          <code className="block rounded-md bg-muted p-1.5">Nome - Telefone - Produto - Plataforma - Valor - Status</code>
                        </div>
                        <div>
                          <span className="text-muted-foreground">HTML / Notion:</span>
                          <code className="block rounded-md bg-muted p-1.5 leading-snug">Título "Nome - Telefone" + tabela Item/Plataforma/Valor/Pago/Status/Data/Situação.</code>
                        </div>
                        <div>
                          <span className="text-muted-foreground">CSV/Excel:</span>
                          <code className="block rounded-md bg-muted p-1.5 leading-snug">nome, telefone, produto, plataforma, valor_total, valor_pago, status_financeiro, situacao, data_cadastro, data_limite, observacoes</code>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-muted-foreground">Telefone é o ID. Status: Pago/Reserva/Pendente/MGMV.</span>
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => downloadModel("csv")}>CSV</Button>
                            <Button size="sm" variant="outline" onClick={() => downloadModel("xlsx")}>Excel</Button>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-foreground">Importar por lista (colar texto)</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const t = await navigator.clipboard.readText();
                          if (!t) { toast.info("Área de transferência vazia."); return; }
                          setText(t);
                          toast.success("Texto colado da área de transferência.");
                        } catch {
                          toast.error("Não foi possível acessar a área de transferência.");
                        }
                      }}
                    >
                      <ClipboardPaste className="size-4" /> Colar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!text.trim()}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(text);
                          toast.success("Lista copiada.");
                        } catch {
                          toast.error("Não foi possível copiar.");
                        }
                      }}
                    >
                      <ClipboardCopy className="size-4" /> Copiar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!text.trim()}
                      onClick={() => setText("")}
                    >
                      <Eraser className="size-4" /> Limpar
                    </Button>
                  </div>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"Cole aqui a lista, ex.:\nNome - Telefone - Produto - Plataforma - Valor - Status"}
                  className="min-h-[140px] w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    Use os botões acima para colar/copiar sem teclado. Ao validar, abrimos a Importação Assistida com IA em um modal dedicado.
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={validateText}
                      disabled={aiLoading || !text.trim()}
                      title="Analisa e mostra o preview aqui na sessão"
                    >
                      <Brain className="size-4" />
                      {aiLoading ? "Analisando..." : "Validar aqui"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (!text.trim()) { toast.error("Cole os dados antes de abrir o modal."); return; }
                        setAiListModal({ open: true, text });
                      }}
                      disabled={!text.trim()}
                      title="Abrir Importação Assistida com IA com o texto colado"
                    >
                      <Brain className="size-4" />
                      Importação Assistida com IA
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Parte 2 — Preview da importação */}
        <AccordionItem
          value="import-preview"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
        >
          <AccordionTrigger className="px-4 py-3 text-left text-sm font-semibold hover:no-underline">
            <span className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">2</span>
              Preview da importação
              {hasPreview && (
                <span className="ml-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  pronto para revisar
                </span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-6">
            <div id="import-preview-anchor" />
            {!hasPreview && (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhum preview no momento. Envie um arquivo ou cole uma lista na etapa 1 para começar.
              </div>
            )}

            {rows && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold">Preview da importação</h3>
                  <p className="text-xs text-muted-foreground">
                    Revise os registros analisados antes de confirmar. Você pode ajustar a origem na etapa 1 se algo estiver incorreto.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                  <SlimMetric label="Válidos" value={summary.ok} tone="success" />
                  <SlimMetric label="Com erro" value={summary.err} tone="danger" />
                  <SlimMetric label="Comum" value={summary.common} />
                  <SlimMetric label="MGMV" value={summary.mgmv} tone="primary" />
                  <SlimMetric label="+ ao cliente" value={summary.addProduct} />
                  <SlimMetric label="Duplicados" value={summary.duplicate} tone="danger" />
                </div>
                <div className="sticky top-0 z-10 flex flex-col-reverse gap-2 border-y border-border bg-background/95 py-3 backdrop-blur-sm sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={() => setRows(null)} disabled={confirming || importBusy} className="w-full sm:w-auto">
                    Cancelar
                  </Button>
                  <Button onClick={guardImport(confirmImport)} disabled={summary.ok === 0 || confirming || importBusy} className="w-full sm:w-auto">
                    {confirming ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>Confirmar Importação ({summary.ok})</>
                    )}
                  </Button>
                </div>
                <PreviewVirtualTable rows={rows} />
                {confirming && (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <ImportConveyor running state="processing" height="h-20" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Sincronizando com o banco…
                    </p>
                  </div>
                )}
                <div aria-live="polite" aria-atomic="true" className="sr-only">
                  {confirming
                    ? "Importando registros, aguarde..."
                    : `Pronto para importar. ${summary.ok} ${summary.ok === 1 ? "registro válido" : "registros válidos"}${summary.err ? `, ${summary.err} com erro` : ""}.`}
                </div>
              </div>
            )}

            {notion && (
              <div className="mt-4">
                <NotionPreview
                  result={notion}
                  findClientByPhone={findClientByPhone}
                  onConfirm={guardImport(confirmNotionImport)}
                  busy={importBusy}
                  onClear={() => { setNotion(null); setHtmlText(""); }}
                />
              </div>
            )}

            {zipData && (
              <div className="mt-4">
                <ZipPreview
                  data={zipData}
                  onClear={() => setZipData(null)}
                  onConfirm={guardImport(confirmZipImport)}
                  onToggleEntry={setEntrySelected}
                  onToggleProduct={setProductSelected}
                  onToggleAll={setAllEntriesSelected}
                  onToggleFolder={setFolderSelected}
                  onCorrectionAction={setCorrectionAction}
                  onMgmvAction={setMgmvAction}
                />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

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
        onResume={(file) => {
          // Fecha o aviso e dispara o mesmo fluxo de ZIP — duplicatas serão
          // detectadas pelo fileHash + dedup por cliente/produto/data.
          setImportProgress(null);
          void handleZipFile(file);
        }}
      />

      {/* Modal — Importação Assistida com IA (esteira + preview + confirmar) */}
      <ListImportModal
        open={aiListModal.open}
        onOpenChange={(o) => setAiListModal((prev) => ({ ...prev, open: o }))}
        initialText={aiListModal.text}
        autoAnalyze
      />

      {/* Modal de confirmação de saída — só aparece se o usuário tentar
          navegar para outra rota enquanto a importação está rodando. */}
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(o) => { if (!o && blocker.status === "blocked") blocker.reset(); }}
      >
        <DialogContent className="border-amber-500/50 bg-gradient-to-b from-amber-500/10 via-background to-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              ⚠️ Importação em andamento
            </DialogTitle>
            <DialogDescription>
              Sair desta tela agora vai <span className="font-medium text-foreground">interromper o processamento</span>.
              Os itens já importados ficam salvos no banco, e você poderá <span className="font-medium text-foreground">reenviar o mesmo ZIP</span> para retomar — duplicatas serão puladas automaticamente.
              <br /><br />
              Tem certeza que deseja sair?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => blocker.status === "blocked" && blocker.reset()}
            >
              Continuar importando
            </Button>
            <Button
              variant="destructive"
              onClick={() => blocker.status === "blocked" && blocker.proceed()}
            >
              Sair mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zipFailuresOpen} onOpenChange={setZipFailuresOpen}>
 <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {zipData?.parseFailures.length ?? 0} arquivo(s) não puderam ser lidos
            </DialogTitle>
            <DialogDescription>
              Os arquivos abaixo foram ignorados na importação. Os demais foram processados
              normalmente e estão na prévia.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border">
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

    </section>
  );
}

function UploadArea({ accept, onFile, hint, tall }: { accept: string; onFile: (f: File) => void; hint: string; tall?: boolean }) {
  // placeholder anchor for patch ordering below
  return _UploadAreaImpl({ accept, onFile, hint, tall });
}

function SlimMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "primary" | "success" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-[color:var(--success)]",
    danger: "text-destructive",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xs">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums leading-tight", toneClass)}>{value}</p>
    </div>
  );
}

type PreviewFilter =
  | "all"
  | "ready"
  | "error"
  | "pago"
  | "reserva"
  | "pendente"
  | "mgmv"
  | "common"
  | "new_client"
  | "add_product"
  | "duplicate"
  | "sit_open"
  | "sit_enviado"
  | "sit_retirado"
  | "sit_retirar"
  | "sit_removido"
  | "sit_desistiu"
  | "sit_abandonou"
  | "sit_resolvido";

function PreviewVirtualTable({ rows }: { rows: ParsedRow[] }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const ROW_HEIGHT = 52;
  const [query, setQuery] = usePersistedState<string>("import.preview.query", "");
  const [filter, setFilter] = usePersistedState<PreviewFilter>("import.preview.filter", "all");
  // Situação — seleção múltipla, persistida independente do filtro principal.
  const [situations, setSituations] = usePersistedState<string[]>(
    "import.preview.situations",
    [],
  );
  const situationSet = useMemo(() => new Set(situations), [situations]);

  const errorCount = useMemo(() => rows.filter((r) => r.result === "Erro").length, [rows]);
  const readyCount = rows.length - errorCount;

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "ready" && r.result !== "Pronto") return false;
      if (filter === "error" && r.result !== "Erro") return false;
      if (filter === "pago" && r.financialStatus !== "Pago") return false;
      if (filter === "reserva" && r.financialStatus !== "Reserva") return false;
      if (filter === "pendente" && r.financialStatus !== "Pendente") return false;
      if (filter === "mgmv" && r.clientCategory !== "mgmv") return false;
      if (filter === "common" && r.clientCategory !== "common") return false;
      if (filter === "new_client" && r.clientAction !== "create") return false;
      if (filter === "add_product" && r.productAction !== "add_to_existing_client") return false;
      if (filter === "duplicate" && r.productAction !== "duplicate_product") return false;
      if (situationSet.size > 0 && !situationSet.has(r.situation)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.product.toLowerCase().includes(q) ||
        r.platform.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter, situationSet]);

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const scrollToFirstError = () => {
    setFilter("all");
    setQuery("");
    setSituations([]);
    // Defer until filteredRows recomputes with all rows visible.
    requestAnimationFrame(() => {
      const idx = rows.findIndex((r) => r.result === "Erro");
      if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: "start" });
    });
  };

  const downloadErrorsCsv = () => {
    const invalid = rows.filter((r) => r.result === "Erro");
    if (invalid.length === 0) {
      toast.info("Nenhuma linha inválida para exportar.");
      return;
    }
    const csv = Papa.unparse({
      fields: [
        "linha",
        "nome",
        "telefone",
        "produto",
        "plataforma",
        "valor_total",
        "valor_pago",
        "status",
        "motivo_erro",
      ],
      data: invalid.map((r) => [
        r.line,
        r.name,
        r.phone,
        r.product,
        r.platform,
        r.totalValue ?? "",
        r.paidValue ?? "",
        r.financialStatus,
        r.errors.join("; "),
      ]),
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `importacao-linhas-invalidas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${invalid.length} ${invalid.length === 1 ? "linha exportada" : "linhas exportadas"}.`);
  };

  // Compact column layout that fits within the modal width without horizontal scroll.
  const gridCols =
    "grid-cols-[40px_minmax(110px,1.3fr)_110px_minmax(120px,1.4fr)_minmax(80px,0.9fr)_78px_78px_78px_82px_92px_minmax(120px,1.2fr)]";

  const filterChips: { id: PreviewFilter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "ready", label: "Prontos" },
    { id: "error", label: "Erros" },
    { id: "pago", label: "Pago" },
    { id: "reserva", label: "Reserva" },
    { id: "pendente", label: "Pendente" },
    { id: "mgmv", label: "MGMV" },
    { id: "common", label: "Comum" },
    { id: "new_client", label: "Novo cliente" },
    { id: "add_product", label: "+ ao cliente" },
    { id: "duplicate", label: "Duplicado" },
  ];

  // Contagem por Situação — buckets oficiais do situation-normalizer.
  const situationCounts = useMemo(() => {
    const counts: Record<string, number> = {
      "Em Aberto": 0,
      Enviado: 0,
      Retirado: 0,
      Retirar: 0,
      Removido: 0,
      Desistiu: 0,
      Abandonou: 0,
      Resolvido: 0,
    };
    for (const r of rows) {
      if (r.situation in counts) counts[r.situation]++;
    }
    return counts;
  }, [rows]);

  const situationChips: { label: string; key: string }[] = [
    { label: "Em Aberto", key: "Em Aberto" },
    { label: "Enviado", key: "Enviado" },
    { label: "Retirado", key: "Retirado" },
    { label: "Retirar", key: "Retirar" },
    { label: "Removido", key: "Removido" },
    { label: "Desistiu", key: "Desistiu" },
    { label: "Abandonou", key: "Abandonou" },
    { label: "Resolvido", key: "Resolvido" },
  ];

  const toggleSituation = (key: string) => {
    setSituations((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
    );
  };

  const hasAnyFilterActive =
    filter !== "all" || situations.length > 0 || query.trim().length > 0;

  const clearAllFilters = () => {
    setFilter("all");
    setSituations([]);
    setQuery("");
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-[color:var(--success)]">
            {readyCount} {readyCount === 1 ? "linha pronta" : "linhas prontas"}
          </span>
          <span className="text-muted-foreground">·</span>
          {errorCount > 0 ? (
            <button
              type="button"
              onClick={scrollToFirstError}
              className="inline-flex items-center gap-1 font-medium text-destructive underline-offset-2 hover:underline"
            >
              <AlertCircle className="size-3.5" />
              {errorCount} {errorCount === 1 ? "com erro" : "com erros"} — ir para a primeira
            </button>
          ) : (
            <span className="text-muted-foreground">Nenhum erro encontrado.</span>
          )}
        </div>
        {errorCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadErrorsCsv}
            className="h-7 gap-1 text-xs"
          >
            <Download className="size-3.5" />
            Baixar CSV de erros
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, telefone, produto..."
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {filterChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === c.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Situação {situations.length > 0 && `(${situations.length})`}:
        </span>
        {situationChips.map((c) => {
          const count = situationCounts[c.key] ?? 0;
          const active = situationSet.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleSituation(c.key)}
              disabled={count === 0}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              aria-pressed={active}
            >
              {c.label} <span className="tabular-nums opacity-70">({count})</span>
            </button>
          );
        })}
        <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
          Mostrando <span className="font-semibold text-foreground">{filteredRows.length}</span> de {rows.length}
        </span>
        {hasAnyFilterActive && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Limpar filtros
          </button>
        )}
      </div>
      <div className="flex h-[calc(95vh-200px)] min-h-[380px] flex-col overflow-hidden rounded-md border border-border">
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div className="flex min-w-[1020px] flex-1 min-h-0 flex-col">
            <div
              className={cn(
                "grid shrink-0 items-center gap-0 border-b border-border bg-muted/60 px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur",
                gridCols,
              )}
            >
              <div className="font-medium">#</div>
              <div className="font-medium">Nome</div>
              <div className="font-medium">Telefone</div>
              <div className="font-medium">Produto</div>
              <div className="font-medium">Plataforma</div>
              <div className="font-medium">Total</div>
              <div className="font-medium">Pago</div>
              <div className="font-medium">Restante</div>
              <div className="font-medium">Status</div>
              <div className="font-medium">Result.</div>
              <div className="font-medium">Aviso / Erro</div>
            </div>
            <div
              ref={parentRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
              role="rowgroup"
              aria-rowcount={filteredRows.length}
            >
          {filteredRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "Nenhuma linha para exibir." : "Nenhum resultado para o filtro."}
            </div>
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const r = filteredRows[vi.index];
                const aviso = r.errors.join("; ") || r.statusWarning || "";
                const isError = r.result === "Erro";
                const avisoTone = r.errors.length
                  ? "text-destructive"
                  : r.statusWarning
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground";
                return (
                  <div
                    key={vi.key}
                    role="row"
                    aria-rowindex={vi.index + 1}
                    className={cn(
                      "absolute left-0 top-0 grid w-full items-center border-b border-border/60 px-2 text-xs",
                      isError && "bg-destructive/10 border-l-2 border-l-destructive",
                      gridCols,
                    )}
                    style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                  >
                    <div className="text-muted-foreground tabular-nums">{r.line}</div>
                    <div className="truncate font-medium" title={r.name}>{r.name || "—"}</div>
                    <div className="truncate text-muted-foreground tabular-nums" title={r.phone}>{r.phone || "—"}</div>
                    <div className="truncate" title={r.product}>{r.product || "—"}</div>
                    <div className="truncate text-muted-foreground" title={r.platform}>{r.platform || "—"}</div>
                    <div className="tabular-nums">
                      {Number.isFinite(r.totalValue ?? NaN) ? formatBRL(r.totalValue!) : "—"}
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      {Number.isFinite(r.paidValue ?? NaN) ? formatBRL(r.paidValue!) : "—"}
                    </div>
                    <div className="tabular-nums">
                      {Number.isFinite(r.totalValue ?? NaN) && Number.isFinite(r.paidValue ?? NaN)
                        ? formatBRL(Math.max(0, (r.totalValue ?? 0) - (r.paidValue ?? 0)))
                        : "—"}
                    </div>
                    <div>
                      <Tag
                        variant={
                          r.financialStatus === "Pago"
                            ? "success"
                            : r.financialStatus === "Pendente"
                            ? "danger"
                            : "warning"
                        }
                      >
                        {r.financialStatus || "—"}
                      </Tag>
                    </div>
                    <div className="flex flex-col gap-0.5 leading-tight">
                      <Tag variant={r.result === "Pronto" ? "success" : "danger"}>{r.result}</Tag>
                      <div className="flex flex-wrap items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                        <span
                          className={cn(
                            "rounded px-1 py-px",
                            r.clientCategory === "mgmv"
                              ? "bg-primary/15 text-primary"
                              : "bg-muted",
                          )}
                          title={
                            r.clientCategory === "mgmv"
                              ? "Vai para a seção MGMV"
                              : "Cliente comum (Cobrança/Clientes)"
                          }
                        >
                          {r.clientCategory === "mgmv" ? "MGMV" : "Comum"}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1 py-px",
                            r.productAction === "duplicate_product"
                              ? "bg-destructive/15 text-destructive"
                              : r.productAction === "add_to_existing_client"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "bg-[color:var(--success)]/15 text-[color:var(--success)]",
                          )}
                          title={
                            r.productAction === "duplicate_product"
                              ? "Produto já existe para este cliente"
                              : r.productAction === "add_to_existing_client"
                              ? `Adicionar produto ao cliente existente${r.existingClientName ? ` (${r.existingClientName})` : ""}`
                              : "Novo cliente + produto"
                          }
                        >
                          {r.productAction === "duplicate_product"
                            ? "Duplicado"
                            : r.productAction === "add_to_existing_client"
                            ? "+Produto"
                            : "Novo"}
                        </span>
                      </div>
                    </div>
                    <div className={cn("truncate", avisoTone)} title={aviso}>
                      {aviso || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
            </div>
          </div>
        </div>
        <div className="border-t border-border bg-muted/30 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          {filteredRows.length} de {rows.length} {rows.length === 1 ? "linha" : "linhas"}
          {filter !== "all" || query ? " (filtrado)" : ""}
        </div>
      </div>
    </div>
  );
}

function _UploadAreaImpl({ accept, onFile, hint, tall }: { accept: string; onFile: (f: File) => void; hint: string; tall?: boolean }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={
        "flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center text-sm transition " +
        (tall ? "min-h-[320px] " : "min-h-40 ") +
        (drag ? "border-primary bg-primary/5" : "border-input bg-muted/30 hover:bg-muted/50")
      }
    >
      <p className="font-medium">{hint}</p>
      <p className="mt-1 text-xs text-muted-foreground">Aceita: {accept}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function NotionPreview({
  result,
  findClientByPhone,
  onConfirm,
  onClear,
  busy,
}: {
  result: NotionParseResult;
  findClientByPhone: (phone: string) => { id: string; name: string } | undefined;
  onConfirm: () => void;
  onClear: () => void;
  busy?: boolean;
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
        <Button variant="outline" onClick={onClear} disabled={busy}>Cancelar</Button>
        <Button onClick={onConfirm} disabled={!canConfirm || busy}>
          {busy ? "Importando..." : "Confirmar Importação"}
        </Button>
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
                        const isRemoved = p.situation === "Removido";
                        return (
                          <tr key={idx} className="border-b border-border/60 last:border-0">
                            <td className="py-3 pr-3">{p.product || "—"}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.platform || "—"}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(p.totalValue)}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(p.paidValue)}</td>
                            <td className="py-3 pr-3 tabular-nums">{formatBRL(p.remainingValue)}</td>
                            <td className="py-3 pr-3">
                              {isRemoved ? (
                                <Tag variant="danger">Removido</Tag>
                              ) : (
                                <Tag variant={p.financialStatus === "Pago" ? "success" : p.financialStatus === "Pendente" ? "danger" : "warning"}>{p.financialStatus}</Tag>
                              )}
                              {!isRemoved && p.statusWarning && p.originalFinancialStatus && p.originalFinancialStatus !== p.financialStatus && (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  original: <span className="line-through">{p.originalFinancialStatus}</span>
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-3 text-xs text-amber-600 dark:text-amber-400">{isRemoved ? "—" : (p.statusWarning ?? "—")}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.situation}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.registerDate ?? "—"}</td>
                            <td className="py-3 pr-3 text-muted-foreground">{p.dueDate ?? "—"}</td>
                            <td className="py-3 pr-3">
                              <Tag variant={isRemoved ? "danger" : ok ? "success" : "danger"}>
                                {isRemoved ? "Removido" : ok ? "Pronto" : "Erro"}
                              </Tag>
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

function CompareCommonVsMgmv({
  data,
  onFilter,
}: {
  data: ZipPreviewData;
  onFilter?: (key: ZipFilter) => void;
}) {
  const stats = useMemo(() => {
    let commonClients = 0;
    let mgmvClients = 0;
    let commonProducts = 0;
    let mgmvProducts = 0;
    let commonValue = 0;
    let mgmvValue = 0;
    let reviewPending = 0;
    let aiReviewed = 0;
    for (const e of data.entries) {
      if (e.criticalError) continue;
      const isMgmv = !!e.mgmv;
      if (isMgmv) {
        mgmvClients += 1;
        mgmvProducts += e.products.length;
        mgmvValue += e.products.reduce((s, p) => s + (p.totalValue || 0), 0);
        if (e.mgmvConflict && !e.mgmvAction) reviewPending += 1;
        // Heurística leve: se houver action aplicada e sem conflito, considera revisado.
        if (e.mgmvAction && !e.mgmvConflict) aiReviewed += 1;
      } else {
        commonClients += 1;
        commonProducts += e.products.length;
        commonValue += e.products.reduce((s, p) => s + (p.totalValue || 0), 0);
      }
    }
    const totalClients = commonClients + mgmvClients;
    const commonPct = totalClients > 0 ? Math.round((commonClients / totalClients) * 100) : 0;
    const mgmvPct = totalClients > 0 ? 100 - commonPct : 0;
    return {
      commonClients,
      mgmvClients,
      commonProducts,
      mgmvProducts,
      commonValue,
      mgmvValue,
      reviewPending,
      aiReviewed,
      commonPct,
      mgmvPct,
    };
  }, [data]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border-2 border-sky-500/30 bg-sky-500/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            Clientes comuns
          </div>
          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
            {stats.commonPct}%
          </span>
        </div>
        <ImportCardsGrid className="sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
          <ImportCard
            icon={Users}
            title="Clientes"
            value={stats.commonClients}
            tone="common"
            onClick={onFilter ? () => onFilter("novos") : undefined}
            tooltip="Ver clientes comuns detectados"
          />
          <ImportCard
            icon={Box}
            title="Produtos"
            value={stats.commonProducts}
            tone="common"
            onClick={onFilter ? () => onFilter("prontos") : undefined}
            tooltip="Ver produtos detectados"
          />
          <ImportCard icon={Wallet} title="Valor total" value={formatBRL(stats.commonValue)} tone="common" />
        </ImportCardsGrid>
      </div>
      <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/[0.04] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Clientes MGMV
          </div>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            {stats.mgmvPct}%
          </span>
        </div>
        <ImportCardsGrid className="sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
          <ImportCard
            icon={ShieldCheck}
            title="Acordos"
            value={stats.mgmvClients}
            tone="mgmv"
            onClick={onFilter ? () => onFilter("mgmv") : undefined}
            tooltip="Ver acordos MGMV detectados"
          />
          <ImportCard icon={Wallet} title="Dívida MGMV" value={formatBRL(stats.mgmvValue)} tone="mgmv" />
          <ImportCard
            icon={stats.reviewPending > 0 ? AlertOctagon : Brain}
            title={stats.reviewPending > 0 ? "Revisão necessária" : "Revisados c/ IA"}
            value={stats.reviewPending > 0 ? stats.reviewPending : stats.aiReviewed}
            tone={stats.reviewPending > 0 ? "danger" : "success"}
            onClick={onFilter ? () => onFilter("mgmv") : undefined}
            tooltip={stats.reviewPending > 0 ? "Ver registros que precisam de revisão" : "Ver registros revisados"}
          />
        </ImportCardsGrid>
      </div>
    </div>
  );
}

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

  // Todas as pastas iniciam minimizadas para reduzir a altura da onepage.
  // O usuário abre/fecha manualmente quantas quiser.
  const [openFolders, setOpenFolders] = useState<string[]>([]);

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

      {/* Comparativo Clientes comuns x Clientes MGMV */}
      <CompareCommonVsMgmv data={data} onFilter={setFilter} />

      {/* Métricas ordenadas por severidade: problemas primeiro, depois números frios. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <MetricCard
          label="Com erro"
          value={stats.errors}
          status={stats.errors > 0 ? "danger" : "default"}
          onClick={() => setFilter("erro")}
          tooltip="Ver registros com erro"
        />
        <MetricCard
          label="MGMV em conflito"
          value={stats.mgmvConflicts}
          status={stats.mgmvConflicts > 0 ? "danger" : "default"}
          onClick={() => setFilter("mgmv")}
          tooltip="Ver acordos MGMV em conflito"
        />
        <MetricCard
          label="Duplicatas"
          value={stats.duplicates}
          status={stats.duplicates > 0 ? "warning" : "default"}
          onClick={() => setFilter("duplicatas")}
          tooltip="Ver possíveis duplicatas"
        />
        <MetricCard
          label="Telefone corrigido"
          value={stats.phoneCorrected}
          status={stats.phoneCorrected > 0 ? "warning" : "default"}
          onClick={() => setFilter("telefoneCorrigido")}
          tooltip="Ver clientes com telefone corrigido"
        />
        <MetricCard
          label="Novos clientes"
          value={stats.newClients}
          status="success"
          onClick={() => setFilter("novos")}
          tooltip="Ver novos clientes detectados"
        />
        <MetricCard
          label="Existentes"
          value={stats.existing}
          onClick={() => setFilter("existentes")}
          tooltip="Ver clientes já existentes"
        />
        <MetricCard
          label="Produtos"
          value={stats.totalProducts}
          onClick={() => setFilter("prontos")}
          tooltip="Ver registros prontos"
        />
        <MetricCard
          label="Acordos MGMV"
          value={stats.mgmv}
          status={stats.mgmv > 0 ? "warning" : "default"}
          onClick={() => setFilter("mgmv")}
          tooltip="Ver acordos MGMV detectados"
        />
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
            <MetricCard
              label="Clientes em MGMV"
              value={mgmvTotals.clients}
              status="warning"
              onClick={() => setFilter("mgmv")}
              tooltip="Ver clientes em MGMV detectados"
            />
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
        <MetricCard
          label="Clientes detectados"
          value={data.entries.length}
          onClick={() => setFilter("todos")}
          tooltip="Ver todos os clientes detectados"
        />
        <MetricCard
          label="Status corrigido"
          value={stats.corrected}
          onClick={() => setFilter("statusCorrigido")}
          tooltip="Ver registros com status corrigido"
        />
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
        type="multiple"
        value={openFolders}
        onValueChange={(v) => setOpenFolders(v as string[])}
        className="space-y-4"
      >
        {visibleFolders.map(({ folder, entries: entriesInFolder, visible }) => {
          const allSel = entriesInFolder.every((e) => e.selected || e.criticalError);
          const isOpenFolder = openFolders.includes(folder);
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
                  <div className="max-h-[280px] overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
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

