import { Fragment, useMemo, useState } from "react";
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
import { MgmvPartialPaymentPopover } from "@/components/mgmv-partial-payment-popover";
import { MgmvAiReviewModal } from "@/components/mgmv-ai-review-modal";
import {
  ListExpansionToggle,
  MinimizedListCard,
} from "@/components/list-expansion";
import { useListExpansion } from "@/lib/list-expansion";
import { applySuggestionToAgreement } from "@/lib/mgmv-ai-apply";
import { extractMGMVAgreementFromNotes } from "@/sections/import-section";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useRowEdit } from "@/lib/use-row-edit";
import { RowEditPencil, RowEditActions } from "@/components/row-edit-controls";

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

  // Heurística: notas fora do formato limpo que o parser sabe ler viram
  // "review_required" para forçar o botão "Consultar IA" a aparecer no card.
  const notesSuspect = notesLookSuspect(client.notes ?? "", agreement);

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
    preserved ?? (hasMismatch || notesSuspect ? "review_required" : "none");

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
    hasMismatch: hasMismatch || notesSuspect,
  };
}

/**
 * Retorna true quando a observação MGMV apresenta padrões que o parser por
 * regra não modela com segurança — força "Consultar IA".
 *
 * Sinais considerados suspeitos:
 * - Fração "X/Y Parcela" onde Y ≠ nº de parcelas detectadas.
 * - Valor entre parênteses após "paga" (pagamento parcial explícito).
 * - Palavras "parcial", "sinal", "entrada", "adiantado", "desconto",
 *   "renegocia", "quebrada", "restante", "abateu".
 * - Mais de um "dividido em Nx de V" (múltiplos acordos no mesmo cliente).
 * - Setas/continuação "→" ou "->" seguidas de menção a parcela/valor,
 *   indicando anotação livre além do template.
 * - Valor monetário no texto que não bate com totalDebt nem com value da parcela.
 */
