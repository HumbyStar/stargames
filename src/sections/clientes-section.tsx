import { Fragment, useEffect, useMemo, useState } from "react";
import { Folder, Filter, Pencil, Eye, EyeOff, AlertTriangle, Trash2 } from "lucide-react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { usePersistedState } from "@/lib/use-persisted-state";
import { Button } from "@/components/ui/button";
// paginação client-side removida — mostrar todos os clientes de uma vez
import { useUiStore } from "@/lib/ui-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateFinancialStatus,
  calculateClientFinancialSummary,
  displaySituation,
  isProductArchived,
  formatBRL,
  formatDateBR,
  getMGMVDisplay,
  getProductDisplayDueDate,
  isOverdue,
  isOpenSituation,
  isResolvedSituation,
  productCollectionStatus,
  shouldAppearInCollection,
  useStore,
  type Client,
  type Product,
  type FinancialStatus,
  type Situation,
  type PartialPaymentResult,
} from "@/lib/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  productStatusTone,
  productStatusTextTone,
  productStatusVariant,
} from "@/lib/status-tone";
import { StatusLegend } from "@/components/status-legend";
import { NotionHtmlActions } from "@/components/notion-html-actions";
import { MgmvCreateModal } from "@/components/mgmv-create-modal";
import { MgmvPartialPaymentPopover } from "@/components/mgmv-partial-payment-popover";
import { MgmvAgreementEditor } from "@/components/mgmv-agreement-editor";
import {
  MgmvCompleteModal,
  MgmvFullyPaidBanner,
} from "@/components/mgmv-complete-modal";
import { isAgreementFullyPaid } from "@/lib/mgmv-schedule";
import { ProductBulkActionsBar } from "@/components/product-bulk-actions";
import { RetiradoConfirmModal } from "@/components/retirado-confirm-modal";
import { CustomerDataModal } from "@/components/customer-data-modal";
import { isFichaComplete } from "@/lib/ficha-parse";
import { NfFormatModal } from "@/components/nf-format-modal";
import {
  NfDuplicateWarningModal,
  type DuplicateNfProduct,
} from "@/components/nf-duplicate-warning-modal";
import { NfHistoryModal } from "@/components/nf-history-modal";
import { NfEmittedBadge } from "@/components/nf-emitted-badge";
import { listNfInvoices, type NfInvoiceRow } from "@/lib/nf-history.functions";
import { useServerFn } from "@tanstack/react-start";
import { useRowEdit } from "@/lib/use-row-edit";
import { RowEditPencil, RowEditActions } from "@/components/row-edit-controls";
import { highlight, matchText, ColumnMatchDot } from "@/lib/search-highlight";

type ChipFilter =
  | "todos"
  | "reserva_vencida"
  | "pendente"
  | "pago_aguardando"
  | "enviado"
  | "abandonou"
  | "em_dia"
  | "sem_produtos";

function generalStatus(
  client: Client,
  clientProducts: Product[],
): {
  label: string;
  variant: "danger" | "warning" | "success" | "neutral" | "primary";
} {
  const ps = clientProducts;
  if (
    ps.some(
      (p) => p.financialStatus === "Reserva" && isOpenSituation(p) && isOverdue(p.dueDate),
    )
  )
    return { label: "Reserva vencida", variant: "danger" };
  if (ps.some((p) => p.financialStatus === "Pendente" && isOpenSituation(p)))
    return { label: "Pendente", variant: "danger" };
  if (client.mgmv && client.mgmv.installments.some((i) => !i.paid))
    return { label: "MGMV", variant: "primary" };
  if (ps.some((p) => p.financialStatus === "Pago" && isOpenSituation(p)))
    return { label: "Pago ag. envio", variant: "success" };
  if (ps.some((p) => isResolvedSituation(p) && p.financialStatus !== "MGMV"))
    return { label: "Enviado", variant: "neutral" };
  if (ps.length === 0) return { label: "Sem produtos", variant: "neutral" };
  return { label: "Em dia", variant: "success" };
}

