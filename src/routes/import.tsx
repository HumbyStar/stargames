import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Card, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { formatBRL, useStore } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/import")({
  head: () => ({ meta: [{ title: "Importação — Star Games" }] }),
  component: ImportPage,
});

interface ParsedRow {
  date: string | null;
  name: string;
  phone: string;
  product: string;
  platform: string;
  value: string;
  status: string;
  clientFound: boolean;
  willCreateClient: boolean;
  result: "Pronto" | "Erro";
  errors: string[];
}

const VALID_STATUS = ["Pago", "Reserva", "Pendente", "MGMV"] as const;

const SAMPLE = `Itens 25/06/2026

João - 11 99999-9999 - GTA V - PS5 - 50 - Reserva
Pedro - 21 98888-8888 - Figure Goku - Colecionável - 80 - Pago
Carlos - 41 97777-7777 - PS2 Slim - PS2 - 300 - Pendente`;

function brDateToISO(br: string) {
  const [d, m, y] = br.split("/");
  return new Date(`${y}-${m}-${d}T12:00:00`).toISOString();
}

function ImportPage() {
  const navigate = useNavigate();
  const { findClientByPhone, addClient, addProduct } = useStore();
  const [text, setText] = useState(SAMPLE);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);

  const validate = () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error("Cole os dados para validar.");
      return;
    }
    const header = lines[0];
    const dateMatch = header.match(/(\d{2}\/\d{2}\/\d{4})/);
    const identifiedDate = dateMatch ? dateMatch[1] : null;
    const productLines = dateMatch ? lines.slice(1) : lines;

    const parsed: ParsedRow[] = productLines.map((line) => {
      const parts = line.split("-").map((s) => s.trim());
      const [name, phone, product, platform, value, status] = parts;
      const errors: string[] = [];
      if (!identifiedDate) errors.push("Data não identificada");
      if (!name) errors.push("Nome obrigatório");
      if (!phone || phone.replace(/\D/g, "").length < 10) errors.push("Telefone inválido");
      if (!product) errors.push("Produto sem nome");
      const valNum = Number((value ?? "").replace(",", "."));
      if (!value || !Number.isFinite(valNum)) errors.push("Valor inválido");
      if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number]))
        errors.push("Status inválido");
      const found = phone ? findClientByPhone(phone) : undefined;
      return {
        date: identifiedDate,
        name: name ?? "",
        phone: phone ?? "",
        product: product ?? "",
        platform: platform ?? "",
        value: value ?? "",
        status: status ?? "",
        clientFound: !!found,
        willCreateClient: !found,
        result: errors.length === 0 ? "Pronto" : "Erro",
        errors,
      };
    });
    setRows(parsed);
    toast.success(`${parsed.length} linha(s) processadas`);
  };

  const summary = useMemo(() => {
    if (!rows) return { ok: 0, err: 0, newC: 0, foundC: 0 };
    return {
      ok: rows.filter((r) => r.result === "Pronto").length,
      err: rows.filter((r) => r.result === "Erro").length,
      newC: rows.filter((r) => r.willCreateClient && r.result === "Pronto").length,
      foundC: rows.filter((r) => r.clientFound).length,
    };
  }, [rows]);

  const confirmImport = () => {
    if (!rows) return;
    const ready = rows.filter((r) => r.result === "Pronto");
    if (ready.length === 0) return toast.error("Nenhuma linha válida.");
    ready.forEach((r) => {
      let client = findClientByPhone(r.phone);
      if (!client) {
        client = addClient({ name: r.name, phone: r.phone });
      }
      const valNum = Number(r.value.replace(",", "."));
      const regISO = r.date ? brDateToISO(r.date) : new Date().toISOString();
      const dueISO = new Date(new Date(regISO).getTime() + 7 * 86400000).toISOString();
      addProduct({
        clientId: client.id,
        name: r.product,
        platform: r.platform || "—",
        totalValue: valNum,
        paidValue: r.status === "Pago" ? valNum : 0,
        financialStatus: r.status as ParsedRow["status"] as "Pago" | "Reserva" | "Pendente" | "MGMV",
        situation: "Em Aberto",
        registerDate: regISO,
        dueDate: dueISO,
      });
    });
    toast.success(`${ready.length} registro(s) importados`);
    setRows(null);
    setText("");
    navigate({ to: "/collection" });
  };

  return (
    <AppLayout>
      <PageHeader
        title="Importação em Massa"
        description="Cole dados brutos para validar e importar novos registros."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Dados Brutos">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
          <div className="mt-3 flex justify-end">
            <Button onClick={validate}>Validar Importação</Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Instruções">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
              <li>Formato: Nome - Telefone - Produto - Plataforma - Valor - Status</li>
              <li>A data deve estar no cabeçalho.</li>
              <li>A data do cabeçalho vira a Data de Cadastro.</li>
              <li>O telefone localiza ou cria o cliente.</li>
              <li>Status: Pago, Reserva, Pendente, MGMV.</li>
            </ul>
          </Card>
          <Card title="Resumo da Validação">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Válidos</dt><dd className="text-lg font-semibold text-[color:var(--success)]">{summary.ok}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Erros</dt><dd className="text-lg font-semibold text-destructive">{summary.err}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Novos clientes</dt><dd className="text-lg font-semibold">{summary.newC}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Encontrados</dt><dd className="text-lg font-semibold">{summary.foundC}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      {rows && (
        <div className="mt-6">
          <Card
            title="Preview dos Dados"
            action={
              <Button onClick={confirmImport} disabled={summary.ok === 0}>
                Confirmar Importação
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                  {rows.map((r, idx) => {
                    const valNum = Number(r.value.replace(",", "."));
                    return (
                      <tr key={idx} className="border-b border-border/60 last:border-0">
                        <td className="py-3 pr-3 text-muted-foreground">{r.date ?? "—"}</td>
                        <td className="py-3 pr-3">{r.name}</td>
                        <td className="py-3 pr-3 text-muted-foreground">{r.phone}</td>
                        <td className="py-3 pr-3">{r.product}</td>
                        <td className="py-3 pr-3 text-muted-foreground">{r.platform}</td>
                        <td className="py-3 pr-3 tabular-nums">{Number.isFinite(valNum) ? formatBRL(valNum) : r.value}</td>
                        <td className="py-3 pr-3">
                          <Tag variant={r.status === "Pago" ? "success" : r.status === "Pendente" ? "danger" : "warning"}>{r.status || "—"}</Tag>
                        </td>
                        <td className="py-3 pr-3 text-muted-foreground">{r.clientFound ? "Encontrado" : "Será criado"}</td>
                        <td className="py-3 pr-3"><Tag variant={r.result === "Pronto" ? "success" : "danger"}>{r.result}</Tag></td>
                        <td className="py-3 pr-3 text-destructive">{r.errors.join("; ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}