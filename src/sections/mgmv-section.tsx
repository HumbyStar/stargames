import { useEffect, useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  formatBRL,
  formatDateBR,
  isOverdue,
  useStore,
  type Client,
  type MGMVAgreement,
} from "@/lib/store";
import { MgmvAiReviewModal } from "@/components/mgmv-ai-review-modal";
import {
  ListExpansionToggle,
  MinimizedListCard,
} from "@/components/list-expansion";
import { useListExpansion } from "@/lib/list-expansion";
import type { MgmvAiReviewSuggestion } from "@/lib/mgmv-ai-review.functions";
import { applySuggestionToAgreement } from "@/lib/mgmv-ai-apply";
import { extractMGMVAgreementFromNotes } from "@/sections/import-section";
import { toast } from "sonner";
import { X } from "lucide-react";

type MgmvChip =
  | "todos"
  | "ativos"
  | "em_atraso"
  | "quitados"
  | "revisao"
  | "revisado_ia"
  | "revisado_manual"
  | "vencem_hoje"
  | "vencidos"
  | "com_produtos_externos";

interface MgmvRow {
  client: Client;
  agreement: MGMVAgreement;
  total: number;
  paidCount: number;
  pendingCount: number;
  paidValue: number;
  remainingValue: number;
  nextDue: string | null;
  /** Soma de pagamentos parciais em parcelas ainda pendentes. */
  partialPaidAmount: number;
  /** Status financeiro do acordo (separado do status de revisão). */
  status: "Ativo" | "Em atraso" | "Quitado";
  /** Status de revisão (independente do financeiro). */
  reviewStatus: NonNullable<MGMVAgreement["reviewStatus"]>;
  /** Indica divergência matemática entre soma das parcelas e total. */
  hasMismatch: boolean;
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
    .reduce((s, i) => s + (i.paidAmount ?? i.value ?? 0), 0);
  const partialPaidAmount = agreement.installments
    .filter((i) => !i.paid)
    .reduce(
      (s, i) => s + Math.max(0, Math.min(i.value, i.paidAmount ?? 0)),
      0,
    );
  const remainingValue = Math.max(
    0,
    (agreement.totalDebt || 0) - paidValue - partialPaidAmount,
  );
  const next = agreement.installments
    .filter((i) => !i.paid)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  const nextDue = next?.dueDate ?? null;

  // Validação matemática — base para reviewStatus = "review_required" quando
  // ainda não houve revisão IA / manual aplicada.
  const sumByInstallments = agreement.installments.reduce(
    (s, i) => s + (i.value || 0),
    0,
  );
  const hasMismatch =
    agreement.totalDebt > 0 &&
    Math.abs(sumByInstallments - agreement.totalDebt) > 0.01;

  let status: MgmvRow["status"] = "Ativo";
  if (pendingCount === 0) status = "Quitado";
  else if (agreement.installments.some((i) => !i.paid && isOverdue(i.dueDate))) {
    status = "Em atraso";
  }

  // reviewStatus: preserva ai_reviewed / manually_reviewed; senão deriva.
  const preserved =
    agreement.reviewStatus === "ai_reviewed" ||
    agreement.reviewStatus === "manually_reviewed"
      ? agreement.reviewStatus
      : null;
  const reviewStatus: MgmvRow["reviewStatus"] =
    preserved ?? (hasMismatch ? "review_required" : "none");

  return {
    client,
    agreement,
    total,
    paidCount,
    pendingCount,
    paidValue,
    remainingValue,
    nextDue,
    partialPaidAmount,
    status,
    reviewStatus,
    hasMismatch,
  };
}