export function ClientesSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClientId = useStore((s) => s.openClientId);
  const openClient = useStore((s) => s.openClient);
  const addClient = useStore((s) => s.addClient);
  const updateClient = useStore((s) => s.updateClient);
  const deleteClient = useStore((s) => s.deleteClient);
  const addProduct = useStore((s) => s.addProduct);
  const updateProduct = useStore((s) => s.updateProduct);
  const registerPayment = useStore((s) => s.registerPayment);
  const setProductSituation = useStore((s) => s.setProductSituation);
  const payMGMVInstallment = useStore((s) => s.payMGMVInstallment);
  const registerMGMVPartialPayment = useStore(
    (s) => s.registerMGMVPartialPayment,
  );

  const [search, setSearch] = usePersistedState<string>("clientes.search", "");
  const [chip, setChip] = usePersistedState<ChipFilter>(
    "clientes.chip",
    "todos",
  );
  const [financialFilter, setFinancialFilter] = usePersistedState<string>(
    "clientes.financial",
    "Todos",
  );
  const [situationFilter, setSituationFilter] = usePersistedState<string>(
    "clientes.situation",
    "Todas",
  );
  const [platformFilter, setPlatformFilter] = usePersistedState<string>(
    "clientes.platform",
    "Todas",
  );
  const [periodFilter, setPeriodFilter] = usePersistedState<string>("clientes.period", "Todos");
  const [folderFilter, setFolderFilter] = usePersistedState<string>("clientes.folder", "Todas");
  const compact = true;
  const [showFilters, setShowFilters] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  /**
   * Drill-down a partir de um card de resumo: ajusta o chip do contexto
   * Clientes e expande a lista quando estiver minimizada.
   */
  const applyCardFilter = (next: ChipFilter) => {
    setChip(next);
    setSearch("");
  };

  const drawerClientId = openClientId;
  const setDrawerClientId = (id: string | null) => openClient(id);
  const [clientModal, setClientModal] = useState<{ open: boolean; client?: Client | null }>({
    open: false,
  });
  const [productModal, setProductModal] = useState<{
    open: boolean;
    clientId?: string;
    product?: Product | null;
  }>({ open: false });
  const [retiradoModal, setRetiradoModal] = useState<{
    open: boolean;
    productId?: string;
  }>({ open: false });
  const [customerDataModal, setCustomerDataModal] = useState<{
    open: boolean;
    client?: Client | null;
  }>({ open: false });

  const drawerClient = clients.find((c) => c.id === drawerClientId) ?? null;

  // Edição por lápis (linha da tabela de clientes). Somente o botão
  // "Confirmar" persiste; "Fechar" descarta. Clique fora / blur não
  // disparam confirm nem close — o hook não escuta esses eventos.
  const clientEdit = useRowEdit<{
    name: string;
    phone: string;
    notes: string;
    /** YYYY-MM-DD — data da última compra editável via lápis. */
    lastPurchase: string;
  }>();

  const folders = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.folder && c.folder.trim()) set.add(c.folder);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  }, [clients]);

  // Agregados por cliente derivados apenas de (clients, products). Isolar
  // esta camada custosa da camada de filtros evita recomputar tudo a cada
  // tecla digitada na busca ou troca de chip. Um único pass O(n+m) constrói
  // o índice de produtos por cliente e os totais.
  const baseRows = useMemo(() => {
    const productsByClient = new Map<string, typeof products>();
    for (const p of products) {
      const arr = productsByClient.get(p.clientId);
      if (arr) arr.push(p);
      else productsByClient.set(p.clientId, [p]);
    }
    return clients
      .filter((c) => {
        const isMgmv = c.clientType === "mgmv" || (!!c.mgmv && c.mgmv.installments.length > 0);
        if (!isMgmv) return true;
        // Cliente MGMV só aparece em Clientes se também tiver produtos
        // fora do acordo MGMV (comuns). MGMV puro fica só na seção MGMV.
        const ps = productsByClient.get(c.id) ?? [];
        return ps.some((p) => p.financialStatus !== "MGMV");
      })
      .map((c) => {
        const ps = productsByClient.get(c.id) ?? [];
        const financial = calculateClientFinancialSummary(c, ps);
        let last: string | undefined;
        for (const p of ps) {
          if (!last || p.registerDate > last) last = p.registerDate;
        }
        const status = generalStatus(c, ps);
        return {
          client: c,
          products: ps,
          totalPurchased: financial.totalPurchased,
          totalOpen: financial.totalRemaining,
          last,
          status,
        };
      });
  }, [clients, products]);

  // Debounce do termo de busca. Digitar não deve reprocessar imediatamente
  // uma lista de milhares — 200ms basta para percepção fluida.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  const rows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return baseRows.filter((r) => {
          if (q) {
            // Busca ampla: casa qualquer célula visível da linha
            // (nome, telefone, status, produtos, plataformas, pasta,
            // observações, totais formatados em BRL e última compra).
            const productHay = r.products
              .map(
                (p) =>
                  `${p.name} ${p.platform ?? ""} ${p.financialStatus} ${p.situation}`,
              )
              .join(" ");
            const hay = [
              r.client.name,
              r.status.label,
              r.client.notes ?? "",
              r.client.folder ?? "",
              productHay,
              formatBRL(r.totalPurchased),
              formatBRL(r.totalOpen),
              r.last ? formatDateBR(r.last) : "",
            ]
              .join(" ")
              .toLowerCase();
            const qDigits = q.replace(/\D/g, "");
            const phoneDigits = r.client.phone.replace(/\D/g, "");
            const hit =
              hay.includes(q) ||
              (qDigits.length > 0 && phoneDigits.includes(qDigits));
            if (!hit) return false;
          }
          if (chip !== "todos") {
            const map: Record<ChipFilter, boolean> = {
              todos: true,
              reserva_vencida: r.status.label === "Reserva vencida",
              pendente: r.products.some(
                (p) => p.financialStatus === "Pendente" && p.situation === "Em Aberto",
              ),
              pago_aguardando: r.products.some(
                (p) => p.financialStatus === "Pago" && p.situation === "Em Aberto",
              ),
              enviado: r.products.some((p) => p.situation === "Enviado"),
              // Desistiu foi unificado como Abandonou; ambos os valores
              // históricos casam o mesmo chip.
              abandonou: r.products.some(
                (p) => p.situation === "Abandonou" || p.situation === "Desistiu",
              ),
              em_dia: r.status.label === "Em dia",
              sem_produtos: r.products.length === 0,
            };
            if (!map[chip]) return false;
          }
          if (
            financialFilter !== "Todos" &&
            !r.products.some((p) => p.financialStatus === financialFilter)
          )
            return false;
          if (
            situationFilter !== "Todas" &&
            !r.products.some((p) => p.situation === situationFilter)
          )
            return false;
          if (platformFilter !== "Todas" && !r.products.some((p) => p.platform === platformFilter))
            return false;
          if (periodFilter !== "Todos" && r.last) {
            const diff = (Date.now() - new Date(r.last).getTime()) / 86400000;
            if (periodFilter === "7" && diff > 7) return false;
            if (periodFilter === "30" && diff > 30) return false;
          }
          if (folderFilter !== "Todas") {
            if (folderFilter === "__sem__") {
              if (r.client.folder) return false;
            } else if (r.client.folder !== folderFilter) {
              return false;
            }
          }
          return true;
    });
  }, [
    baseRows,
    debouncedSearch,
    chip,
    financialFilter,
    situationFilter,
    platformFilter,
    periodFilter,
    folderFilter,
  ]);

  const pagedRows = rows;

  // Contagem de correspondências por coluna sobre a lista já filtrada
  // (`rows`) — usado para pintar o indicador no cabeçalho e a legenda
  // "encontrado em: ..." acima da tabela.
  const searchActive = debouncedSearch.trim().length > 0;
  const matchCols = useMemo(() => {
    if (!searchActive) {
      return { name: 0, phone: 0, status: 0, products: 0, folder: 0, notes: 0, totals: 0, last: 0 };
    }
    let name = 0, phone = 0, status = 0, prods = 0, folder = 0, notes = 0, totals = 0, last = 0;
    for (const r of rows) {
      if (matchText(r.client.name, debouncedSearch)) name++;
      if (matchText(r.client.phone, debouncedSearch)) phone++;
      if (matchText(r.status.label, debouncedSearch)) status++;
      if (matchText(r.client.folder ?? "", debouncedSearch)) folder++;
      if (matchText(r.client.notes ?? "", debouncedSearch)) notes++;
      if (
        r.products.some(
          (p) =>
            matchText(p.name, debouncedSearch) ||
            matchText(p.platform ?? "", debouncedSearch) ||
            matchText(p.financialStatus, debouncedSearch) ||
            matchText(p.situation, debouncedSearch),
        )
      )
        prods++;
      if (
        matchText(formatBRL(r.totalPurchased), debouncedSearch) ||
        matchText(formatBRL(r.totalOpen), debouncedSearch)
      )
        totals++;
      if (r.last && matchText(formatDateBR(r.last), debouncedSearch)) last++;
    }
    return { name, phone, status, products: prods, folder, notes, totals, last };
  }, [rows, debouncedSearch, searchActive]);

  const activeFilterCount =
    (chip !== "pago_aguardando" ? 1 : 0) +
    (financialFilter !== "Todos" ? 1 : 0) +
    (situationFilter !== "Todas" ? 1 : 0) +
    (platformFilter !== "Todas" ? 1 : 0) +
    (periodFilter !== "Todos" ? 1 : 0) +
    (folderFilter !== "Todas" ? 1 : 0);

  const clearFilters = () => {
    setChip("pago_aguardando");
    setFinancialFilter("Todos");
    setSituationFilter("Todas");
    setPlatformFilter("Todas");
    setPeriodFilter("Todos");
    setFolderFilter("Todas");
    setSearch("");
  };

  const totalClients = clients.length;
  const { clientesPendencia, pagosAgEnvio } = useMemo(() => {
    const pending = new Set<string>();
    let pagos = 0;
    for (const p of products) {
      if (p.situation !== "Em Aberto") continue;
      if (p.financialStatus === "Pago") pagos++;
      if (
        p.financialStatus === "Pendente" ||
        (p.financialStatus === "Reserva" && isOverdue(p.dueDate))
      ) {
        pending.add(p.clientId);
      }
    }
    return { clientesPendencia: pending.size, pagosAgEnvio: pagos };
  }, [products]);

  const chips: { id: ChipFilter; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "reserva_vencida", label: "Reserva vencida" },
    { id: "pendente", label: "Pendente" },
    { id: "pago_aguardando", label: "Pago aguardando envio" },
    { id: "enviado", label: "Enviado" },
    { id: "abandonou", label: "Abandonou" },
    { id: "em_dia", label: "Em dia" },
    { id: "sem_produtos", label: "Sem produtos" },
  ];

  const exportBase = () => {
    const header = "nome;telefone;total_comprado;total_aberto;status\n";
    const body = rows
      .map(
        (r) =>
          `${r.client.name};${r.client.phone};${r.totalPurchased.toFixed(2)};${r.totalOpen.toFixed(2)};${r.status.label}`,
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Base exportada");
  };

  return (
    <section id="clientes" data-tour="clients-section" className="one-page-section">
      <PageHeader
        title="Clientes"
        description="Gerencie clientes, produtos, histórico de compras e situação financeira."
        actions={
          <>
            <Button onClick={() => setClientModal({ open: true, client: null })}>
              Adicionar Cliente
            </Button>
            <Button variant="outline" onClick={() => useUiStore.getState().openImport()}>
              Importar Clientes
            </Button>
            <Button variant="outline" onClick={exportBase}>
              Exportar Base
            </Button>
          </>
        }
      />

      <StatusLegend className="mt-4" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricCard
          label="Total de Clientes"
          value={totalClients}
          onClick={() => useUiStore.getState().openHistory("clientes-todos")}
          tooltip="Abrir base completa de clientes"
        />
        <MetricCard
          label="Clientes com Pendência"
          value={clientesPendencia}
          status="danger"
          onClick={() => applyCardFilter("pendente")}
          tooltip="Ver clientes com pendência"
        />
        <MetricCard
          label="Pagos aguardando envio"
          value={pagosAgEnvio}
          status="success"
          onClick={() => applyCardFilter("pago_aguardando")}
          tooltip="Ver pagos aguardando envio"
        />
      </div>

      <Card className="mt-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              className="gap-1.5"
            >
              <Filter className="h-4 w-4" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {showFilters && (
            <>
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
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <div className="relative">
                  <Folder className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <select
                    value={folderFilter}
                    onChange={(e) => setFolderFilter(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm"
                    title="Filtrar por pasta de origem"
                  >
                    <option value="Todas">Pasta (todas)</option>
                    <option value="__sem__">Sem pasta</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  value={financialFilter}
                  onChange={(e) => setFinancialFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="Todos">Status financeiro</option>
                  <option>Pago</option>
                  <option>Reserva</option>
                  <option>Pendente</option>
                  <option>MGMV</option>
                </select>
                <select
                  value={situationFilter}
                  onChange={(e) => setSituationFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="Todas">Situação</option>
                  <option>Em Aberto</option>
                  <option>Enviado</option>
                  <option>Abandonou</option>
                  <option>Retirar</option>
                  <option>Retirado</option>
                </select>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="Todos">Período</option>
                  <option value="7">Últimos 7 dias</option>
                  <option value="30">Últimos 30 dias</option>
                </select>
                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="Todas">Plataforma</option>
                  <option>PS5</option>
                  <option>PS4</option>
                  <option>PS2</option>
                  <option>Xbox</option>
                  <option>Colecionável</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>
                  {rows.length} cliente(s) encontrado(s)
                  {activeFilterCount > 0 && ` • ${activeFilterCount} filtro(s) ativo(s)`}
                </div>
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters} className="text-primary hover:underline">
                    Limpar filtros
                  </button>
                )}
              </div>
              {searchActive && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Buscando “{search}” em Clientes:
                  </span>
                  {[
                    { k: "name", label: "Nome", n: matchCols.name },
                    { k: "phone", label: "Telefone", n: matchCols.phone },
                    { k: "status", label: "Status", n: matchCols.status },
                    { k: "products", label: "Produtos", n: matchCols.products },
                    { k: "folder", label: "Pasta", n: matchCols.folder },
                    { k: "notes", label: "Observações", n: matchCols.notes },
                    { k: "totals", label: "Valores", n: matchCols.totals },
                    { k: "last", label: "Última compra", n: matchCols.last },
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
                  {rows.length === 0 && (
                    <span className="italic">nenhuma correspondência</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <>
            <div className="table-scroll-y mt-5 max-h-[28rem] overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">
                      Cliente<ColumnMatchDot active={searchActive} count={matchCols.name} />
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      Telefone<ColumnMatchDot active={searchActive} count={matchCols.phone} />
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      Status Geral<ColumnMatchDot active={searchActive} count={matchCols.status} />
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      Qtd. Produtos<ColumnMatchDot active={searchActive} count={matchCols.products} />
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      Total Comprado<ColumnMatchDot active={searchActive} count={matchCols.totals} />
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      Total em Aberto<ColumnMatchDot active={searchActive} count={matchCols.totals} />
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      Última Compra<ColumnMatchDot active={searchActive} count={matchCols.last} />
                    </th>
                    {!compact && (
                      <th className="py-2 pr-3 font-medium">
                        Observações<ColumnMatchDot active={searchActive} count={matchCols.notes} />
                      </th>
                    )}
                    <th className="py-2 pr-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => {
                    const isRowOpen = expandedRow === r.client.id;
                    return (
                    <Fragment key={r.client.id}>
                    <tr className="border-b border-border/60 last:border-0">
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") +
                          " pr-3 transition-[padding] duration-300 font-medium"
                        }
                      >
                        {clientEdit.isEditing(r.client.id) ? (
                          <input
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={clientEdit.draftValues?.name ?? ""}
                            onChange={(e) =>
                              clientEdit.setField("name", e.target.value)
                            }
                            aria-label="Editar nome do cliente"
                          />
                        ) : (
                          <button
                            onClick={() => setDrawerClientId(r.client.id)}
                            className="text-left hover:text-primary"
                          >
                            {highlight(r.client.name, search)}
                            {r.client.folder && (
                              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                                <Folder className="h-2.5 w-2.5" />
                                {highlight(r.client.folder, search)}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") +
                          " pr-3 transition-[padding] duration-300 text-muted-foreground"
                        }
                      >
                        {clientEdit.isEditing(r.client.id) ? (
                          <input
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={clientEdit.draftValues?.phone ?? ""}
                            onChange={(e) =>
                              clientEdit.setField("phone", e.target.value)
                            }
                            aria-label="Editar telefone do cliente"
                          />
                        ) : (
                          highlight(r.client.phone, search)
                        )}
                      </td>
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"
                        }
                      >
                        <Tag variant={r.status.variant}>{r.status.label}</Tag>
                      </td>
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") +
                          " pr-3 transition-[padding] duration-300 tabular-nums"
                        }
                      >
                        {r.products.length}
                      </td>
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") +
                          " pr-3 transition-[padding] duration-300 tabular-nums"
                        }
                      >
                        {formatBRL(r.totalPurchased)}
                      </td>
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") +
                          " pr-3 transition-[padding] duration-300 tabular-nums font-medium"
                        }
                      >
                        {formatBRL(r.totalOpen)}
                      </td>
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") +
                          " pr-3 transition-[padding] duration-300 text-muted-foreground"
                        }
                      >
                        {clientEdit.isEditing(r.client.id) ? (
                          <input
                            type="date"
                            className="w-[140px] rounded-md border border-input bg-background px-2 py-1 text-sm"
                            value={clientEdit.draftValues?.lastPurchase ?? ""}
                            onChange={(e) =>
                              clientEdit.setField("lastPurchase", e.target.value)
                            }
                            aria-label="Editar data da última compra"
                          />
                        ) : r.last ? (
                          highlight(formatDateBR(r.last), search)
                        ) : (
                          "—"
                        )}
                      </td>
                      {!compact && (
                        <td className="py-3 pr-3 max-w-[220px] text-muted-foreground">
                          {clientEdit.isEditing(r.client.id) ? (
                            <textarea
                              className="min-h-[32px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                              value={clientEdit.draftValues?.notes ?? ""}
                              onChange={(e) =>
                                clientEdit.setField("notes", e.target.value)
                              }
                              aria-label="Editar observação do cliente"
                              rows={2}
                            />
                          ) : (
                            <span className="block truncate">
                              {r.client.notes ? highlight(r.client.notes, search) : "—"}
                            </span>
                          )}
                        </td>
                      )}
                      <td
                        className={
                          (compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"
                        }
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {clientEdit.isEditing(r.client.id) ? (
                            <RowEditActions
                              onConfirm={() =>
                                clientEdit.confirm(
                                  (draft) => {
                                    updateClient(r.client.id, {
                                      name: draft.name.trim(),
                                      phone: draft.phone.trim(),
                                      notes: draft.notes.trim() || undefined,
                                    });
                                    // "Última compra" é derivada do produto de maior
                                    // registerDate do cliente. Se o usuário editou a
                                    // data, aplica no produto mais recente para que
                                    // a coluna reflita imediatamente.
                                    const nextYmd = draft.lastPurchase?.trim() ?? "";
                                    const prevYmd = r.last ? r.last.slice(0, 10) : "";
                                    if (nextYmd && nextYmd !== prevYmd) {
                                      const newest = [...r.products].sort((a, b) =>
                                        (b.registerDate ?? "").localeCompare(
                                          a.registerDate ?? "",
                                        ),
                                      )[0];
                                      if (newest) {
                                        updateProduct(newest.id, {
                                          registerDate: new Date(
                                            `${nextYmd}T12:00:00`,
                                          ).toISOString(),
                                        });
                                      }
                                    }
                                    toast.success("Cliente atualizado");
                                  },
                                  {
                                    validate: (d) =>
                                      !d.name.trim()
                                        ? "Nome é obrigatório."
                                        : null,
                                  },
                                )
                              }
                              onClose={clientEdit.close}
                            />
                          ) : (
                            <>
                              <RowEditPencil
                                label="Editar cliente"
                                onStart={() =>
                                  clientEdit.startEdit(r.client.id, {
                                    name: r.client.name,
                                    phone: r.client.phone,
                                    notes: r.client.notes ?? "",
                                    lastPurchase: r.last ? r.last.slice(0, 10) : "",
                                  })
                                }
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDrawerClientId(r.client.id)}
                              >
                                Abrir
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title={isRowOpen ? "Fechar detalhes" : "Ver detalhes"}
                                aria-label={isRowOpen ? "Fechar detalhes" : "Ver detalhes"}
                                onClick={() =>
                                  setExpandedRow(isRowOpen ? null : r.client.id)
                                }
                              >
                                {isRowOpen ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isRowOpen && (
                      <tr className="border-b border-border/60 bg-accent/20">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                                Produtos ({r.products.length})
                              </div>
                              <div className="space-y-1 text-xs">
                                {r.products.length === 0 && (
                                  <p className="text-muted-foreground">
                                    Nenhum produto cadastrado.
                                  </p>
                                )}
                                {r.products.map((p) => (
                                  <div
                                    key={p.id}
                                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2 py-1"
                                  >
                                    <span className="truncate font-medium">{p.name}</span>
                                    <span className="text-muted-foreground">{p.platform ?? "—"}</span>
                                    <span className="tabular-nums">{formatBRL(p.totalValue)}</span>
                                    <Tag>{displaySituation(p.situation)}</Tag>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    setProductModal({ open: true, clientId: r.client.id })
                                  }
                                >
                                  + Produto
                                </Button>
                                {r.products.some(shouldAppearInCollection) && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onScrollTo("collection")}
                                  >
                                    Cobrança
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                                Observações
                              </div>
                              <div className="whitespace-pre-wrap rounded-md border border-border/60 bg-card p-2 text-xs text-muted-foreground">
                                {r.client.notes && r.client.notes.trim()
                                  ? highlight(r.client.notes, search)
                                  : "Nenhuma observação."}
                              </div>
                              {r.client.folder && (
                                <div className="mt-2 text-xs text-muted-foreground">
                                  Pasta: <span className="font-medium">{r.client.folder}</span>
                                </div>
                              )}
                              <div className="mt-3 rounded-md border border-border/60 bg-card p-2">
                                <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
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
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                  {pagedRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-10 text-center text-muted-foreground"
                      >
                        Nenhum cliente encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {rows.length > 0 && (
              <div className="mt-6 flex flex-col items-center gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
                <span>
                  {pagedRows.length} de {rows.length} cliente(s) exibido(s)
                </span>
              </div>
            )}
          </>
      </Card>

      {/* Modal cliente em tela cheia */}
      <Dialog open={!!drawerClient} onOpenChange={(o) => !o && setDrawerClientId(null)}>
 <DialogContent>
          {drawerClient && (
            <ClientDrawer
              client={drawerClient}
              products={products.filter((p) => p.clientId === drawerClient.id)}
              onEdit={() => setClientModal({ open: true, client: drawerClient })}
              onAddProduct={() => setProductModal({ open: true, clientId: drawerClient.id })}
              onDeleteClient={async () => {
                const name = drawerClient.name;
                try {
                  await deleteClient(drawerClient.id);
                  setDrawerClientId(null);
                  toast.success(`Cliente "${name}" excluído.`);
                } catch {
                  toast.error("Falha ao excluir cliente. Tente novamente.");
                }
              }}
              onSaveNotes={(notes) => {
                updateClient(drawerClient.id, { notes });
                toast.success("Observação salva");
              }}
              onCustomerData={() =>
                setCustomerDataModal({ open: true, client: drawerClient })
              }
              onRegisterPayment={(productId, remaining) => {
                const raw = window.prompt("Valor recebido (R$):", remaining.toFixed(2));
                if (!raw) return;
                const amount = Number(raw.replace(",", "."));
                if (!Number.isFinite(amount) || amount <= 0) return;
                registerPayment(productId, amount);
                toast.success("Pagamento registrado");
              }}
              onChangeSituation={(productId, s) => {
                setProductSituation(productId, s);
                toast.success("Situação atualizada");
              }}
              onRequestRetirado={(productId) =>
                setRetiradoModal({ open: true, productId })
              }
              onMarkPaid={(p) => {
                updateProduct(p.id, { paidValue: p.totalValue, financialStatus: "Pago" });
                toast.success("Marcado como pago");
              }}
              onPayMGMVInstallment={(installmentNumber) => {
                payMGMVInstallment(drawerClient.id, installmentNumber);
                toast.success(`Parcela ${installmentNumber} marcada como paga`);
              }}
              onRegisterMGMVPartialPayment={(
                installmentNumber,
                amount,
              ) =>
                registerMGMVPartialPayment(
                  drawerClient.id,
                  installmentNumber,
                  amount,
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal dados completos do cliente */}
      {customerDataModal.client && (
        <CustomerDataModal
          open={customerDataModal.open}
          onClose={() => setCustomerDataModal({ open: false })}
          clientName={customerDataModal.client.name}
          clientPhone={customerDataModal.client.phone}
          initialData={customerDataModal.client.customerData}
          onSave={(customerData) => {
            updateClient(customerDataModal.client!.id, { customerData });
            toast.success("Dados do cliente salvos");
          }}
        />
      )}

      {/* Modal cliente */}
      <ClientModal
        state={clientModal}
        onClose={() => setClientModal({ open: false })}
        onSave={(data) => {
          if (clientModal.client) {
            updateClient(clientModal.client.id, data);
            toast.success("Cliente atualizado");
          } else {
            addClient(data);
            toast.success("Cliente criado");
          }
          setClientModal({ open: false });
        }}
      />

      {/* Modal produto */}
      <ProductModal
        state={productModal}
        clients={clients}
        onClose={() => setProductModal({ open: false })}
        onSave={(clientId, data) => {
          if (productModal.product) {
            updateProduct(productModal.product.id, { ...data, clientId });
            toast.success("Produto atualizado");
          } else {
            addProduct({ clientId, ...data });
            toast.success("Produto adicionado");
          }
          setProductModal({ open: false });
        }}
      />

      {/* Popup central obrigatório para confirmar Retirado */}
      <RetiradoConfirmModal
        open={retiradoModal.open}
        client={
          retiradoModal.productId
            ? (() => {
                const p = products.find((pr) => pr.id === retiradoModal.productId);
                return p ? clients.find((c) => c.id === p.clientId) ?? null : null;
              })()
            : null
        }
        product={
          retiradoModal.productId
            ? products.find((pr) => pr.id === retiradoModal.productId) ?? null
            : null
        }
        onCancel={() => setRetiradoModal({ open: false })}
        onConfirm={() => {
          if (retiradoModal.productId) {
            setProductSituation(retiradoModal.productId, "Retirado");
            toast.success(
              "Produto retirado — enviado ao estoque central da loja.",
            );
          }
          setRetiradoModal({ open: false });
        }}
      />
    </section>
  );
}

const STATUS_FILTER_KEY = "stargames:product-status-filter";
const SITUATION_FILTER_KEY = "stargames:product-situation-filter";
const FILTERABLE_SITUATIONS: Situation[] = [
  "Em Aberto",
  "Enviado",
  "Removido",
  "Retirado",
];

function readStoredStatusFilter(): FinancialStatus[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STATUS_FILTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const allowed = ["Pago", "Reserva", "Pendente"];
    return parsed.filter(
      (v): v is FinancialStatus => typeof v === "string" && allowed.includes(v),
    );
  } catch {
    return [];
  }
}

function writeStoredStatusFilter(values: FinancialStatus[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATUS_FILTER_KEY, JSON.stringify(values));
  } catch {
    /* storage indisponível: filtro segue apenas em memória */
  }
}

function readStoredSituationFilter(): Situation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SITUATION_FILTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is Situation =>
        typeof v === "string" && (FILTERABLE_SITUATIONS as string[]).includes(v),
    );
  } catch {
    return [];
  }
}

function writeStoredSituationFilter(values: Situation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SITUATION_FILTER_KEY, JSON.stringify(values));
  } catch {
    /* storage indisponível: filtro segue apenas em memória */
  }
}

function ClientDrawer({
  client,
  products,
  onEdit,
  onAddProduct,
  onDeleteClient,
  onSaveNotes,
  onCustomerData,
  onRegisterPayment,
  onChangeSituation,
  onRequestRetirado,
  onMarkPaid,
  onPayMGMVInstallment,
  onRegisterMGMVPartialPayment,
}: {
  client: Client;
  products: Product[];
  onEdit: () => void;
  onAddProduct: () => void;
  onDeleteClient: () => void | Promise<void>;
  onSaveNotes: (notes: string) => void;
  onCustomerData: () => void;
  onRegisterPayment: (productId: string, remaining: number) => void;
  onChangeSituation: (productId: string, s: Situation) => void;
  onRequestRetirado: (productId: string) => void;
  onMarkPaid: (p: Product) => void;
  onPayMGMVInstallment: (installmentNumber: number) => void;
  onRegisterMGMVPartialPayment: (
    installmentNumber: number,
    amount: number,
  ) => PartialPaymentResult | void;
}) {
  const [notes, setNotes] = useState(client.notes ?? "");
  const [mgmvCreateOpen, setMgmvCreateOpen] = useState(false);
  const [mgmvEditOpen, setMgmvEditOpen] = useState(false);
  const [mgmvCompleteOpen, setMgmvCompleteOpen] = useState(false);
  const completeMGMVAgreement = useStore((s) => s.completeMGMVAgreement);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Seleção múltipla de produtos individuais para ações em lote (Pago /
  // Enviado / Retirar / Removido). Só o clique nos botões da barra aplica;
  // marcar o checkbox nunca altera status sozinho.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Filtro por status no Histórico de Produtos. Conjunto vazio = mostrar
  // todos. Persistido em localStorage para sobreviver à troca de tela.
  const [statusFilter, setStatusFilter] = useState<Set<FinancialStatus>>(
    () => new Set(readStoredStatusFilter()),
  );
  useEffect(() => {
    writeStoredStatusFilter([...statusFilter]);
  }, [statusFilter]);
  const [situationFilter, setSituationFilter] = useState<Set<Situation>>(
    () => new Set(readStoredSituationFilter()),
  );
  useEffect(() => {
    writeStoredSituationFilter([...situationFilter]);
  }, [situationFilter]);
  // Ao concluir o MGMV, os itens viram individuais (Pago / Em Aberto). Se
  // houver filtro salvo escondendo esses estados, limpamos para que os
  // produtos recém-convertidos apareçam na hora no histórico individual.
  const completedAt = client.mgmv?.completedAt;
  useEffect(() => {
    if (!completedAt) return;
    setStatusFilter((prev) => (prev.size === 0 || prev.has("Pago") ? prev : new Set()));
    setSituationFilter((prev) =>
      prev.size === 0 || prev.has("Em Aberto") ? prev : new Set(),
    );
  }, [completedAt]);
  const toggleSituationFilter = (s: Situation) => {
    setSituationFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };
  const toggleStatusFilter = (st: FinancialStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return next;
    });
  };
  const [nfModalOpen, setNfModalOpen] = useState(false);
  const [nfProducts, setNfProducts] = useState<Product[]>([]);
  const [nfWarnOpen, setNfWarnOpen] = useState(false);
  const [nfPendingSelection, setNfPendingSelection] = useState<Product[]>([]);
  const [nfHistoryOpen, setNfHistoryOpen] = useState(false);
  const listInvoicesFn = useServerFn(listNfInvoices);
  const [nfInvoices, setNfInvoices] = useState<NfInvoiceRow[]>([]);
  const refreshNfInvoices = useMemo(
    () => async () => {
      try {
        const rows = await listInvoicesFn({ data: { clientId: client.id } });
        setNfInvoices(rows);
      } catch {
        /* silencioso: badge é informativo */
      }
    },
    [listInvoicesFn, client.id],
  );
  useEffect(() => {
    void refreshNfInvoices();
  }, [refreshNfInvoices]);
  const nfProductMap = useMemo(() => {
    const map = new Map<string, { count: number; lastAt: string }>();
    for (const inv of nfInvoices) {
      for (const pid of inv.productIds) {
        const cur = map.get(pid);
        if (!cur) {
          map.set(pid, { count: 1, lastAt: inv.createdAt });
        } else {
          cur.count += 1;
          if (new Date(inv.createdAt) > new Date(cur.lastAt)) cur.lastAt = inv.createdAt;
        }
      }
    }
    return map;
  }, [nfInvoices]);
  const updateProduct = useStore((s) => s.updateProduct);
  const deleteProducts = useStore((s) => s.deleteProducts);
  const [deletingProducts, setDeletingProducts] = useState(false);
  // Edição por lápis dos produtos do cliente. Apenas Confirmar persiste;
  // Fechar descarta. Blur / click-outside são ignorados pelo hook.
  const productEdit = useRowEdit<{
    name: string;
    platform: string;
    totalValue: number;
    paidValue: number;
    financialStatus: FinancialStatus;
    situation: Situation;
    registerDate: string;
    dueDate: string;
    notes: string;
  }>();
  const mgmv = getMGMVDisplay(client);
  // Ordena produtos do mais recente para o mais antigo (por data de
  // cadastro), tanto individuais quanto os incluídos no acordo MGMV.
  const byRegisterDateDesc = (a: Product, b: Product) =>
    (b.registerDate ?? "").localeCompare(a.registerDate ?? "");
  const sortedProducts = [...products].sort(byRegisterDateDesc);
  const mgmvProducts = sortedProducts.filter((p) => p.financialStatus === "MGMV");
  const individualAll = sortedProducts.filter((p) => p.financialStatus !== "MGMV");
  // Retirado = arquivado: sai da lista ativa e migra para o histórico do
  // cliente. Mantido nas somas totais para não perder o histórico financeiro.
  const individualProducts = individualAll.filter(
    (p) =>
      (!isProductArchived(p) || situationFilter.has("Retirado")) &&
      (statusFilter.size === 0 || statusFilter.has(p.financialStatus)) &&
      (situationFilter.size === 0 || situationFilter.has(p.situation)),
  );
  // Contagem por status (ignora o filtro atual) para exibir ao lado dos botões.
  const statusCounts = individualAll.reduce<Record<string, number>>((acc, p) => {
    if (isProductArchived(p)) return acc;
    acc[p.financialStatus] = (acc[p.financialStatus] ?? 0) + 1;
    return acc;
  }, {});
  // Contagem por situação (considera também os arquivados/Retirado).
  const situationCounts = individualAll.reduce<Record<string, number>>((acc, p) => {
    acc[p.situation] = (acc[p.situation] ?? 0) + 1;
    return acc;
  }, {});
  const archivedProducts = individualAll.filter((p) => isProductArchived(p));
  // Sincroniza seleção: remove ids que sumiram da lista ativa (ex.: produto
  // virou Removido/Retirado e foi arquivado).
  useEffect(() => {
    setSelectedIds((prev) => {
      const alive = new Set(individualProducts.map((p) => p.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (alive.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [individualProducts]);
  const selectedCount = selectedIds.size;
  const allSelected =
    individualProducts.length > 0 && selectedCount === individualProducts.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedIds(
      allSelected ? new Set() : new Set(individualProducts.map((p) => p.id)),
    );
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectedProducts = () =>
    individualProducts.filter((p) => selectedIds.has(p.id));
  // Produtos da seleção que já tiveram NF emitida (bloqueio de duplicidade).
  const selectedDuplicates = useMemo<DuplicateNfProduct[]>(() => {
    return individualProducts
      .filter((p) => selectedIds.has(p.id) && nfProductMap.has(p.id))
      .map((p) => {
        const info = nfProductMap.get(p.id)!;
        return { id: p.id, name: p.name, count: info.count, lastAt: info.lastAt };
      });
  }, [individualProducts, selectedIds, nfProductMap]);
  const openNfModalWith = (list: Product[]) => {
    setNfProducts(list);
    setNfModalOpen(true);
  };
  const handleGerarNf = () => {
    const sel = selectedProducts();
    if (sel.length === 0) {
      toast.info("Selecione ao menos 1 produto");
      return;
    }
    const dupIds = new Set(selectedDuplicates.map((d) => d.id));
    if (dupIds.size === 0) {
      openNfModalWith(sel);
      return;
    }
    setNfPendingSelection(sel);
    setNfWarnOpen(true);
  };
  const bulkMarkPaid = () => {
    const targets = selectedProducts().filter((p) => p.financialStatus !== "Pago");
    if (targets.length === 0) {
      toast.info("Nenhum produto pendente na seleção");
      return;
    }
    targets.forEach((p) => onMarkPaid(p));
    toast.success(`${targets.length} produto(s) marcados como pagos`);
    clearSelection();
  };
  const bulkChangeSituation = (situation: Situation, confirmMsg: string) => {
    const targets = selectedProducts();
    if (targets.length === 0) return;
    if (!window.confirm(confirmMsg)) return;
    targets.forEach((p) => onChangeSituation(p.id, situation));
    toast.success(`${targets.length} produto(s) atualizados`);
    clearSelection();
  };
  const bulkAddToMgmv = () => {
    if (!client.mgmv) {
      toast.error("Este cliente não possui acordo MGMV ativo.");
      return;
    }
    const targets = selectedProducts().filter((p) => p.financialStatus !== "MGMV");
    if (targets.length === 0) {
      toast.info("Nenhum produto individual selecionado para adicionar ao acordo.");
      return;
    }
    if (
      !window.confirm(
        `Adicionar ${targets.length} produto(s) selecionado(s) ao acordo MGMV?`,
      )
    )
      return;
    targets.forEach((p) => updateProduct(p.id, { financialStatus: "MGMV" }));
    toast.success(`${targets.length} produto(s) adicionado(s) ao acordo MGMV`);
    clearSelection();
  };
  const bulkCopy = async () => {
    const targets = selectedProducts();
    if (targets.length === 0) return;
    const text = targets
      .map((p) => `${p.name} - ${p.platform} - ${formatBRL(p.totalValue)}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${targets.length} produto(s) copiado(s)`);
    } catch {
      toast.error("Não foi possível copiar para a área de transferência");
    }
  };
  // Exclusão definitiva — usada quando um item foi importado em duplicidade
  // por engano e não deve permanecer no histórico do cliente.
  const bulkDelete = async () => {
    const targets = selectedProducts();
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `Excluir definitivamente ${targets.length} produto(s) selecionado(s)?\n\n` +
          targets.map((p) => `• ${p.name} — ${formatBRL(p.totalValue)}`).join("\n") +
          "\n\nEsta ação não pode ser desfeita.",
      )
    )
      return;
    setDeletingProducts(true);
    try {
      await deleteProducts(targets.map((p) => p.id));
      toast.success(`${targets.length} produto(s) excluído(s)`);
      clearSelection();
    } catch {
      toast.error("Não foi possível excluir os produtos");
    } finally {
      setDeletingProducts(false);
    }
  };
  const financialSummary = calculateClientFinancialSummary(client, products);
  const totalBought = financialSummary.totalPurchased;
  const totalPaid = financialSummary.totalPaid;
  const totalRest = financialSummary.totalRemaining;
  const pctPaid =
    mgmv && mgmv.installmentsTotal > 0
      ? Math.round((mgmv.installmentsPaid / mgmv.installmentsTotal) * 100)
      : 0;
  const mgmvPendingCount = client.mgmv
    ? client.mgmv.installments.filter((i) => !i.paid).length
    : 0;
  const mgmvAgreementRemaining = financialSummary.mgmvRemaining;

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle className="text-2xl">{client.name}</DialogTitle>
        <DialogDescription>Telefone: {client.phone}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          Editar Cliente
        </Button>
        <Button size="sm" onClick={onAddProduct}>
          Adicionar Produto
        </Button>
        <Button size="sm" variant="outline" onClick={onCustomerData}>
          {isFichaComplete(client.customerData)
            ? "Abrir Ficha do Cliente"
            : "Preencher Dados do Cliente"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setNfHistoryOpen(true)}
        >
          Notas Fiscais
        </Button>
        {!client.mgmv && products.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setMgmvCreateOpen(true)}>
            Criar acordo MGMV
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border/60 bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
          HTML original do Notion
        </div>
        {client.originalHtmlStoragePath ? (
          <NotionHtmlActions
            clientId={client.id}
            fileName={client.originalHtmlFileName}
            path={client.originalHtmlStoragePath}
            importedAt={client.originalHtmlImportedAt}
            sourceFolder={client.originalHtmlSourceFolder}
          />
        ) : (
          <p className="text-[11px] italic text-muted-foreground">
            HTML original não disponível — reimporte este cliente pelo ZIP do Notion para salvar o arquivo automaticamente.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <MetricCard label="Total Comprado" value={formatBRL(totalBought)} />
        <MetricCard label="Valor Pago" value={formatBRL(totalPaid)} status="success" />
        <MetricCard label="Valor Restante" value={formatBRL(totalRest)} status="danger" />
        <MetricCard label="Produtos" value={products.length} />
        <MetricCard
          label="MGMV"
          value={client.mgmv ? "Ativo" : "Inativo"}
          status={client.mgmv ? "primary" : "default"}
        />
      </div>

      <Card title="Observações">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20" />
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => onSaveNotes(notes)}>
            Salvar Observação
          </Button>
        </div>
      </Card>

      {mgmvCreateOpen && (
        <MgmvCreateModal
          open={mgmvCreateOpen}
          onClose={() => setMgmvCreateOpen(false)}
          client={client}
          products={products}
        />
      )}

      {mgmvCompleteOpen && client.mgmv && (
        <MgmvCompleteModal
          open={true}
          clientName={client.name}
          agreement={client.mgmv}
          products={mgmvProducts}
          onClose={() => setMgmvCompleteOpen(false)}
          onReview={() => {
            setMgmvCompleteOpen(false);
            setMgmvEditOpen(true);
          }}
          onConfirm={() => {
            const res = completeMGMVAgreement(client.id);
            setMgmvCompleteOpen(false);
            if (res.ok) {
              toast.success(
                `MGMV concluído. ${res.movedProducts} produto(s) agora estão como Pago / Em Aberto.`,
              );
            } else {
              toast.error("Não foi possível concluir o acordo.");
            }
          }}
        />
      )}
      {mgmv && (
        <Card
          title={`Acordo MGMV — ${mgmv.status}`}
          action={
            client.mgmv && !mgmvEditOpen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMgmvEditOpen(true)}
              >
                <Pencil className="mr-1 size-3" /> Editar acordo
              </Button>
            ) : null
          }
        >
          {mgmvEditOpen && client.mgmv ? (
            <MgmvAgreementEditor
              clientId={client.id}
              agreement={client.mgmv}
              products={mgmvProducts}
              availableProducts={individualAll}
              onClose={() => setMgmvEditOpen(false)}
            />
          ) : (
          <>
          {client.mgmv &&
            !client.mgmv.completedAt &&
            isAgreementFullyPaid(client.mgmv) && (
              <MgmvFullyPaidBanner
                onReview={() => setMgmvEditOpen(true)}
                onComplete={() => setMgmvCompleteOpen(true)}
              />
            )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <MetricCard
              label="Valor total do acordo"
              value={formatBRL(mgmv.totalDebt)}
              status="primary"
            />
            <MetricCard
              label="Parcelas"
              value={`${mgmv.installmentsTotal}x de ${formatBRL(mgmv.installmentValue)}`}
            />
            <MetricCard
              label="Parcelas pagas"
              value={`${mgmv.installmentsPaid}/${mgmv.installmentsTotal}`}
              status="success"
            />
            <MetricCard
              label="Próximo vencimento"
              value={mgmv.nextInstallment ? formatDateBR(mgmv.nextInstallment.dueDate) : "—"}
              status={mgmv.hasOverdue ? "danger" : undefined}
            />
            <MetricCard
              label="Saldo restante"
              value={formatBRL(mgmv.remainingBalance)}
              status="danger"
            />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{pctPaid}% quitado</span>
              <span>
                {mgmv.installmentsPaid} de {mgmv.installmentsTotal} parcelas
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pctPaid}%` }}
              />
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Parcela</th>
                  <th className="py-2 pr-3 font-medium">Vencimento</th>
                  <th className="py-2 pr-3 font-medium">Valor</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Valor pago</th>
                  <th className="py-2 pr-3 font-medium">Pagamento</th>
                  <th className="py-2 pr-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {client.mgmv?.installments.map((i) => {
                  const overdue = !i.paid && isOverdue(i.dueDate);
                   const isPartial = !i.paid && (i.paidAmount ?? 0) > 0;
                   const pagoNaParcela = i.paid
                     ? (i.paidAmount ?? i.value)
                     : (i.paidAmount ?? 0);
                   const label = i.paid
                     ? "Pago"
                     : isPartial
                       ? `Parcial ${formatBRL(i.paidAmount ?? 0)}`
                       : overdue
                         ? "Vencido"
                         : "Pendente";
                  const variant: "success" | "primary" | "danger" | "warning" = i.paid
                    ? "success"
                    : isPartial
                      ? "primary"
                      : overdue
                        ? "danger"
                        : "warning";
                  return (
                    <tr key={i.number} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        {i.number}/{i.total}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{formatDateBR(i.dueDate)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatBRL(i.value)}</td>
                      <td className="py-2 pr-3">
                        <Tag variant={variant}>{label}</Tag>
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
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {pagoNaParcela > 0 ? (
                          formatBRL(pagoNaParcela)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {i.paidAt ? formatDateBR(i.paidAt) : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {!i.paid && !isPartial && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              onClick={() => onPayMGMVInstallment(i.number)}
                            >
                              Marcar como paga
                            </Button>
                            <MgmvPartialPaymentPopover
                              clientId={client.id}
                              installmentNumber={i.number}
                              installmentValue={i.value}
                              currentPartial={i.paidAmount ?? 0}
                              agreementRemaining={mgmvAgreementRemaining}
                              pendingCount={mgmvPendingCount}
                              onSubmit={(amount) =>
                                onRegisterMGMVPartialPayment(i.number, amount)
                              }
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {client.mgmv && !client.mgmv.completedAt && (
            <div className="mt-6">
              <h4 className="mb-2 text-sm font-semibold">
                Itens incluídos no MGMV
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (informativo — a cobrança é feita pela parcela do acordo)
                </span>
              </h4>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Produto</th>
                      <th className="py-2 px-3 font-medium">Plataforma</th>
                      <th className="py-2 px-3 font-medium">Valor Total</th>
                      <th className="py-2 px-3 font-medium">Valor Pago</th>
                      <th className="py-2 px-3 font-medium">Restante incluído</th>
                      <th className="py-2 px-3 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mgmvProducts.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-4 px-3 text-center text-xs text-muted-foreground"
                        >
                          Nenhum item carregado para este acordo no momento.
                        </td>
                      </tr>
                    )}
                    {mgmvProducts.map((p) => (
                       <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 px-3 font-medium">
                          <span className="inline-flex items-center">
                            {p.name}
                            {(() => {
                              const info = nfProductMap.get(p.id);
                              return info ? (
                                <NfEmittedBadge count={info.count} lastAt={info.lastAt} />
                              ) : null;
                            })()}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{p.platform}</td>
                        <td className="py-2 px-3 tabular-nums">{formatBRL(p.totalValue)}</td>
                        <td className="py-2 px-3 tabular-nums text-muted-foreground">
                          {formatBRL(p.paidValue)}
                        </td>
                        <td className="py-2 px-3 tabular-nums">
                          {formatBRL(Math.max(0, p.totalValue - p.paidValue))}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {formatDateBR(p.registerDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>
          )}
        </Card>
      )}

      <Card title={`Histórico de Produtos${mgmvProducts.length > 0 ? " — Individuais" : ""}`}>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">
            Filtrar por status:
          </span>
          {(["Pago", "Reserva", "Pendente"] as FinancialStatus[]).map((st) => {
            const active = statusFilter.has(st);
            const tone =
              st === "Pago"
                ? "border-[color:var(--success)]/40 bg-[color:var(--success)]/10 text-[color:var(--success)]"
                : st === "Reserva"
                  ? "border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                  : "border-destructive/40 bg-destructive/10 text-destructive";
            return (
              <button
                key={st}
                type="button"
                onClick={() => toggleStatusFilter(st)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  active
                    ? tone
                    : "border-border bg-transparent text-muted-foreground hover:bg-muted/50",
                )}
              >
                {st}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {statusCounts[st] ?? 0}
                </span>
              </button>
            );
          })}
          <span className="ml-2 mr-1 text-xs font-medium text-muted-foreground">
            Situação:
          </span>
          {FILTERABLE_SITUATIONS.map((s) => {
            const active = situationFilter.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSituationFilter(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  active
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-transparent text-muted-foreground hover:bg-muted/50",
                )}
              >
                {displaySituation(s)}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {situationCounts[s] ?? 0}
                </span>
              </button>
            );
          })}
          {(statusFilter.size > 0 || situationFilter.size > 0) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter(new Set());
                setSituationFilter(new Set());
              }}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50"
            >
              Limpar filtro
            </button>
          )}
          {(statusFilter.size > 0 || situationFilter.size > 0) && (
            <span className="text-xs text-muted-foreground">
              ({individualProducts.length} exibido(s))
            </span>
          )}
        </div>
        <ProductBulkActionsBar
          selectedCount={selectedCount}
          duplicateCount={selectedDuplicates.length}
          deleting={deletingProducts}
          onCopy={() => void bulkCopy()}
          onMarkPaid={bulkMarkPaid}
          onAddToMgmv={bulkAddToMgmv}
          addToMgmvDisabled={!client.mgmv}
          addToMgmvTitle={
            client.mgmv
              ? "Adicionar produtos selecionados ao acordo MGMV"
              : "Cliente sem acordo MGMV ativo"
          }
          onEnviado={() =>
            bulkChangeSituation(
              "Enviado",
              `Marcar ${selectedCount} produto(s) selecionado(s) como Enviado?`,
            )
          }
          onRetirar={() =>
            bulkChangeSituation(
              "Retirar",
              `Marcar ${selectedCount} produto(s) selecionado(s) para retirada?\n\nEles continuam vinculados ao cliente, mas ficam pendentes de retirada.`,
            )
          }
          onRemovido={() =>
            bulkChangeSituation(
              "Removido",
              `Marcar ${selectedCount} produto(s) selecionado(s) como Removido?\n\nEles saem da lista ativa do cliente.`,
            )
          }
          onClear={clearSelection}
          onDelete={() => void bulkDelete()}
          onGerarNf={handleGerarNf}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2 font-medium w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    className="h-4 w-4 cursor-pointer"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    disabled={individualProducts.length === 0}
                  />
                </th>
                <th className="py-2 pr-3 font-medium">Produto</th>
                <th className="py-2 pr-3 font-medium">Plataforma</th>
                <th className="py-2 pr-3 font-medium">Total</th>
                <th className="py-2 pr-3 font-medium">Pago</th>
                <th className="py-2 pr-3 font-medium">Restante</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 pr-3 font-medium">Cadastro</th>
                <th className="py-2 pr-3 font-medium">Limite</th>
                <th className="py-2 pr-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {individualProducts.map((p) => {
                const remaining = p.totalValue - p.paidValue;
                const status = productCollectionStatus(p);
                const editing = productEdit.isEditing(p.id);
                const draft = productEdit.draftValues;
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      productStatusTone(p),
                    )}
                  >
                    <td className="py-2 pr-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${p.name}`}
                        className="h-4 w-4 cursor-pointer"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                      />
                    </td>
                    <td className="py-2 pr-3 font-medium">
                      {editing ? (
                        <input
                          className="h-8 w-full min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
                          value={draft?.name ?? ""}
                          onChange={(e) => productEdit.setField("name", e.target.value)}
                          aria-label="Editar nome do produto"
                        />
                      ) : (
                        <span className="inline-flex items-center">
                          {p.name}
                          {(() => {
                            const info = nfProductMap.get(p.id);
                            return info ? (
                              <NfEmittedBadge count={info.count} lastAt={info.lastAt} />
                            ) : null;
                          })()}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {editing ? (
                        <input
                          className="h-8 w-full min-w-[6rem] rounded-md border border-input bg-background px-2 text-sm"
                          value={draft?.platform ?? ""}
                          onChange={(e) => productEdit.setField("platform", e.target.value)}
                          aria-label="Editar plataforma"
                        />
                      ) : (
                        p.platform
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                          value={draft?.totalValue ?? 0}
                          onChange={(e) =>
                            productEdit.setField("totalValue", Number(e.target.value))
                          }
                          aria-label="Editar valor total"
                        />
                      ) : (
                        formatBRL(p.totalValue)
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {editing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                          value={draft?.paidValue ?? 0}
                          onChange={(e) =>
                            productEdit.setField("paidValue", Number(e.target.value))
                          }
                          aria-label="Editar valor pago"
                        />
                      ) : (
                        formatBRL(p.paidValue)
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{formatBRL(remaining)}</td>
                    <td className="py-2 pr-3">
                      <Tag
                        variant={productStatusVariant(p)}
                        className={productStatusTextTone(p)}
                      >
                        {status.label}
                      </Tag>
                    </td>
                    <td className="py-2 pr-3">
                      {editing ? (
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={draft?.situation ?? p.situation}
                          onChange={(e) =>
                            productEdit.setField("situation", e.target.value as Situation)
                          }
                          aria-label="Editar situação"
                        >
                          {(
                            [
                              "Em Aberto",
                              "Enviado",
                              "Retirado",
                              "Retirar",
                              "Removido",
                              "Desistiu",
                              "Abandonou",
                              "Resolvido",
                            ] as Situation[]
                          ).map((s) => (
                            <option key={s} value={s}>
                              {displaySituation(s)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Tag>{displaySituation(p.situation)}</Tag>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {editing ? (
                        <input
                          type="date"
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={(draft?.registerDate ?? p.registerDate).slice(0, 10)}
                          onChange={(e) =>
                            productEdit.setField(
                              "registerDate",
                              new Date(`${e.target.value}T12:00:00`).toISOString(),
                            )
                          }
                          aria-label="Editar data de cadastro"
                        />
                      ) : (
                        formatDateBR(p.registerDate)
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {editing ? (
                        <input
                          type="date"
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={(draft?.dueDate ?? p.dueDate).slice(0, 10)}
                          onChange={(e) =>
                            productEdit.setField(
                              "dueDate",
                              new Date(`${e.target.value}T12:00:00`).toISOString(),
                            )
                          }
                          aria-label="Editar limite"
                        />
                      ) : (
                        getProductDisplayDueDate(p)
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {editing ? (
                          <RowEditActions
                            onConfirm={() =>
                              productEdit.confirm(
                                (d) => {
                                  const total = Math.max(0, d.totalValue);
                                  const paid = Math.max(0, d.paidValue);
                                  const nextStatus =
                                    d.financialStatus === "MGMV"
                                      ? "MGMV"
                                      : calculateFinancialStatus(total, paid);
                                  updateProduct(p.id, {
                                    name: d.name.trim(),
                                    platform: d.platform.trim(),
                                    totalValue: total,
                                    paidValue: paid,
                                    financialStatus: nextStatus,
                                    situation: d.situation,
                                    registerDate: d.registerDate,
                                    dueDate: d.dueDate,
                                    notes: d.notes,
                                  });
                                  toast.success("Produto atualizado");
                                },
                                {
                                  validate: (d) => {
                                    if (!d.name.trim()) return "Nome é obrigatório.";
                                    if (!Number.isFinite(d.totalValue) || d.totalValue < 0)
                                      return "Valor total inválido.";
                                    if (!Number.isFinite(d.paidValue) || d.paidValue < 0)
                                      return "Valor pago inválido.";
                                    if (d.paidValue > d.totalValue)
                                      return "Valor pago não pode exceder o total.";
                                    return null;
                                  },
                                },
                              )
                            }
                            onClose={productEdit.close}
                          />
                        ) : (
                          <RowEditPencil
                            label="Editar produto"
                            onStart={() =>
                              productEdit.startEdit(p.id, {
                                name: p.name,
                                platform: p.platform,
                                totalValue: p.totalValue,
                                paidValue: p.paidValue,
                                financialStatus: p.financialStatus,
                                situation: p.situation,
                                registerDate: p.registerDate,
                                dueDate: p.dueDate,
                                notes: p.notes ?? "",
                              })
                            }
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {individualProducts.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-muted-foreground">
                    Nenhum produto.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {archivedProducts.length > 0 && (
        <Card className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-muted-foreground">
              Histórico de produtos retirados
            </h4>
            <span className="text-xs text-muted-foreground">
              {archivedProducts.length} produto(s) — devolvidos ao estoque
              central
            </span>
          </div>
          <ul className="divide-y divide-border/60 text-sm">
            {archivedProducts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    <span className="inline-flex items-center">
                      {p.name}
                      {(() => {
                        const info = nfProductMap.get(p.id);
                        return info ? (
                          <NfEmittedBadge count={info.count} lastAt={info.lastAt} />
                        ) : null;
                      })()}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.platform || "—"} · {formatBRL(p.totalValue)} ·{" "}
                    {formatDateBR(p.registerDate)}
                  </div>
                </div>
                <Tag>Retirado</Tag>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="border-destructive/40 bg-destructive/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              Zona de perigo
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Excluir o cliente remove seus produtos, acordo MGMV e histórico
              vinculado. Ação irreversível.
            </p>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDeleteConfirmText("");
              setDeleteConfirmOpen(true);
            }}
          >
            <Trash2 className="mr-1 size-4" />
            Excluir cliente
          </Button>
        </div>
      </Card>

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(v) => {
          if (!v) {
            setDeleteConfirmOpen(false);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Excluir cliente
            </DialogTitle>
            <DialogDescription>
              Você vai excluir permanentemente <strong>{client.name}</strong> e
              todos os produtos, acordo MGMV e histórico vinculado. Essa ação
              não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-client-confirm-input">
              Digite{" "}
              <span className="font-mono font-semibold text-destructive">
                EXCLUIR
              </span>{" "}
              para confirmar.
            </Label>
            <Input
              id="delete-client-confirm-input"
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              maxLength={20}
              disabled={deleting}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "EXCLUIR" || deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await onDeleteClient();
                  setDeleteConfirmOpen(false);
                  setDeleteConfirmText("");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Excluindo…" : "Confirmar exclusão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NfDuplicateWarningModal
        open={nfWarnOpen}
        duplicates={selectedDuplicates}
        freshCount={
          nfPendingSelection.filter((p) => !nfProductMap.has(p.id)).length
        }
        onClose={() => setNfWarnOpen(false)}
        onContinueWithoutDuplicates={() => {
          setNfWarnOpen(false);
          openNfModalWith(nfPendingSelection.filter((p) => !nfProductMap.has(p.id)));
        }}
        onForceAll={() => {
          setNfWarnOpen(false);
          openNfModalWith(nfPendingSelection);
        }}
      />
      <NfFormatModal
        open={nfModalOpen}
        onClose={() => setNfModalOpen(false)}
        onSaved={() => {
          void refreshNfInvoices();
        }}
        client={client}
        products={nfProducts.map((p) => ({
          id: p.id,
          name: p.name,
          platform: p.platform ?? "",
          totalValue: p.totalValue,
        }))}
      />
      <NfHistoryModal
        open={nfHistoryOpen}
        onClose={() => setNfHistoryOpen(false)}
        clientId={client.id}
        clientName={client.name}
      />
    </div>
  );
}

function ClientModal({
  state,
  onClose,
  onSave,
}: {
  state: { open: boolean; client?: Client | null };
  onClose: () => void;
  onSave: (data: { name: string; phone: string; notes?: string }) => void;
}) {
  const [name, setName] = useState(state.client?.name ?? "");
  const [phone, setPhone] = useState(state.client?.phone ?? "");
  const [notes, setNotes] = useState(state.client?.notes ?? "");

  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else {
          setName(state.client?.name ?? "");
          setPhone(state.client?.phone ?? "");
          setNotes(state.client?.notes ?? "");
        }
      }}
    >
 <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl">
            {state.client ? "Editar Cliente" : "Adicionar Cliente"}
          </DialogTitle>
          <DialogDescription>O telefone é o identificador principal do cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nome completo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Telefone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11 99999-9999"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!name.trim() || !phone.trim()) return toast.error("Nome e telefone obrigatórios");
              onSave({ name: name.trim(), phone: phone.trim(), notes: notes.trim() || undefined });
            }}
          >
            Salvar Cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// NotionHtmlActions foi movido para @/components/notion-html-actions.

function ProductModal({
  state,
  clients,
  onClose,
  onSave,
}: {
  state: { open: boolean; clientId?: string; product?: Product | null };
  clients: Client[];
  onClose: () => void;
  onSave: (clientId: string, data: Omit<Product, "id" | "clientId">) => void;
}) {
  const initial = state.product;
  const [clientId, setClientId] = useState(state.clientId ?? clients[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [platform, setPlatform] = useState(initial?.platform ?? "PS5");
  const [totalValue, setTotalValue] = useState(initial?.totalValue ?? 0);
  const [paidValue, setPaidValue] = useState(initial?.paidValue ?? 0);
  const [registerDate, setRegisterDate] = useState(
    (initial?.registerDate ?? new Date().toISOString()).slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(
    (initial?.dueDate ?? new Date(Date.now() + 30 * 86400000).toISOString()).slice(0, 10),
  );
  const [financialStatus, setFinancialStatus] = useState<FinancialStatus>(
    initial?.financialStatus ?? "Reserva",
  );
  const [situation, setSituation] = useState<Situation>(initial?.situation ?? "Em Aberto");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const client = clients.find((c) => c.id === clientId);
  const mgmvActive = !!client?.mgmv && client.mgmv.installments.some((i) => !i.paid);
  const blockReserva = mgmvActive && financialStatus === "Reserva" && !initial;
  const remaining = Math.max(0, Number(totalValue) - Number(paidValue));

  // Auto-sincroniza o status financeiro com base nos valores (exceto MGMV).
  useEffect(() => {
    if (financialStatus === "MGMV") return;
    const computed = calculateFinancialStatus(totalValue, paidValue);
    if (computed !== financialStatus) setFinancialStatus(computed);
  }, [totalValue, paidValue, financialStatus]);

  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else {
          const p = state.product;
          setClientId(state.clientId ?? clients[0]?.id ?? "");
          setName(p?.name ?? "");
          setPlatform(p?.platform ?? "PS5");
          setTotalValue(p?.totalValue ?? 0);
          setPaidValue(p?.paidValue ?? 0);
          setRegisterDate((p?.registerDate ?? new Date().toISOString()).slice(0, 10));
          setDueDate(
            (p?.dueDate ?? new Date(Date.now() + 30 * 86400000).toISOString()).slice(0, 10),
          );
          setFinancialStatus(p?.financialStatus ?? "Reserva");
          setSituation(p?.situation ?? "Em Aberto");
          setNotes(p?.notes ?? "");
        }
      }}
    >
 <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl">
            {initial ? "Editar Produto" : "Adicionar Produto"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Cliente vinculado</Label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.phone}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Nome do produto</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Plataforma</Label>
            <Input value={platform} onChange={(e) => setPlatform(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor total</Label>
            <Input
              type="number"
              value={totalValue}
              onChange={(e) => setTotalValue(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor pago</Label>
            <Input
              type="number"
              value={paidValue}
              onChange={(e) => setPaidValue(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor restante</Label>
            <Input value={formatBRL(remaining)} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label>Data de cadastro</Label>
            <Input
              type="date"
              value={registerDate}
              onChange={(e) => {
                setRegisterDate(e.target.value);
                if (financialStatus === "Reserva") {
                  const d = new Date(e.target.value);
                  d.setDate(d.getDate() + 30);
                  setDueDate(d.toISOString().slice(0, 10));
                }
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Data limite</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Status financeiro</Label>
            <select
              value={financialStatus}
              onChange={(e) => {
                const s = e.target.value as FinancialStatus;
                setFinancialStatus(s);
                if (s === "Reserva") {
                  const d = new Date(registerDate);
                  d.setDate(d.getDate() + 30);
                  setDueDate(d.toISOString().slice(0, 10));
                }
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option>Pago</option>
              <option>Reserva</option>
              <option>Pendente</option>
              <option>MGMV</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Situação</Label>
            <select
              value={situation}
              onChange={(e) => setSituation(e.target.value as Situation)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option>Em Aberto</option>
              <option>Enviado</option>
              <option>Abandonou</option>
            </select>
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {financialStatus === "Reserva" && (
            <p className="md:col-span-2 text-xs text-muted-foreground">
              A Data Limite será calculada automaticamente em 30 dias após a Data de Cadastro.
            </p>
          )}
          {blockReserva && (
            <p className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              Cliente com MGMV ativo não pode realizar nova compra em Reserva.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={blockReserva}
            onClick={() => {
              if (!clientId || !name.trim() || !Number.isFinite(totalValue))
                return toast.error("Preencha os campos obrigatórios");
              onSave(clientId, {
                name: name.trim(),
                platform,
                totalValue: Number(totalValue),
                paidValue: Number(paidValue),
                financialStatus:
                  financialStatus === "MGMV"
                    ? "MGMV"
                    : calculateFinancialStatus(totalValue, paidValue),
                situation,
                registerDate: new Date(registerDate).toISOString(),
                dueDate: new Date(dueDate).toISOString(),
                notes: notes.trim() || undefined,
              });
            }}
          >
            Salvar Produto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
