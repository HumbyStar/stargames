import { useMemo, useState } from "react";
import { MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  formatBRL,
  formatDateBR,
  isOverdue,
  useStore,
  type Client,
  type MGMVAgreement,
  type MGMVInstallment,
} from "@/lib/store";
import { MgmvAiReviewModal } from "@/components/mgmv-ai-review-modal";
import type { MgmvAiReviewSuggestion } from "@/lib/mgmv-ai-review.functions";

type MgmvChip =
  | "todos"
  | "ativos"
  | "em_atraso"
  | "quitados"
  | "revisao"
  | "vencem_hoje"
  | "vencidos";

interface MgmvRow {
  client: Client;
  agreement: MGMVAgreement;
  total: number;
  paidCount: number;
  pendingCount: number;
  paidValue: number;
  remainingValue: number;
  nextDue: string | null;
  status: "Ativo" | "Em atraso" | "Quitado" | "Revisão necessária";
}

function isSameDay(iso: string): boolean {
  const d = new Date(iso);
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
}

function buildRow(client: Client, agreement: MGMVAgreement): MgmvRow {
  const total = agreement.installments.length;
  const paidCount = agreement.installments.filter((i) => i.paid).length;
  const pendingCount = total - paidCount;
  const paidValue = agreement.installments
    .filter((i) => i.paid)
    .reduce((s, i) => s + (i.value || 0), 0);
  const remainingValue = Math.max(0, (agreement.totalDebt || 0) - paidValue);
  const next = agreement.installments
    .filter((i) => !i.paid)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  const nextDue = next?.dueDate ?? null;

  // Validação matemática — base para "Revisão necessária".
  const sumByInstallments = agreement.installments.reduce(
    (s, i) => s + (i.value || 0),
    0,
  );
  const mismatch =
    agreement.totalDebt > 0 &&
    Math.abs(sumByInstallments - agreement.totalDebt) > 0.01;

  let status: MgmvRow["status"] = "Ativo";
  if (mismatch) status = "Revisão necessária";
  else if (pendingCount === 0) status = "Quitado";
  else if (
    agreement.installments.some((i) => !i.paid && isOverdue(i.dueDate))
  ) {
    status = "Em atraso";
  }

  return {
    client,
    agreement,
    total,
    paidCount,
    pendingCount,
    paidValue,
    remainingValue,
    nextDue,
    status,
  };
}

