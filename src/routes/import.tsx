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
  const { findClientByPhone, addClient, addProduct } = useStore();
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(SAMPLE_LIST);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);

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
    } else if (ext === "xlsx" || ext === "xls") {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = validateRows(parseTabular(json), findClientByPhone);
      setRows(parsed);
      toast.success(`${parsed.length} linha(s) processadas`);
    } else if (ext === "html" || ext === "htm") {
      const txt = await file.text();
      const parsed = validateRows(parseHTMLList(txt), findClientByPhone);
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

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="text">Lista / HTML</TabsTrigger>
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="excel">Excel</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-4 space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Cole sua lista ou HTML aqui..."
                className="min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
              <div className="flex justify-end">
                <Button onClick={validateText}>Validar Importação</Button>
              </div>
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