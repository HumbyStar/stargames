import { Fragment, useEffect, useMemo, useState } from "react";
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
import { applySuggestionToAgreement } from "@/lib/mgmv-ai-apply";
// paginação client-side removida — mostrar todos os acordos MGMV de uma vez
import { extractMGMVAgreementFromNotes } from "@/sections/import-section";
import { reprocessMGMVFromNotes } from "@/lib/mgmv-reprocess";
import { rebalanceAgreement, isAgreementFullyPaid } from "@/lib/mgmv-schedule";
import { toast } from "sonner";
import { CheckCircle2, X } from "lucide-react";
import { Eye, EyeOff } from "lucide-react";
import { useRowEdit } from "@/lib/use-row-edit";
import { RowEditPencil, RowEditActions } from "@/components/row-edit-controls";
import { MgmvAgreementEditor } from "@/components/mgmv-agreement-editor";
import { highlight, matchText, ColumnMatchDot } from "@/lib/search-highlight";
import { useUiStore } from "@/lib/ui-store";
import { NotionHtmlActions } from "@/components/notion-html-actions";
import { listNfInvoices } from "@/lib/nf-history.functions";
import { useServerFn } from "@tanstack/react-start";
import { StatusLegend } from "@/components/status-legend";
import {
  MgmvCompleteModal,
  MgmvFullyPaidBanner,
} from "@/components/mgmv-complete-modal";
import { MgmvProductsPanel } from "@/components/mgmv-products-panel";

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
  // Saldo Restante = soma exata das parcelas pendentes exibidas na lista,
  // descontando o valor já pago parcialmente em cada uma. Isso garante que
  // o card sempre reflete o que o usuário vê na tabela, mesmo após edições
  // posteriores à revisão da IA.
  const remainingValue = agreement.installments
    .filter((i) => !i.paid)
    .reduce(
      (s, i) => s + Math.max(0, (i.value || 0) - (i.paidAmount ?? 0)),
      0,
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
  const completeMGMVAgreement = useStore((s) => s.completeMGMVAgreement);
  const applyAiReviewToAgreement = useStore((s) => s.applyAiReviewToAgreement);
  const [chip, setChip] = usePersistedState<MgmvChip>("mgmv.chip", "todos");
  const [search, setSearch] = usePersistedState<string>("mgmv.search", "");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Notas fiscais já emitidas para o cliente aberto (badge "NF" nos produtos).
  const listInvoicesFn = useServerFn(listNfInvoices);
  const [nfRefreshKey, setNfRefreshKey] = useState(0);
  const [nfProductMap, setNfProductMap] = useState<
    Map<string, { count: number; lastAt: string }>
  >(new Map());
  useEffect(() => {
    let cancelled = false;
    if (!expanded) {
      setNfProductMap(new Map());
      return;
    }
    void (async () => {
      try {
        const rows = await listInvoicesFn({ data: { clientId: expanded } });
        if (cancelled) return;
        const map = new Map<string, { count: number; lastAt: string }>();
        for (const inv of rows) {
          for (const pid of inv.productIds) {
            const cur = map.get(pid);
            if (!cur) map.set(pid, { count: 1, lastAt: inv.createdAt });
            else {
              cur.count += 1;
              if (new Date(inv.createdAt) > new Date(cur.lastAt))
                cur.lastAt = inv.createdAt;
            }
          }
        }
        setNfProductMap(map);
      } catch {
        /* silencioso: badge é informativo */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, listInvoicesFn, nfRefreshKey]);
  const [aiTarget, setAiTarget] = useState<string | null>(null);
  const [editingAgreement, setEditingAgreement] = useState<string | null>(null);
  const [completeTarget, setCompleteTarget] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  // IDs dos clientes cujos acordos foram efetivamente atualizados no último
  // reprocesso. Enquanto essa lista existir, a seção MGMV mostra apenas
  // esses acordos — é a "regra dos 58": só o que veio atualizado agora
  // aparece. Persistido para sobreviver a reloads.
  const [lastUpdatedIds, setLastUpdatedIds] = usePersistedState<string[] | null>(
    "mgmv.lastUpdatedIds",
    null,
  );
  // Edição por lápis no acordo MGMV. Campos permitidos: totalDebt e valor
  // da parcela. Não expomos ações Retirar/Retirado nesta seção (MGMV é
  // acordo, não produto físico de retirada). Se a edição deixar o acordo
  // matematicamente inconsistente (soma parcelas ≠ totalDebt), o
  // `reviewStatus` cai para "review_required" automaticamente via `buildRow`
  // — o próprio Confirmar marca isso explicitamente também para forçar o
  // recálculo na próxima render.
  const mgmvEdit = useRowEdit<{
    totalDebt: number;
    installmentValue: number;
    installmentsCount: number;
    paidInstallments: number;
  }>();

  /**
   * Aplica filtro a partir do clique em um card de resumo, mantendo o
   * contexto da seção MGMV. Garante que a lista esteja expandida e
   * limpa a busca livre para o usuário enxergar o subconjunto.
   */
  const applyCardFilter = (next: MgmvChip) => {
    setChip(next);
    setSearch("");
  };

  const reprocessFromNotes = () => {
    setReprocessing(true);
    const eligible = clients.filter((c) => !!c.notes);
    const { updatedIds, skippedIds } = reprocessMGMVFromNotes();
    const unchanged = Math.max(
      0,
      eligible.length - updatedIds.length - skippedIds.length,
    );
    setReprocessing(false);
    setLastUpdatedIds(updatedIds);
    toast.success(
      `Reprocessamento concluído: ${updatedIds.length} acordo(s) atualizado(s).` +
        (skippedIds.length > 0
          ? ` ${skippedIds.length} preservado(s) (edição manual / IA).`
          : "") +
        (unchanged > 0 ? ` ${unchanged} sem mudanças.` : ""),
    );
  };

  const rows = useMemo<MgmvRow[]>(() => {
    const onlySet =
      lastUpdatedIds && lastUpdatedIds.length > 0
        ? new Set(lastUpdatedIds)
        : null;
    const list: MgmvRow[] = [];
    for (const c of clients) {
      const isMgmv =
        c.clientType === "mgmv" || (!!c.mgmv && c.mgmv.installments.length > 0);
      if (!isMgmv || !c.mgmv) continue;
      if (onlySet && !onlySet.has(c.id)) continue;
      // Acordos já concluídos (quitação confirmada) saem da listagem — o
      // histórico continua acessível pela ficha do cliente. Acordos com todas
      // as parcelas pagas mas sem confirmação permanecem para o usuário
      // confirmar ou revisar.
      if (c.mgmv.completedAt) continue;
      const row = buildRow(c, c.mgmv);
      list.push(row);
    }
    return list.sort((a, b) =>
      a.client.name.localeCompare(b.client.name, "pt-BR"),
    );
  }, [clients, lastUpdatedIds]);

  const awaitingConfirmationCount = useMemo(
    () =>
      clients.filter(
        (client) =>
          client.mgmv &&
          !client.mgmv.completedAt &&
          isAgreementFullyPaid(client.mgmv),
      ).length,
    [clients],
  );

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
    // Indexa uma única vez os clientIds com produtos para evitar O(n*m) —
    // antes, para cada acordo, rodava products.some percorrendo tudo.
    const clientsWithProducts = new Set<string>();
    for (const p of products) clientsWithProducts.add(p.clientId);
    const comProdutosExternos = rows.filter((r) =>
      clientsWithProducts.has(r.client.id),
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
      clientsWithProducts,
    };
  }, [rows, products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (q) {
        // Busca ampla: cobre todas as colunas exibidas
        // (nome, telefone, valores, parcelas, próximo vencimento,
        // status, revisão, pasta e observações do cliente).
        const reviewLabel =
          r.reviewStatus === "review_required"
            ? "Revisão necessária"
            : r.reviewStatus === "ai_reviewed"
              ? "Revisado com IA"
              : r.reviewStatus === "manually_reviewed"
                ? "Revisado manualmente"
                : "";
        const hay = [
          r.client.name,
          r.status,
          reviewLabel,
          r.client.folder ?? "",
          r.client.notes ?? "",
          formatBRL(r.agreement.totalDebt),
          formatBRL(r.agreement.installments[0]?.value ?? 0),
          formatBRL(r.remainingValue),
          `${r.paidCount}/${r.total}`,
          r.nextDue ? formatDateBR(r.nextDue) : "",
        ]
          .join(" ")
          .toLowerCase();
        const phoneDigits = r.client.phone.replace(/\D/g, "");
        const hit =
          hay.includes(q) ||
          (qDigits.length > 0 && phoneDigits.includes(qDigits));
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
          return stats.clientsWithProducts.has(r.client.id);
        default:
          return true;
      }
    });
  }, [rows, search, chip, stats.clientsWithProducts]);

  const pagedRows = filtered;

  const searchActive = search.trim().length > 0;
  const matchCols = useMemo(() => {
    if (!searchActive)
      return { name: 0, phone: 0, value: 0, installment: 0, remaining: 0, next: 0, status: 0 };
    let name = 0, phone = 0, value = 0, installment = 0, remaining = 0, next = 0, status = 0;
    for (const r of filtered) {
      if (matchText(r.client.name, search)) name++;
      if (matchText(r.client.phone, search)) phone++;
      if (matchText(formatBRL(r.agreement.totalDebt), search)) value++;
      if (matchText(formatBRL(r.agreement.installments[0]?.value ?? 0), search)) installment++;
      if (matchText(formatBRL(r.remainingValue), search)) remaining++;
      if (r.nextDue && matchText(formatDateBR(r.nextDue), search)) next++;
      if (matchText(r.status, search)) status++;
    }
    return { name, phone, value, installment, remaining, next, status };
  }, [filtered, search, searchActive]);

  const chips: { id: MgmvChip; label: string; count?: number }[] = [
    { id: "todos", label: "Todos" },
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={awaitingConfirmationCount === 0}
              onClick={() => {
                setLastUpdatedIds(null);
                applyCardFilter("quitados");
              }}
              title="Ver acordos quitados que ainda precisam de confirmação"
            >
              <CheckCircle2 className="mr-1.5 size-4" />
              Ver quitados aguardando confirmação ({awaitingConfirmationCount})
            </Button>
            {lastUpdatedIds && lastUpdatedIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLastUpdatedIds(null)}
                title="Mostrar todos os acordos, não só os atualizados no último reprocesso"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Mostrando {lastUpdatedIds.length} atualizados · limpar
              </Button>
            )}
            <Button
              variant="outline"
              disabled={reprocessing}
              onClick={reprocessFromNotes}
            >
              {reprocessing ? "Reprocessando…" : "Reprocessar MGMV por observações"}
            </Button>
          </div>
        }
      />

      <StatusLegend className="mt-4" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <MetricCard
          label="Clientes MGMV"
          value={stats.clientes}
          status="primary"
          onClick={() => useUiStore.getState().openHistory("mgmv-todos")}
          tooltip="Abrir base completa de acordos MGMV"
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
          label="Revisão necessária"
          value={stats.revisao}
          status={stats.revisao > 0 ? "warning" : "default"}
          onClick={() => applyCardFilter("revisao")}
          tooltip="Ver acordos com revisão necessária"
        />
        <MetricCard
          label="Saldo total"
          value={formatBRL(stats.saldoTotal)}
          onClick={() => useUiStore.getState().openHistory("mgmv-todos")}
          tooltip="Abrir base completa de acordos MGMV"
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
          {searchActive && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">
                Buscando “{search}” em MGMV:
              </span>
              {[
                { k: "name", label: "Cliente", n: matchCols.name },
                { k: "phone", label: "Telefone", n: matchCols.phone },
                { k: "value", label: "Valor acordo", n: matchCols.value },
                { k: "installment", label: "Parcela", n: matchCols.installment },
                { k: "remaining", label: "Restante", n: matchCols.remaining },
                { k: "next", label: "Vencimento", n: matchCols.next },
                { k: "status", label: "Status", n: matchCols.status },
              ]
                .filter((c) => c.n > 0)
                .map((c) => (
                  <span
                    key={c.k}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                  >
                    <span className="size-1.5 rounded-full bg-primary" />
                    {c.label} ({c.n})
                  </span>
                ))}
              {filtered.length === 0 && (
                <span className="italic">nenhuma correspondência</span>
              )}
            </div>
          )}
        </div>

      <>
      <div className="table-scroll-y mt-4 max-h-[28rem] overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Cliente<ColumnMatchDot active={searchActive} count={matchCols.name} /></th>
                <th className="px-3 py-2">Telefone<ColumnMatchDot active={searchActive} count={matchCols.phone} /></th>
                <th className="px-3 py-2">Valor acordo<ColumnMatchDot active={searchActive} count={matchCols.value} /></th>
                <th className="px-3 py-2">Parcelas<ColumnMatchDot active={searchActive} count={matchCols.installment} /></th>
                <th className="px-3 py-2">Pagas</th>
                <th className="px-3 py-2">Restante<ColumnMatchDot active={searchActive} count={matchCols.remaining} /></th>
                <th className="px-3 py-2">Próximo vencimento<ColumnMatchDot active={searchActive} count={matchCols.next} /></th>
                <th className="px-3 py-2">Status<ColumnMatchDot active={searchActive} count={matchCols.status} /></th>
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
                const productsOfClient = products
                  .filter((p) => p.clientId === r.client.id)
                  .slice()
                  .sort((a, b) =>
                    (b.registerDate ?? "").localeCompare(a.registerDate ?? ""),
                  );
                const editing = mgmvEdit.isEditing(r.client.id);
                const draft = mgmvEdit.draftValues;
                const fullyPaid = isAgreementFullyPaid(r.agreement);
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
                      <td className="px-3 py-2 font-medium">{highlight(r.client.name, search)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {highlight(r.client.phone, search)}
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
                            <input
                              type="number"
                              min={1}
                              max={60}
                              className="h-8 w-14 rounded-md border border-input bg-background px-1 text-sm tabular-nums"
                              value={draft?.installmentsCount ?? r.total}
                              onChange={(e) =>
                                mgmvEdit.setField(
                                  "installmentsCount",
                                  Math.max(1, Math.min(60, Number(e.target.value) || 1)),
                                )
                              }
                              aria-label="Editar nº de parcelas"
                            />
                            <span className="text-muted-foreground">×</span>
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
                        {editing ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={draft?.installmentsCount ?? r.total}
                              className="h-8 w-14 rounded-md border border-input bg-background px-1 text-sm tabular-nums"
                              value={draft?.paidInstallments ?? r.paidCount}
                              onChange={(e) =>
                                mgmvEdit.setField(
                                  "paidInstallments",
                                  Math.max(
                                    0,
                                    Math.min(
                                      draft?.installmentsCount ?? r.total,
                                      Number(e.target.value) || 0,
                                    ),
                                  ),
                                )
                              }
                              aria-label="Editar parcelas pagas"
                            />
                            <span className="text-muted-foreground">
                              /{draft?.installmentsCount ?? r.total}
                            </span>
                          </span>
                        ) : (
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
                        )}
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
                          <Tag variant={tagVariant}>
                            {r.status === "Quitado"
                              ? "Quitado — aguardando conclusão"
                              : r.status}
                          </Tag>
                          {fullyPaid && (
                            <Tag variant="success">Aguardando conclusão</Tag>
                          )}
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
                                    // 1) Ajusta N via rebalance mantendo pagas.
                                    const rebalanced = rebalanceAgreement(
                                      { ...r.agreement, totalDebt: d.totalDebt },
                                      {
                                        targetInstallmentsCount: d.installmentsCount,
                                        newTotalDebt: d.totalDebt,
                                      },
                                    ).agreement;
                                    // 2) Aplica valor uniforme desejado nas parcelas pendentes.
                                    let nextInstallments = rebalanced.installments.map((i) =>
                                      i.paid
                                        ? i
                                        : { ...i, value: d.installmentValue },
                                    );
                                    // 3) Ajusta quantidade de parcelas pagas (marca/desmarca do início).
                                    const targetPaid = Math.max(
                                      0,
                                      Math.min(d.paidInstallments, nextInstallments.length),
                                    );
                                    nextInstallments = nextInstallments.map((i, idx) => {
                                      const shouldBePaid = idx < targetPaid;
                                      if (shouldBePaid && !i.paid) {
                                        return {
                                          ...i,
                                          paid: true,
                                          paidAt: i.paidAt ?? new Date().toISOString(),
                                          paidAmount: i.paidAmount ?? i.value,
                                        };
                                      }
                                      if (!shouldBePaid && i.paid) {
                                        return {
                                          ...i,
                                          paid: false,
                                          paidAt: undefined,
                                          paidAmount: undefined,
                                        };
                                      }
                                      return i;
                                    });
                                    const sum = nextInstallments.reduce((s, i) => s + i.value, 0);
                                    const inconsistent =
                                      Math.abs(sum - d.totalDebt) > d.installmentsCount * 0.01;
                                    setMGMVAgreement(r.client.id, {
                                      ...r.agreement,
                                      totalDebt: d.totalDebt,
                                      installments: nextInstallments,
                                      reviewStatus: inconsistent
                                        ? "review_required"
                                        : "manually_reviewed",
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
                                      if (
                                        !Number.isFinite(d.installmentsCount) ||
                                        d.installmentsCount < 1 ||
                                        d.installmentsCount > 60
                                      )
                                        return "Nº de parcelas inválido (1–60).";
                                      if (
                                        !Number.isFinite(d.paidInstallments) ||
                                        d.paidInstallments < 0 ||
                                        d.paidInstallments > d.installmentsCount
                                      )
                                        return "Parcelas pagas inválidas.";
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
                                  installmentsCount: r.agreement.installments.length,
                                  paidInstallments: r.paidCount,
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
                            title={isOpen ? "Fechar detalhes" : "Ver detalhes"}
                            aria-label={isOpen ? "Fechar detalhes" : "Ver detalhes"}
                            onClick={() =>
                              setExpanded(isOpen ? null : r.client.id)
                            }
                          >
                            {isOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              openClient(r.client.id);
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
                          {fullyPaid && editingAgreement !== r.client.id && (
                            <MgmvFullyPaidBanner
                              onReview={() => setEditingAgreement(r.client.id)}
                              onComplete={() => setCompleteTarget(r.client.id)}
                            />
                          )}
                          {editingAgreement === r.client.id ? (
                            <MgmvAgreementEditor
                              clientId={r.client.id}
                              agreement={r.agreement}
                              products={productsOfClient.filter((p) => p.financialStatus === "MGMV")}
                              availableProducts={productsOfClient.filter((p) => p.financialStatus !== "MGMV")}
                              onClose={() => setEditingAgreement(null)}
                            />
                          ) : (
                          <>
                          <div className="mb-3 flex justify-end">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditingAgreement(r.client.id)}
                            >
                              Editar acordo
                            </Button>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                                Parcelas
                              </div>
                              <div className="space-y-1">
                                {r.agreement.installments.map((i) => {
                                  const isLate = !i.paid && isOverdue(i.dueDate);
                                  const pagoNaParcela = i.paid
                                    ? (i.paidAmount ?? i.value)
                                    : (i.paidAmount ?? 0);
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
                                         ) : (i.paidAmount ?? 0) > 0 ? (
                                           <Tag variant="primary">Parcial {formatBRL(i.paidAmount!)}</Tag>
                                         ) : isLate ? (
                                           <Tag variant="danger">Vencida</Tag>
                                         ) : (
                                           <Tag variant="neutral">Pendente</Tag>
                                         )}
                                         {!i.paid && i.recalculatedAt && (
                                           <span
                                             className="ml-1 inline-flex items-center rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                                             title={`Valor recalculado após redistribuição de um pagamento parcial em ${formatDateBR(i.recalculatedAt)}.`}
                                           >
                                             Recalculada
                                           </span>
                                         )}
                                        {i.paid && i.shortPaid && (
                                          <span
                                            className="ml-1 inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                                            title={`Parcela quitada com valor inferior (${formatBRL(i.paidAmount ?? 0)} de ${formatBRL(i.value)}). O restante foi somado às outras parcelas pendentes.`}
                                          >
                                            Paga (parcial curto)
                                          </span>
                                        )}
                                      </span>
                                      <span
                                        className="tabular-nums text-xs"
                                        title="Valor efetivamente pago nesta parcela"
                                      >
                                        {pagoNaParcela > 0 ? (
                                          formatBRL(pagoNaParcela)
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                      </span>
                                        {!i.paid && !i.manualPartial && !((i.paidAmount ?? 0) > 0) && (
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
                              <MgmvProductsPanel
                                client={r.client}
                                products={productsOfClient}
                                nfProductMap={nfProductMap}
                                onNfSaved={() => setNfRefreshKey((k) => k + 1)}
                              />
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
                              <div className="mt-4">
                                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                  HTML original do Notion
                                </div>
                                {r.client.originalHtmlStoragePath ? (
                                  <NotionHtmlActions
                                    clientId={r.client.id}
                                    fileName={r.client.originalHtmlFileName}
                                    path={r.client.originalHtmlStoragePath}
                                    importedAt={r.client.originalHtmlImportedAt}
                                    sourceFolder={r.client.originalHtmlSourceFolder}
                                  />
                                ) : (
                                  <p className="text-[11px] italic text-muted-foreground">
                                    HTML original não disponível — reimporte este cliente pelo ZIP do Notion para salvar o arquivo automaticamente.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          </>
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
      {filtered.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
          <span>{pagedRows.length} de {filtered.length} acordo(s) exibido(s)</span>
        </div>
      )}
      </>
      </Card>
      {(() => {
        if (!completeTarget) return null;
        const row = rows.find((r) => r.client.id === completeTarget);
        if (!row) return null;
        const mgmvProducts = products.filter(
          (p) => p.clientId === row.client.id && p.financialStatus === "MGMV",
        );
        return (
          <MgmvCompleteModal
            open={true}
            clientName={row.client.name}
            agreement={row.agreement}
            products={mgmvProducts}
            onClose={() => setCompleteTarget(null)}
            onReview={() => {
              setCompleteTarget(null);
              setExpanded(row.client.id);
              setEditingAgreement(row.client.id);
            }}
            onConfirm={() => {
              const res = completeMGMVAgreement(row.client.id);
              setCompleteTarget(null);
              if (res.ok) {
                toast.success(
                  `MGMV concluído. ${res.movedProducts} produto(s) agora estão como Pago / Em Aberto.`,
                );
              } else {
                toast.error("Não foi possível concluir o acordo.");
              }
            }}
          />
        );
      })()}
      {(() => {
        if (!aiTarget) return null;
        const row = rows.find((r) => r.client.id === aiTarget);
        if (!row) return null;
        const productsOfClient = products
          .filter((p) => p.clientId === row.client.id)
          .slice()
          .sort((a, b) =>
            (b.registerDate ?? "").localeCompare(a.registerDate ?? ""),
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