export function MGMVSection({
  onScrollTo,
}: {
  onScrollTo: (id: string) => void;
}) {
  const { clients, products, openClient, payMGMVInstallment, setMGMVAgreement } =
    useStore();
  const [chip, setChip] = useState<MgmvChip>("todos");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiTarget, setAiTarget] = useState<string | null>(null);

  const rows = useMemo<MgmvRow[]>(() => {
    const list: MgmvRow[] = [];
    for (const c of clients) {
      const isMgmv =
        c.clientType === "mgmv" || (!!c.mgmv && c.mgmv.installments.length > 0);
      if (!isMgmv || !c.mgmv) continue;
      list.push(buildRow(c, c.mgmv));
    }
    return list.sort((a, b) =>
      a.client.name.localeCompare(b.client.name, "pt-BR"),
    );
  }, [clients]);

  const stats = useMemo(() => {
    const ativos = rows.filter((r) => r.status === "Ativo").length;
    const atraso = rows.filter((r) => r.status === "Em atraso").length;
    const quitados = rows.filter((r) => r.status === "Quitado").length;
    const revisao = rows.filter((r) => r.status === "Revisão necessária").length;
    const parcelasVencidas = rows.reduce(
      (s, r) =>
        s +
        r.agreement.installments.filter((i) => !i.paid && isOverdue(i.dueDate))
          .length,
      0,
    );
    const saldoTotal = rows.reduce((s, r) => s + r.remainingValue, 0);
    return {
      clientes: rows.length,
      ativos,
      atraso,
      quitados,
      revisao,
      parcelasVencidas,
      saldoTotal,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hit =
          r.client.name.toLowerCase().includes(q) ||
          r.client.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""));
        if (!hit) return false;
      }
      switch (chip) {
        case "ativos":
          return r.status === "Ativo";
        case "em_atraso":
          return r.status === "Em atraso";
        case "quitados":
          return r.status === "Quitado";
        case "revisao":
          return r.status === "Revisão necessária";
        case "vencem_hoje":
          return r.nextDue ? isSameDay(r.nextDue) : false;
        case "vencidos":
          return r.agreement.installments.some(
            (i) => !i.paid && isOverdue(i.dueDate),
          );
        default:
          return true;
      }
    });
  }, [rows, search, chip]);

  const chips: { id: MgmvChip; label: string; count?: number }[] = [
    { id: "todos", label: "Todos", count: stats.clientes },
    { id: "ativos", label: "Ativos", count: stats.ativos },
    { id: "em_atraso", label: "Em atraso", count: stats.atraso },
    { id: "quitados", label: "Quitados", count: stats.quitados },
    { id: "revisao", label: "Revisão necessária", count: stats.revisao },
    { id: "vencem_hoje", label: "Vencem hoje" },
    { id: "vencidos", label: "Vencidos" },
  ];

  return (
    <section
      id="mgmv"
      data-tour="mgmv-section"
      className="one-page-section"
    >
      <PageHeader
        title="MGMV"
        description="Controle acordos MGMV, parcelas, vencimentos, saldos e clientes agrupados."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
        <MetricCard label="Clientes MGMV" value={stats.clientes} status="primary" />
        <MetricCard label="Acordos ativos" value={stats.ativos} />
        <MetricCard
          label="Em atraso"
          value={stats.atraso}
          status={stats.atraso > 0 ? "danger" : "default"}
        />
        <MetricCard
          label="Parcelas vencidas"
          value={stats.parcelasVencidas}
          status={stats.parcelasVencidas > 0 ? "danger" : "default"}
        />
        <MetricCard label="Quitados" value={stats.quitados} status="success" />
        <MetricCard
          label="Revisão necessária"
          value={stats.revisao}
          status={stats.revisao > 0 ? "warning" : "default"}
        />
        <MetricCard label="Saldo total" value={formatBRL(stats.saldoTotal)} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente, telefone…"
          className="h-9 w-full max-w-xs rounded-full border border-border bg-background/60 px-4 text-sm outline-none transition focus:border-primary/40"
        />
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                chip === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
              }`}
            >
              {c.label}
              {typeof c.count === "number" && (
                <span className="ml-1 opacity-70">({c.count})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Telefone</th>
                <th className="px-3 py-2">Valor acordo</th>
                <th className="px-3 py-2">Parcelas</th>
                <th className="px-3 py-2">Pagas</th>
                <th className="px-3 py-2">Restante</th>
                <th className="px-3 py-2">Próximo vencimento</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum acordo MGMV encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isOpen = expanded === r.client.id;
                const productsOfClient = products.filter(
                  (p) => p.clientId === r.client.id,
                );
                const tagVariant: "danger" | "warning" | "success" | "primary" | "neutral" =
                  r.status === "Em atraso"
                    ? "danger"
                    : r.status === "Revisão necessária"
                      ? "warning"
                      : r.status === "Quitado"
                        ? "success"
                        : "primary";
                return (
                  <>
                    <tr
                      key={r.client.id}
                      className="border-b transition-colors hover:bg-accent/50"
                    >
                      <td className="px-3 py-2 font-medium">{r.client.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.client.phone}
                      </td>
                      <td className="px-3 py-2">
                        {formatBRL(r.agreement.totalDebt)}
                      </td>
                      <td className="px-3 py-2">
                        {r.total}× {formatBRL(r.agreement.installments[0]?.value ?? 0)}
                      </td>
                      <td className="px-3 py-2">
                        {r.paidCount}/{r.total}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {formatBRL(r.remainingValue)}
                      </td>
                      <td className="px-3 py-2">
                        {r.nextDue ? (
                          <span
                            className={
                              isOverdue(r.nextDue)
                                ? "text-destructive"
                                : ""
                            }
                          >
                            {formatDateBR(r.nextDue)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Tag variant={tagVariant}>{r.status}</Tag>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExpanded(isOpen ? null : r.client.id)
                            }
                          >
                            {isOpen ? "Fechar" : "Detalhes"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              openClient(r.client.id);
                              onScrollTo("clientes");
                            }}
                          >
                            Abrir
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.client.id}-detail`} className="border-b bg-accent/20">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                                Parcelas
                              </div>
                              <div className="space-y-1">
                                {r.agreement.installments.map((i) => {
                                  const isLate = !i.paid && isOverdue(i.dueDate);
                                  return (
                                    <div
                                      key={i.number}
                                      className="flex items-center justify-between rounded-md border border-border/60 bg-card px-2 py-1 text-xs"
                                    >
                                      <span className="font-medium">
                                        #{i.number}/{i.total}
                                      </span>
                                      <span>{formatBRL(i.value)}</span>
                                      <span
                                        className={
                                          isLate
                                            ? "text-destructive"
                                            : "text-muted-foreground"
                                        }
                                      >
                                        {formatDateBR(i.dueDate)}
                                      </span>
                                      <span>
                                        {i.paid ? (
                                          <Tag variant="success">Paga</Tag>
                                        ) : isLate ? (
                                          <Tag variant="danger">Vencida</Tag>
                                        ) : (
                                          <Tag variant="neutral">Pendente</Tag>
                                        )}
                                      </span>
                                      {!i.paid && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            payMGMVInstallment(r.client.id, i.number)
                                          }
                                        >
                                          Marcar paga
                                        </Button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                                Produtos incluídos ({productsOfClient.length})
                              </div>
                              <div className="space-y-1 text-xs">
                                {productsOfClient.length === 0 && (
                                  <p className="text-muted-foreground">
                                    Nenhum produto vinculado.
                                  </p>
                                )}
                                {productsOfClient.map((p) => (
                                  <div
                                    key={p.id}
                                    className="flex items-center justify-between rounded-md border border-border/60 bg-card px-2 py-1"
                                  >
                                    <span className="truncate font-medium">{p.name}</span>
                                    <span className="text-muted-foreground">{p.platform}</span>
                                    <span>{formatBRL(p.totalValue)}</span>
                                    <Tag variant="primary">Incluído no MGMV</Tag>
                                  </div>
                                ))}
                              </div>
                              {r.client.notes && (
                                <div className="mt-4">
                                  <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                    Observações originais
                                  </div>
                                  <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-card p-2 text-[11px] text-muted-foreground">
                                    {r.client.notes}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}