function notesLookSuspect(notes: string, agreement: MGMVAgreement): boolean {
  if (!notes) return false;
  const raw = notes.replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  // Só analisa se há indício de bloco MGMV.
  if (!/mgmv/i.test(raw)) return false;

  const count = agreement.installments.length;

  // 1) Fração X/Y Parcela com Y diferente do total detectado.
  const frac = raw.match(/(\d+)\s*\/\s*(\d+)\s*[ºª]?\s*parcela/i);
  if (frac) {
    const y = Number(frac[2]);
    if (Number.isFinite(y) && y !== count) return true;
  }

  // 2) Pagamento parcial explícito: "(50 reais)" após "paga".
  if (/paga[^.\n]*\([^)]*\bR?\$?\s*\d/i.test(raw)) return true;

  // 3) Palavras-chave livres que não fazem parte do template.
  const suspiciousWords = [
    "parcial",
    "sinal",
    "entrada",
    "adiantad",
    "desconto",
    "renegoci",
    "quebrad",
    "restante",
    "abate",
    "acréscim",
    "acrescim",
    "juros",
    "atraso",
  ];
  if (suspiciousWords.some((w) => lower.includes(w))) return true;

  // 4) Mais de um "dividido em".
  const dividedMatches = raw.match(/dividid[oa]s?\s+em/gi);
  if (dividedMatches && dividedMatches.length > 1) return true;

  // 5) Anotação livre com "→"/"->" mencionando parcela ou valor.
  if (/(→|->)[^\n]{0,80}(parcela|reais|r\$)/i.test(raw)) return true;

  // 6) Valores monetários explícitos (R$ ou "reais") que não batem com
  //    totalDebt nem com value da parcela — indica anotação além do template.
  const value = agreement.installments[0]?.value ?? 0;
  const total = agreement.totalDebt ?? 0;
  const moneyMatches = Array.from(
    raw.matchAll(
      /(?:R\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*reais)/gi,
    ),
  );
  const parsed = moneyMatches
    .map((m) => Number((m[1] ?? m[2] ?? "").replace(/\./g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const eps = 0.5;
  const foreign = parsed.filter(
    (n) => Math.abs(n - total) > eps && Math.abs(n - value) > eps,
  );
  if (foreign.length > 0) return true;

  return false;
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
  const registerMGMVPartialPayment = useStore((s) => s.registerMGMVPartialPayment);
  const setMGMVAgreement = useStore((s) => s.setMGMVAgreement);
  const applyAiReviewToAgreement = useStore((s) => s.applyAiReviewToAgreement);
  const [chip, setChip] = usePersistedState<MgmvChip>("mgmv.chip", "todos");
  const [search, setSearch] = usePersistedState<string>("mgmv.search", "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiTarget, setAiTarget] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const { expanded: listExpanded, expand: expandList } = useListExpansion("mgmv");

  // Edição por lápis no acordo MGMV. Campos permitidos: totalDebt e valor
  // da parcela. Não expomos ações Retirar/Retirado nesta seção (MGMV é
  // acordo, não produto físico de retirada). Se a edição deixar o acordo
  // matematicamente inconsistente (soma parcelas ≠ totalDebt), o
  // `reviewStatus` cai para "review_required" automaticamente via `buildRow`
  // — o próprio Confirmar marca isso explicitamente também para forçar o
  // recálculo na próxima render.
  const mgmvEdit = useRowEdit<{ totalDebt: number; installmentValue: number }>();

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
                const editing = mgmvEdit.isEditing(r.client.id);
                const draft = mgmvEdit.draftValues;
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
                  <Fragment key={r.client.id}>
                    <tr
                      className="border-b transition-colors hover:bg-accent/50"
                    >
                      <td className="px-3 py-2 font-medium">{r.client.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.client.phone}
                      </td>
                      <td className="px-3 py-2">
                        {editing ? (
                          <input
                            type="number"
                            step="0.01"
                            className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                            value={draft?.totalDebt ?? 0}
                            onChange={(e) => mgmvEdit.setField("totalDebt", Number(e.target.value))}
                            aria-label="Editar valor do acordo"
                          />
                        ) : (
                          formatBRL(r.agreement.totalDebt)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editing ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-muted-foreground">{r.total}×</span>
                            <input
                              type="number"
                              step="0.01"
                              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                              value={draft?.installmentValue ?? 0}
                              onChange={(e) => mgmvEdit.setField("installmentValue", Number(e.target.value))}
                              aria-label="Editar valor da parcela"
                            />
                          </span>
                        ) : (
                          <>
                            {r.total}× {formatBRL(r.agreement.installments[0]?.value ?? 0)}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col leading-tight">
                          <span>
                            {r.paidCount}/{r.total}
                          </span>
                          {r.partialPaidAmount > 0 && (
                            <span className="text-[10px] text-warning">
                              + {formatBRL(r.partialPaidAmount)} parcial
                            </span>
                          )}
                        </div>
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
                          {editing ? (
                            <RowEditActions
                              onConfirm={() =>
                                mgmvEdit.confirm(
                                  (d) => {
                                    // Aplica no acordo: atualiza totalDebt e o
                                    // valor de cada parcela (mantendo estrutura
                                    // de datas / status). Se a soma das parcelas
                                    // não bater com totalDebt, `buildRow` marca
                                    // "review_required" no próximo render; aqui
                                    // ainda gravamos explicitamente para forçar
                                    // a badge de revisão a aparecer.
                                    const nextInstallments = r.agreement.installments.map((i) => ({
                                      ...i,
                                      value: d.installmentValue,
                                    }));
                                    const sum = nextInstallments.reduce((s, i) => s + i.value, 0);
                                    const inconsistent = Math.abs(sum - d.totalDebt) > 0.01;
                                    setMGMVAgreement(r.client.id, {
                                      ...r.agreement,
                                      totalDebt: d.totalDebt,
                                      installments: nextInstallments,
                                      reviewStatus: inconsistent
                                        ? "review_required"
                                        : r.agreement.reviewStatus === "review_required"
                                          ? "none"
                                          : r.agreement.reviewStatus,
                                    });
                                    if (inconsistent) {
                                      toast.warning(
                                        "Acordo inconsistente — marcado como Revisão necessária.",
                                      );
                                    } else {
                                      toast.success("Acordo MGMV atualizado.");
                                    }
                                  },
                                  {
                                    validate: (d) => {
                                      if (!Number.isFinite(d.totalDebt) || d.totalDebt <= 0)
                                        return "Valor do acordo inválido.";
                                      if (
                                        !Number.isFinite(d.installmentValue) ||
                                        d.installmentValue <= 0
                                      )
                                        return "Valor da parcela inválido.";
                                      return null;
                                    },
                                  },
                                )
                              }
                              onClose={mgmvEdit.close}
                            />
                          ) : (
                            <RowEditPencil
                              label="Editar acordo MGMV"
                              onStart={() =>
                                mgmvEdit.startEdit(r.client.id, {
                                  totalDebt: r.agreement.totalDebt,
                                  installmentValue:
                                    r.agreement.installments[0]?.value ?? 0,
                                })
                              }
                            />
                          )}
                          {r.reviewStatus === "review_required" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setAiTarget(r.client.id)}
                            >
                              Revisar com IA
                            </Button>
                          )}
                          {chip === "revisado_ia" &&
                            r.reviewStatus === "ai_reviewed" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setAiTarget(r.client.id)}
                              >
                                Revisar novamente
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
                      <tr className="border-b bg-accent/20">
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
                                        {!i.paid && (i.paidAmount ?? 0) > 0 && (
                                          <span className="ml-1 text-[10px] text-warning">
                                            (parcial {formatBRL(i.paidAmount!)})
                                          </span>
                                        )}
                                      </span>
                                      {!i.paid && (
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() =>
                                              payMGMVInstallment(r.client.id, i.number)
                                            }
                                          >
                                            Marcar paga
                                          </Button>
                                          <MgmvPartialPaymentPopover
                                            clientId={r.client.id}
                                            installmentNumber={i.number}
                                            installmentValue={i.value}
                                            currentPartial={i.paidAmount ?? 0}
                                            agreementRemaining={r.remainingValue}
                                            pendingCount={r.pendingCount}
                                            onSubmit={(amount) =>
                                              registerMGMVPartialPayment(
                                                r.client.id,
                                                i.number,
                                                amount,
                                              )
                                            }
                                          />
                                        </div>
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
                  </Fragment>
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

function PartialPaymentPopover({
  clientId: _clientId,
  installmentNumber,
  installmentValue,
  currentPartial,
  agreementRemaining,
  pendingCount,
  onSubmit,
}: {
  clientId: string;
  installmentNumber: number;
  installmentValue: number;
  currentPartial: number;
  /** Saldo restante total do acordo (antes deste pagamento). */
  agreementRemaining: number;
  /** Quantidade de parcelas ainda pendentes (incluindo a atual). */
  pendingCount: number;
  onSubmit: (amount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const trimmed = raw.trim();
  // Aceita apenas formato numérico BR/US: dígitos com uma vírgula ou ponto opcional.
  const numericPattern = /^-?\d+([.,]\d+)?$/;
  const isEmpty = trimmed.length === 0;
  const looksNumeric = !isEmpty && numericPattern.test(trimmed);
  const parsed = looksNumeric ? Number(trimmed.replace(",", ".")) : NaN;
  const notNumber = !isEmpty && (!looksNumeric || !Number.isFinite(parsed));
  const isNegative = looksNumeric && Number.isFinite(parsed) && parsed < 0;
  const isZero = looksNumeric && Number.isFinite(parsed) && parsed === 0;
  const valid = looksNumeric && Number.isFinite(parsed) && parsed > 0;
  const hasError = notNumber || isNegative || isZero;
  const errorMsg = notNumber
    ? "Valor inválido — use apenas números (ex.: 50 ou 50,00)."
    : isNegative
    ? "Valor não pode ser negativo."
    : isZero
    ? "Informe um valor maior que zero."
    : null;

  // Prévia do efeito do pagamento — para dar feedback antes do usuário confirmar.
  const preview = (() => {
    if (!valid) return null;
    if (parsed >= installmentValue) {
      const surplus = parsed - installmentValue;
      return {
        kind: "full" as const,
        message:
          surplus > 0
            ? `Parcela marcada como paga · excedente ${formatBRL(surplus)} abatido da próxima parcela.`
            : "Parcela marcada como paga integralmente.",
      };
    }
    // Pagamento parcial: o valor é absorvido no saldo do acordo e as
    // parcelas ainda pendentes são recalculadas (mesma quantidade, mesmas
    // datas). Prevê o novo valor rateado por parcela pendente.
    const nextRemaining = Math.max(0, agreementRemaining - parsed);
    const nextPerInstallment =
      pendingCount > 0 ? nextRemaining / pendingCount : 0;
    return {
      kind: "partial" as const,
      message: `Pagamento parcial de ${formatBRL(parsed)} absorvido · restante do acordo ${formatBRL(nextRemaining)} redistribuído em ${pendingCount}× ${formatBRL(nextPerInstallment)}.`,
    };
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-[11px]">
          Pagamento parcial
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3 text-xs">
        <div className="font-semibold">
          Parcela #{installmentNumber} — {formatBRL(installmentValue)}
        </div>
        {currentPartial > 0 && (
          <div className="text-muted-foreground">
            Já pago parcialmente: {formatBRL(currentPartial)}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Valor recebido (R$)</span>
          <Input
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="0,00"
            inputMode="decimal"
            className={cn(
              "h-8 text-sm",
              hasError && "border-destructive focus-visible:ring-destructive",
            )}
            aria-invalid={hasError}
            aria-describedby="partial-payment-hint"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                e.preventDefault();
                (e.currentTarget.form?.querySelector("[data-confirm]") as HTMLButtonElement | null)?.click();
              }
            }}
          />
        </label>
        {errorMsg ? (
          <p
            id="partial-payment-hint"
            role="alert"
            className="rounded-md bg-destructive/10 px-2 py-1 leading-snug text-destructive"
          >
            {errorMsg}
          </p>
        ) : preview ? (
          <p
            id="partial-payment-hint"
            aria-live="polite"
            className={cn(
              "rounded-md px-2 py-1 leading-snug",
              preview.kind === "full"
                ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                : "bg-warning/10 text-warning",
            )}
          >
            {preview.message}
          </p>
        ) : (
          <p className="leading-snug text-muted-foreground">
            Se maior ou igual a {formatBRL(installmentValue)}, a parcela é marcada
            como paga e o excedente vira desconto na próxima. Caso contrário,
            registra pagamento parcial.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            data-confirm
            disabled={!valid}
            onClick={() => {
              onSubmit(parsed);
              const summary =
                preview?.kind === "full"
                  ? "Parcela quitada."
                  : preview?.message ?? "Pagamento registrado.";
              setRaw("");
              setOpen(false);
              toast.success(summary);
            }}
          >
            Confirmar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