export function MGMVSection({
  onScrollTo,
}: {
  onScrollTo: (id: string) => void;
}) {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);
  const payMGMVInstallment = useStore((s) => s.payMGMVInstallment);
  const setMGMVAgreement = useStore((s) => s.setMGMVAgreement);
  const applyAiReviewToAgreement = useStore((s) => s.applyAiReviewToAgreement);
  const [chip, setChip] = usePersistedState<MgmvChip>("mgmv.chip", "todos");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiTarget, setAiTarget] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const { expanded: listExpanded, expand: expandList } = useListExpansion("mgmv");

  /**
   * Aplica filtro a partir do clique em um card de resumo, mantendo o
   * contexto da seção MGMV. Garante que a lista esteja expandida e
   * limpa a busca livre para o usuário enxergar o subconjunto.
   */
  const applyCardFilter = (next: MgmvChip) => {
    setChip(next);
    setSearch("");
    if (!listExpanded) expandList();
  };

  const reprocessFromNotes = () => {
    setReprocessing(true);
    let updated = 0;
    let unchanged = 0;
    for (const c of clients) {
      if (!c.notes) continue;
      const parsed = extractMGMVAgreementFromNotes(c.notes);
      if (!parsed) continue;
      // Preserva startDate original quando já houver acordo
      const next: MGMVAgreement = {
        ...parsed,
        startDate: c.mgmv?.startDate ?? parsed.startDate,
      };
      // Mescla: se a parcela existente já estava paga e o parser não capturou
      // data, mantém a data de pagamento anterior.
      if (c.mgmv) {
        next.installments = next.installments.map((ni) => {
          const prev = c.mgmv!.installments.find((p) => p.number === ni.number);
          if (!prev) return ni;
          if (prev.paid && !ni.paid) {
            return { ...ni, paid: true, paidAt: prev.paidAt };
          }
          if (ni.paid && !ni.paidAt && prev.paidAt) {
            return { ...ni, paidAt: prev.paidAt };
          }
          return ni;
        });
      }
      setMGMVAgreement(c.id, next);
      updated++;
    }
    setReprocessing(false);
    unchanged = rows.length - updated;
    toast.success(
      `Reprocessamento concluído: ${updated} acordo(s) atualizado(s).` +
        (unchanged > 0 ? ` ${unchanged} sem mudanças.` : ""),
    );
  };

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
    const revisao = rows.filter((r) => r.reviewStatus === "review_required").length;
    const revisadoIA = rows.filter((r) => r.reviewStatus === "ai_reviewed").length;
    const revisadoManual = rows.filter(
      (r) => r.reviewStatus === "manually_reviewed",
    ).length;
    const parcelasVencidas = rows.reduce(
      (s, r) =>
        s +
        r.agreement.installments.filter((i) => !i.paid && isOverdue(i.dueDate))
          .length,
      0,
    );
    const saldoTotal = rows.reduce((s, r) => s + r.remainingValue, 0);
    // Clientes MGMV que também compraram produtos comuns (fora do acordo).
    const comProdutosExternos = rows.filter((r) =>
      products.some((p) => p.clientId === r.client.id),
    ).length;
    return {
      clientes: rows.length,
      ativos,
      atraso,
      quitados,
      revisao,
      revisadoIA,
      revisadoManual,
      parcelasVencidas,
      saldoTotal,
      comProdutosExternos,
    };
  }, [rows, products]);

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
          return r.reviewStatus === "review_required";
        case "revisado_ia":
          return r.reviewStatus === "ai_reviewed";
        case "revisado_manual":
          return r.reviewStatus === "manually_reviewed";
        case "vencem_hoje":
          return r.nextDue ? isSameDay(r.nextDue) : false;
        case "vencidos":
          return r.agreement.installments.some(
            (i) => !i.paid && isOverdue(i.dueDate),
          );
        case "com_produtos_externos":
          return products.some((p) => p.clientId === r.client.id);
        default:
          return true;
      }
    });
  }, [rows, search, chip, products]);

  const pagedRows = filtered;

  const chips: { id: MgmvChip; label: string; count?: number }[] = [
    { id: "todos", label: "Todos", count: stats.clientes },
    { id: "ativos", label: "Ativos", count: stats.ativos },
    { id: "em_atraso", label: "Em atraso", count: stats.atraso },
    { id: "quitados", label: "Quitados", count: stats.quitados },
    { id: "revisao", label: "Revisão necessária", count: stats.revisao },
    { id: "revisado_ia", label: "Revisado com IA", count: stats.revisadoIA },
    { id: "revisado_manual", label: "Revisado manualmente", count: stats.revisadoManual },
    { id: "vencem_hoje", label: "Vencem hoje" },
    { id: "vencidos", label: "Vencidos" },
    {
      id: "com_produtos_externos",
      label: "Com produtos fora do MGMV",
      count: stats.comProdutosExternos,
    },
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
        actions={
          <Button
            variant="outline"
            disabled={reprocessing}
            onClick={reprocessFromNotes}
          >
            {reprocessing ? "Reprocessando…" : "Reprocessar MGMV por observações"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <MetricCard
          label="Clientes MGMV"
          value={stats.clientes}
          status="primary"
          onClick={() => applyCardFilter("todos")}
          tooltip="Ver todos os acordos MGMV"
        />
        <MetricCard
          label="Acordos ativos"
          value={stats.ativos}
          onClick={() => applyCardFilter("ativos")}
          tooltip="Ver acordos ativos"
        />
        <MetricCard
          label="Em atraso"
          value={stats.atraso}
          status={stats.atraso > 0 ? "danger" : "default"}
          onClick={() => applyCardFilter("em_atraso")}
          tooltip="Ver acordos em atraso"
        />
        <MetricCard
          label="Parcelas vencidas"
          value={stats.parcelasVencidas}
          status={stats.parcelasVencidas > 0 ? "danger" : "default"}
          onClick={() => applyCardFilter("vencidos")}
          tooltip="Ver parcelas vencidas"
        />
        <MetricCard
          label="Quitados"
          value={stats.quitados}
          status="success"
          onClick={() => applyCardFilter("quitados")}
          tooltip="Ver acordos quitados"
        />
        <MetricCard
          label="Revisão necessária"
          value={stats.revisao}
          status={stats.revisao > 0 ? "warning" : "default"}
          onClick={() => applyCardFilter("revisao")}
          tooltip="Ver acordos com revisão necessária"
        />
        <MetricCard
          label="Saldo total"
          value={formatBRL(stats.saldoTotal)}
          onClick={() => applyCardFilter("todos")}
          tooltip="Ver acordos com saldo restante"
        />
        <MetricCard
          label="Com produtos externos"
          value={stats.comProdutosExternos}
          status={stats.comProdutosExternos > 0 ? "warning" : "default"}
          onClick={() => applyCardFilter("com_produtos_externos")}
          tooltip="Ver clientes MGMV que também compraram produtos fora do acordo"
        />
      </div>

      <Card className="mt-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente, telefone…"
                className="h-10 w-full rounded-full border border-input bg-background px-4 pr-10 text-sm outline-none focus:border-primary/40"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <ListExpansionToggle section="mgmv" />
          </div>

          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => setChip(c.id)}
                className={
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                  (chip === c.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent")
                }
              >
                {c.label}
                {typeof c.count === "number" && (
                  <span className="ml-1 opacity-70">({c.count})</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>{filtered.length} acordo(s) encontrado(s)</div>
          </div>
        </div>

        {!listExpanded && (
          <MinimizedListCard
            section="mgmv"
            title="Lista MGMV minimizada"
            lines={[
              `${filtered.length} acordo(s) encontrado(s)`,
              stats.revisao > 0
                ? `${stats.revisao} em revisão necessária`
                : "Nenhum em revisão necessária",
              `Saldo total: ${formatBRL(stats.saldoTotal)}`,
            ]}
          />
        )}
        {listExpanded && (
      <>
      <div className="table-scroll-y mt-4 max-h-[28rem] overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
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
              {pagedRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum acordo MGMV encontrado.
                  </td>
                </tr>
              )}
              {pagedRows.map((r) => {
                const isOpen = expanded === r.client.id;
                const productsOfClient = products.filter(
                  (p) => p.clientId === r.client.id,
                );
                const tagVariant: "danger" | "warning" | "success" | "primary" | "neutral" =
                  r.status === "Em atraso"
                    ? "danger"
                    : r.status === "Quitado"
                      ? "success"
                      : "primary";
                const reviewBadge =
                  r.reviewStatus === "review_required"
                    ? { label: "Revisão necessária", variant: "warning" as const }
                    : r.reviewStatus === "ai_reviewed"
                      ? { label: "Revisado com IA", variant: "primary" as const }
                      : r.reviewStatus === "manually_reviewed"
                        ? { label: "Revisado manualmente", variant: "success" as const }
                        : null;
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
                        <div className="flex flex-wrap gap-1">
                          <Tag variant={tagVariant}>{r.status}</Tag>
                          {reviewBadge && (
                            <Tag variant={reviewBadge.variant}>{reviewBadge.label}</Tag>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.reviewStatus === "review_required" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setAiTarget(r.client.id)}
                            >
                              Revisar com IA
                            </Button>
                          )}
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
      {filtered.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
          <span>{filtered.length} acordo(s) carregado(s)</span>
        </div>
      )}
      </>
      )}
      </Card>
      {(() => {
        if (!aiTarget) return null;
        const row = rows.find((r) => r.client.id === aiTarget);
        if (!row) return null;
        const productsOfClient = products.filter(
          (p) => p.clientId === row.client.id,
        );
        return (
          <MgmvAiReviewModal
            open={true}
            onClose={() => setAiTarget(null)}
            client={row.client}
            agreement={row.agreement}
            products={productsOfClient}
            onApply={(s, meta) => {
              const next = applySuggestionToAgreement(row.agreement, s);
              void applyAiReviewToAgreement(row.client.id, next, {
                confidence: s.confidence,
                rawResult: s,
                mathOk: meta.mathOk,
                confirmedWithConflict: meta.confirmedWithConflict,
              });
              if (meta.mathOk || meta.confirmedWithConflict) {
                toast.success("Acordo marcado como Revisado com IA.");
              } else {
                toast.warning(
                  "A sugestão da IA ainda possui divergência matemática. Acordo continua em Revisão necessária.",
                );
              }
            }}
          />
        );
      })()}
    </section>
  );
}
