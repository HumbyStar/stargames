import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatBRL, useStore, type FinancialStatus, type Situation } from "@/lib/store";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/import")({
  head: () => ({ meta: [{ title: "Importação — Star Games" }] }),
  component: ImportPage,
});

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
  situation: Situation;
  registerDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  errors: string[];
  warnings: string[];
}

interface NotionParseResult {
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

function extractNotesAfterTable(doc: Document): string {
  const text = doc.body?.textContent || "";
  const notes: string[] = [];
  const totalMatch = text.match(/TOTAL:[\s\S]*/i);
  if (totalMatch) notes.push(totalMatch[0].trim());
  return notes.join("\n");
}

function parseNotionHtml(html: string): NotionParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const errors: string[] = [];

  const title =
    doc.querySelector(".page-title")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector("title")?.textContent?.trim() ||
    "";

  const client = extractClientFromTitle(title);
  if (!client.name) errors.push("Nome do cliente não encontrado no HTML.");
  if (!client.phone) errors.push("Telefone do cliente não encontrado no HTML.");

  const table =
    doc.querySelector("table.simple-table") || doc.querySelector("table");

  if (!table) {
    errors.push("Tabela de produtos não encontrada no HTML.");
    return { client, products: [], notes: extractNotesAfterTable(doc), errors };
  }

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
    const financialStatus = normalizeStatusBR(status ?? "");
    if (!status) rowWarnings.push('Status vazio (usado "Pendente").');
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
      situation: situationN,
      registerDate,
      dueDate,
      errors: rowErrors,
      warnings: rowWarnings,
    });
  });

  return { client, products, notes: extractNotesAfterTable(doc), errors };
}

// =================================================================

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
    if (!VALID_STATUS.includes(r.financialStatus as (typeof VALID_STATUS)[number])) errors.push("Status inválido");
    if (r.situation && !VALID_SITUATION.includes(r.situation as (typeof VALID_SITUATION)[number])) errors.push("Situação inválida");
    const found = phoneDigits ? findClientByPhone(phoneDigits) : undefined;
    return {
      ...r,
      phone: phoneDigits,
      clientFound: !!found,
      result: errors.length === 0 ? "Pronto" : "Erro",
      errors,
    };
  });
}

function ImportPage() {
  const navigate = useNavigate();
  const { findClientByPhone, addClient, addProduct, updateClientNotes } = useStore();
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(SAMPLE_LIST);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [notion, setNotion] = useState<NotionParseResult | null>(null);
  const [htmlText, setHtmlText] = useState("");

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
      else toast.success(`${result.products.length} produto(s) extraído(s)`);
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
      addProduct({
        clientId: client.id,
        name: r.product,
        platform: r.platform || "—",
        totalValue: total,
        paidValue: paid,
        financialStatus: r.financialStatus as FinancialStatus,
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
    navigate({ to: "/clientes" });
  };

  const confirmNotionImport = () => {
    if (!notion) return;
    if (notion.errors.length) return toast.error(notion.errors[0]);
    const validProducts = notion.products.filter((p) => p.product && p.errors.length === 0);
    if (validProducts.length === 0) return toast.error("Nenhum produto válido para importar.");
    let client = findClientByPhone(notion.client.phone);
    let created = false;
    if (!client) {
      client = addClient({ name: notion.client.name, phone: notion.client.phoneDisplay || notion.client.phone });
      created = true;
    }
    const todayISO = new Date().toISOString();
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
    });
    if (notion.notes) {
      const existing = client!.notes ? client!.notes + "\n\n" : "";
      updateClientNotes(client!.id, existing + notion.notes);
    }
    toast.success(
      `${validProducts.length} produto(s) importados • ${created ? "cliente criado" : "cliente atualizado"}${notion.notes ? " • observações salvas" : ""}`,
    );
    setNotion(null);
    setHtmlText("");
    navigate({ to: "/clientes" });
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
    <AppLayout>
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
                      else toast.success(`${result.products.length} produto(s) extraído(s)`);
                    }}
                  >
                    Validar HTML
                  </Button>
                </div>
              </details>
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
          existingClient={findClientByPhone(notion.client.phone)}
          onConfirm={confirmNotionImport}
          onClear={() => { setNotion(null); setHtmlText(""); }}
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
    </AppLayout>
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