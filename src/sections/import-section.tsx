import { Fragment, useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  client: { name: string; phone: string; phoneDisplay: string };
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
  const parts = s.trim().split("/");
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
};

const calculateDueDate = (status: FinancialStatus, registerDate: string | null) => {
  if (!registerDate) return null;
  if (status === "Reserva") {
    const d = new Date(`${registerDate}T12:00:00`);
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  }
  return registerDate;
};

function extractClientFromTitle(title: string) {
  const parts = title.split(/\s+-\s+/);
  const name = parts[0]?.trim() || "";
  const phoneRaw = parts.slice(1).join(" - ").trim();
  return { name, phone: phoneRaw.replace(/\D/g, ""), phoneDisplay: phoneRaw };
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
  const totalMatch = notes.match(/TOTAL:\s*([\d.,]+)/i);
  const installmentsMatch = notes.match(/(\d+)\s*x\s*Parcelas?\s*de\s*([\d.,]+)/i);
  const firstPaymentMatch = notes.match(
    /1[ºo]?\s*Pagamento\s*[-–—>]+\s*(\d{2}\/\d{2}\/\d{4})/i,
  );
  if (!totalMatch || !installmentsMatch) return null;
  const totalDebt = normalizeMoney(totalMatch[1]);
  const count = Number(installmentsMatch[1]);
  const value = normalizeMoney(installmentsMatch[2]);
  if (!totalDebt || !count || !value) return null;
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
      paid: false,
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
    const financialStatus =
      originalStatus === "MGMV"
        ? "MGMV"
        : calculateFinancialStatus(totalValue, paidValue);
    let statusWarning: string | undefined;
    if (financialStatus !== originalStatus) {
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

function parseClientArticle(article: Element, index: number): NotionClientBlock {
  const errors: string[] = [];
  const title =
    article.querySelector(".page-title")?.textContent?.trim() ||
    article.querySelector("h1")?.textContent?.trim() ||
    "";
  const client = extractClientFromTitle(title);
  if (!client.name) errors.push(`Cliente #${index}: nome não encontrado.`);
  if (!client.phone) errors.push(`Cliente #${index}: telefone não encontrado.`);
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

function parseNotionHtml(html: string): NotionParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const errors: string[] = [];
  let articles = Array.from(doc.querySelectorAll("article.page"));
  if (articles.length === 0) {
    // fallback: treat the whole body as a single client article
    if (doc.body) articles = [doc.body as unknown as Element];
  }
  const clients = articles.map((a, i) => parseClientArticle(a, i + 1));
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
  selected: boolean;
}

interface ZipClientPreview {
  id: string;
  folderName: string;
  fileName: string;
  fullPath: string;
  client: { name: string; phone: string; phoneDisplay: string };
  products: ZipProductPreview[];
  notes: string;
  mgmv: MGMVAgreement | null;
  existingClient: Client | undefined;
  errors: string[];
  criticalError: boolean;
  selected: boolean;
}

interface ZipPreviewData {
  folders: Set<string>;
  files: number;
  entries: ZipClientPreview[];
  globalErrors: string[];
  zipName: string;
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
  | "statusCorrigido";

// =============================================================

const normalizePhone = (p: string) => String(p ?? "").replace(/\D/g, "");
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
    addProduct,
    openClient,
    updateClientNotes,
    setMGMVAgreement,
    addImportHistory,
  } = useStore();
  const products = useStore((s) => s.products);
  const clients = useStore((s) => s.clients);
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(SAMPLE_LIST);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [notion, setNotion] = useState<NotionParseResult | null>(null);
  const [htmlText, setHtmlText] = useState("");
  const [zipData, setZipData] = useState<ZipPreviewData | null>(null);
  const [zipProcessing, setZipProcessing] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  const handleZipFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return toast.error("Envie um arquivo .zip");
    }
    setZipProcessing(true);
    setZipData(null);
    setZipProgress({ done: 0, total: 0 });
    try {
      const { default: JSZip } = await import("jszip");
      let zip;
      try {
        zip = await JSZip.loadAsync(file);
      } catch (err) {
        console.error("JSZip load error", err);
        toast.error("Não foi possível abrir o ZIP. O arquivo pode estar corrompido ou protegido por senha.");
        return;
      }
      const htmlFiles: ZipFileEntry[] = [];
      const folders = new Set<string>();
      const globalErrors: string[] = [];
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
      setZipProgress({ done: 0, total: rawEntries.length });
      // Extract in chunks of 25 so the UI stays responsive on big archives.
      const CHUNK = 25;
      for (let i = 0; i < rawEntries.length; i += CHUNK) {
        const slice = rawEntries.slice(i, i + CHUNK);
        await Promise.all(
          slice.map(async (r) => {
            try {
              const content = await r.entry.async("string");
              htmlFiles.push({
                folderName: r.folderName,
                fileName: r.fileName,
                fullPath: r.path,
                htmlContent: content,
              });
            } catch (err) {
              console.error("Falha ao ler", r.path, err);
              globalErrors.push(`Falha ao ler ${r.path}.`);
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
            parsed = parseNotionHtml(file.htmlContent);
          } catch (err) {
            console.error("parseNotionHtml falhou em", file.fullPath, err);
            globalErrors.push(`Erro ao interpretar ${file.fullPath}.`);
            return;
          }
          parsed.clients.forEach((block, blockIdx) => {
            const tempId = `zip-${fileIdx}-${blockIdx}-${Math.random().toString(36).slice(2, 8)}`;
            const existingClient = block.client.phone ? clientByPhone.get(block.client.phone) : undefined;
            const errors = [...block.errors];
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
              return {
                ...p,
                tempId: `${tempId}-p${pIdx}`,
                duplicate: dup,
                selected: true,
              };
            });
            const mgmv = extractMGMVAgreementFromNotes(block.notes);
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
        zipName: file.name,
      });
      toast.success(
        `${entries.length} cliente(s) lidos de ${htmlFiles.length} arquivo(s) em ${folders.size} pasta(s).`,
      );
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

  const confirmZipImport = () => {
    if (!zipData) return;
    const todayISO = new Date().toISOString();
    let createdClients = 0;
    let updatedClients = 0;
    let createdProducts = 0;
    let createdAgreements = 0;
    let ignoredDuplicates = 0;
    let errorEntries = 0;
    zipData.entries.forEach((entry) => {
      if (!entry.selected || entry.criticalError) {
        if (entry.criticalError) errorEntries++;
        return;
      }
      let client = findClientByPhone(entry.client.phone);
      if (!client) {
        client = addClient({
          name: entry.client.name,
          phone: entry.client.phoneDisplay || entry.client.phone,
        });
        createdClients++;
      } else {
        updatedClients++;
      }
      entry.products.forEach((p) => {
        if (!p.selected || p.errors.length > 0 || !p.product) return;
        if (p.duplicate) {
          ignoredDuplicates++;
          return;
        }
        const regISO = p.registerDate
          ? new Date(`${p.registerDate}T12:00:00`).toISOString()
          : todayISO;
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
        createdProducts++;
      });
      if (entry.notes) {
        const existing = client!.notes ? client!.notes + "\n\n" : "";
        updateClientNotes(client!.id, existing + entry.notes);
      }
      if (entry.mgmv) {
        setMGMVAgreement(client!.id, entry.mgmv);
        createdAgreements++;
      }
    });
    addImportHistory({
      source: "HTML Notion",
      file: zipData.zipName,
      clientsCreated: createdClients,
      productsAdded: createdProducts,
      errors: errorEntries,
      status: errorEntries > 0 ? "Com avisos" : "Concluído",
    });
    toast.success(
      `ZIP importado: ${createdClients} novo(s) • ${updatedClients} atualizado(s) • ${createdProducts} produto(s) • ${createdAgreements} MGMV • ${ignoredDuplicates} duplicata(s) ignorada(s)`,
    );
    setZipData(null);
    onScrollTo("clientes");
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
        />
      )}

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
}: {
  data: ZipPreviewData;
  onClear: () => void;
  onConfirm: () => void;
  onToggleEntry: (id: string, selected: boolean) => void;
  onToggleProduct: (entryId: string, productId: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onToggleFolder: (folder: string, selected: boolean) => void;
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
    const errors = data.entries.filter((e) => e.criticalError).length;
    const corrected = data.entries.reduce(
      (s, e) => s + e.products.filter((p) => p.statusWarning).length,
      0,
    );
    return { totalProducts, newClients, existing, duplicates, mgmv, errors, corrected };
  }, [data]);

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
  ];

  return (
    <div className="mt-6 space-y-4">
      {data.globalErrors.length > 0 && (
        <Card>
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {data.globalErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <MetricCard label="Pastas" value={data.folders.size} status="primary" />
        <MetricCard label="Arquivos HTML" value={data.files} />
        <MetricCard label="Clientes detectados" value={data.entries.length} />
        <MetricCard label="Produtos" value={stats.totalProducts} />
        <MetricCard label="Novos clientes" value={stats.newClients} status="success" />
        <MetricCard label="Existentes" value={stats.existing} />
        <MetricCard label="MGMV" value={stats.mgmv} status={stats.mgmv > 0 ? "warning" : "default"} />
        <MetricCard label="Duplicatas" value={stats.duplicates} status={stats.duplicates > 0 ? "warning" : "default"} />
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

      <div className="space-y-4">
        {byFolder.map(([folder, entriesInFolder]) => {
          const visible = entriesInFolder.filter((e) => filteredIds.has(e.id));
          if (visible.length === 0) return null;
          const allSel = entriesInFolder.every((e) => e.selected || e.criticalError);
          return (
            <Card
              key={folder}
              title={`${folder} • ${visible.length} cliente(s)`}
              action={
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleFolder(folder, !allSel)}
                  >
                    {allSel ? "Desmarcar pasta" : "Selecionar pasta"}
                  </Button>
                </div>
              }
            >
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
                                                <Tag variant="warning">Duplicata</Tag>
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
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

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