import { useEffect, useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { StatusLegend } from "@/components/status-legend";
import { Button } from "@/components/ui/button";
import { usePaginatedList } from "@/hooks/use-paginated-list";
import { LoadMoreButton } from "@/components/load-more-button";
import {
  daysLate,
  displaySituation,
  formatBRL,
  formatDateBR,
  getMGMVDisplay,
  isOverdue,
  isOpenSituation,
  productCollectionStatus,
  shouldAppearInCollection,
  useStore,
  type Client,
  type Product,
  type MGMVDisplay,
} from "@/lib/store";
import { useEnsureData } from "@/lib/use-ensure-data";
import { toast } from "sonner";
import {
  MessageCircle,
  Filter as FilterIcon,
  Save,
  Trash2,
  Folder,
  X,
} from "lucide-react";
import { usePersistedState } from "@/lib/use-persisted-state";
// paginação client-side removida — mostrar todas as cobranças de uma vez
import { useRowEdit } from "@/lib/use-row-edit";
import { RowEditPencil, RowEditActions } from "@/components/row-edit-controls";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { highlight, matchText, ColumnMatchDot } from "@/lib/search-highlight";
import { productStatusTone, productStatusTextTone } from "@/lib/status-tone";
import { FilterEmptyState } from "@/components/filter-empty-state";
import { cn } from "@/lib/utils";

type Filter = "nenhum" | "reserva_vencida" | "pendente_vencido" | "mgmv" | "mgmv_vencido" | "em_aberto";

type Period =
  | "todos"
  | "hoje"
  | "7"
  | "15"
  | "30"
  | "mes"
  | "mes_passado"
  | "personalizado"
  | "maximo";


type SavedFilter = {
  id: string;
  name: string;
  filter: Filter;
  period: Period;
  customFrom: string;
  customTo: string;
};

export function CollectionSection({
  onScrollTo,
  initialFilter = "nenhum",
}: {
  onScrollTo: (id: string) => void;
  initialFilter?: Filter;
}) {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const registerPayment = useStore((s) => s.registerPayment);
  const openClient = useStore((s) => s.openClient);
  const payMGMVInstallment = useStore((s) => s.payMGMVInstallment);
  const updateProduct = useStore((s) => s.updateProduct);
  // Edição por lápis das cobranças. Só Confirmar persiste; Fechar descarta.
  // Blur / click-outside são ignorados (o hook não escuta esses eventos).
  //
  // Regra de status: linhas cobráveis são filtradas por `shouldAppearInCollection`
  // (situação `Em Aberto` + reserva/pendente + em atraso), portanto produtos
  // marcados como Abandonou / Retirar / Retirado nunca chegam nesta tabela —
  // a edição por definição não altera essas categorias.
  const collectionEdit = useRowEdit<{
    totalValue: number;
    paidValue: number;
    dueDate: string;
  }>();
  const [filter, setFilter] = usePersistedState<Filter>("collection.filter", initialFilter);
  const [period, setPeriod] = usePersistedState<Period>("collection.period", "todos");
  const [customFrom, setCustomFrom] = usePersistedState<string>("collection.customFrom", "");
  const [customTo, setCustomTo] = usePersistedState<string>("collection.customTo", "");
  const compact = true;
  const [payTarget, setPayTarget] = useState<{ id: string; remaining: number; productName: string } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  /**
   * Aplica filtro a partir do clique em um card de resumo na Collection.
   * Mantém o contexto da seção e expande a lista quando minimizada.
   */
  const applyCardFilter = (next: Filter) => {
    setFilter(next);
    setSearch("");
  };
  const [savedFilters, setSavedFilters] = usePersistedState<SavedFilter[]>("collection.savedFilters", []);
  const [activeSavedId, setActiveSavedId] = usePersistedState<string>("collection.activeSavedId", "");
  const [search, setSearch] = usePersistedState<string>("collection.search", "");
  const [folderFilter, setFolderFilter] = usePersistedState<string>("collection.folder", "Todas");
  const [financialFilter, setFinancialFilter] = usePersistedState<string>("collection.financial", "Todos");
  const [situationFilter, setSituationFilter] = usePersistedState<string>("collection.situation", "Todas");

  const activeFilterCount =
    (filter !== "nenhum" ? 1 : 0) +
    (period !== "todos" ? 1 : 0) +
    (period === "personalizado" && (customFrom || customTo) ? 1 : 0) +
    (folderFilter !== "Todas" ? 1 : 0) +
    (financialFilter !== "Todos" ? 1 : 0) +
    (situationFilter !== "Todas" ? 1 : 0);

  const folders = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.folder && c.folder.trim()) set.add(c.folder);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  }, [clients]);

  const overdueProducts = useMemo(() => products.filter(shouldAppearInCollection), [products]);

  // Acordos MGMV consolidados (1 linha por cliente com acordo ativo + parcelas vencidas)
  const mgmvRows = useMemo(() => {
    return clients
      .map((c) => {
        const d = getMGMVDisplay(c);
        // Todos os acordos MGMV ativos aparecem na cobrança.
        // O filtro "mgmv_vencido" restringe às parcelas vencidas.
        if (!d || !d.active) return null;
        return { client: c, display: d };
      })
      .filter(Boolean) as { client: Client; display: MGMVDisplay }[];
  }, [clients]);

  type RowItem =
    | { kind: "product"; product: Product }
    | { kind: "mgmv"; client: Client; display: MGMVDisplay };

  const allRows = useMemo<RowItem[]>(
    () => [
      ...mgmvRows.map<RowItem>((r) => ({ kind: "mgmv", client: r.client, display: r.display })),
      ...overdueProducts.map<RowItem>((p) => ({ kind: "product", product: p })),
    ],
    [mgmvRows, overdueProducts],
  );

  // Sem filtro/busca a lista não é montada — menos leitura desnecessária.
  const noFilterApplied =
    filter === "nenhum" &&
    search.trim().length === 0 &&
    period === "todos" &&
    folderFilter === "Todas" &&
    financialFilter === "Todos" &&
    situationFilter === "Todas";
  useEnsureData(!noFilterApplied);

  const filtered = useMemo(() => {
    if (noFilterApplied) return [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 86400000;
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return allRows.filter((row) => {
      // Filtro por tipo
      if (filter === "reserva_vencida")
        if (row.kind !== "product" || row.product.financialStatus !== "Reserva") return false;
      if (filter === "pendente_vencido")
        if (row.kind !== "product" || row.product.financialStatus !== "Pendente") return false;
      if (filter === "mgmv" || filter === "mgmv_vencido")
        if (row.kind !== "mgmv") return false;
      if (filter === "mgmv_vencido")
        if (row.kind !== "mgmv" || !row.display.hasOverdue) return false;
      if (filter === "em_aberto")
        if (row.kind === "product" && !isOpenSituation(row.product)) return false;

      // Filtros de pasta / status financeiro / situação
      const rowClient =
        row.kind === "mgmv" ? row.client : clients.find((c) => c.id === row.product.clientId);
      if (folderFilter !== "Todas") {
        if (folderFilter === "__sem__") {
          if (rowClient?.folder) return false;
        } else if (rowClient?.folder !== folderFilter) {
          return false;
        }
      }
      if (financialFilter !== "Todos") {
        if (financialFilter === "MGMV") {
          if (row.kind !== "mgmv") return false;
        } else if (row.kind !== "product" || row.product.financialStatus !== financialFilter) {
          return false;
        }
      }
      if (situationFilter !== "Todas") {
        if (row.kind !== "product" || row.product.situation !== situationFilter) return false;
      }

      // Busca textual
      if (q) {
        const productName = row.kind === "product" ? row.product.name : "Acordo MGMV";
        const platform = row.kind === "product" ? row.product.platform : "";
        const statusLabel =
          row.kind === "product"
            ? productCollectionStatus(row.product).label
            : row.display.hasOverdue
              ? "Parcela MGMV vencida"
              : "Parcela MGMV";
        const situation = row.kind === "product" ? row.product.situation : "MGMV";
        const dueIso =
          row.kind === "product"
            ? row.product.dueDate
            : row.display.nextInstallment?.dueDate ?? "";
        const openValue =
          row.kind === "product"
            ? Math.max(0, row.product.totalValue - row.product.paidValue)
            : row.display.remainingBalance;
        const hay = [
          rowClient?.name ?? "",
          rowClient?.folder ?? "",
          rowClient?.notes ?? "",
          productName,
          platform,
          statusLabel,
          situation,
          dueIso ? formatDateBR(dueIso) : "",
          formatBRL(openValue),
        ]
          .join(" ")
          .toLowerCase();
        const phoneDigits = (rowClient?.phone ?? "").replace(/\D/g, "");
        const matches =
          hay.includes(q) || (qDigits.length > 0 && phoneDigits.includes(qDigits));
        if (!matches) return false;
      }

      // Data de referência para o filtro de período
      const refIso =
        row.kind === "product"
          ? row.product.dueDate
          : row.display.nextInstallment?.dueDate ?? "";
      if (!refIso) return period === "todos" || period === "maximo";
      if (period !== "todos" && period !== "maximo") {
        const due = new Date(refIso);
        const dueTime = due.getTime();
        if (period === "hoje") {
          if (dueTime < startOfToday || dueTime >= endOfToday) return false;
        } else if (period === "7" || period === "15" || period === "30") {
          const days = Number(period);
          const minTime = startOfToday - days * 86400000;
          if (dueTime < minTime || dueTime >= endOfToday) return false;
        } else if (period === "mes") {
          if (due.getMonth() !== now.getMonth() || due.getFullYear() !== now.getFullYear()) return false;
        } else if (period === "mes_passado") {
          const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          if (due.getMonth() !== prev.getMonth() || due.getFullYear() !== prev.getFullYear()) return false;
        } else if (period === "personalizado") {
          if (customFrom) {
            const from = new Date(customFrom).getTime();
            if (dueTime < from) return false;
          }
          if (customTo) {
            const to = new Date(customTo).getTime() + 86400000;
            if (dueTime >= to) return false;
          }
        }
      }
      return true;
    });
  }, [noFilterApplied, allRows, filter, period, customFrom, customTo, search, folderFilter, financialFilter, situationFilter, clients]);

  const { visible, hasMore, nextChunk, loadMore } = usePaginatedList(filtered, { step: 20 });

  const searchActive = search.trim().length > 0;
  const matchCols = useMemo(() => {
    if (!searchActive)
      return { client: 0, phone: 0, product: 0, platform: 0, values: 0, status: 0, situation: 0, due: 0 };
    let client = 0, phone = 0, product = 0, platform = 0, values = 0, status = 0, situation = 0, due = 0;
    for (const row of filtered) {
      const c =
        row.kind === "mgmv" ? row.client : clients.find((x) => x.id === row.product.clientId);
      if (matchText(c?.name ?? "", search)) client++;
      if (matchText(c?.phone ?? "", search)) phone++;
      const productName = row.kind === "product" ? row.product.name : "Acordo MGMV";
      const plat = row.kind === "product" ? row.product.platform : "";
      const statusLabel =
        row.kind === "product"
          ? productCollectionStatus(row.product).label
          : row.display.hasOverdue
            ? "Parcela MGMV vencida"
            : "Parcela MGMV";
      const sit = row.kind === "product" ? row.product.situation : "MGMV";
      const dueIso =
        row.kind === "product"
          ? row.product.dueDate
          : row.display.nextInstallment?.dueDate ?? "";
      const total = row.kind === "product" ? row.product.totalValue : row.display.totalDebt;
      const paid =
        row.kind === "product"
          ? row.product.paidValue
          : row.display.totalDebt - row.display.remainingBalance;
      const remaining =
        row.kind === "product"
          ? row.product.totalValue - row.product.paidValue
          : row.display.remainingBalance;
      if (matchText(productName, search)) product++;
      if (matchText(plat, search)) platform++;
      if (matchText(statusLabel, search)) status++;
      if (
        matchText(sit, search) ||
        (row.kind === "product" && matchText(displaySituation(row.product.situation), search))
      )
        situation++;
      if (dueIso && matchText(formatDateBR(dueIso), search)) due++;
      if (
        matchText(formatBRL(total), search) ||
        matchText(formatBRL(paid), search) ||
        matchText(formatBRL(remaining), search)
      )
        values++;
    }
    return { client, phone, product, platform, values, status, situation, due };
  }, [filtered, search, searchActive, clients]);

  const totalAtraso =
    overdueProducts.reduce((a, p) => a + (p.totalValue - p.paidValue), 0) +
    mgmvRows.reduce((a, r) => a + r.display.remainingBalance, 0);
  const valorRestante = products
    .filter((p) => p.situation === "Em Aberto")
    .reduce((a, p) => a + (p.totalValue - p.paidValue), 0);
  const inadimplentes = new Set([
    ...overdueProducts.map((p) => p.clientId),
    ...mgmvRows.map((r) => r.client.id),
  ]).size;
  const reservasVencidas = overdueProducts.filter((p) => p.financialStatus === "Reserva").length;
  const pendentesVencidos = overdueProducts.filter((p) => p.financialStatus === "Pendente").length;
  const mgmvVencidas = clients.reduce(
    (a, c) => a + (c.mgmv?.installments.filter((i) => !i.paid && isOverdue(i.dueDate)).length ?? 0),
    0,
  );

  const chips: { id: Filter; label: string }[] = [
    { id: "reserva_vencida", label: "Reserva vencida" },
    { id: "pendente_vencido", label: "Pendente vencido" },
    { id: "mgmv", label: "MGMV" },
    { id: "mgmv_vencido", label: "Parcela MGMV vencida" },
    { id: "em_aberto", label: "Em aberto" },
  ];

  const periodOptions: { value: Period; label: string }[] = [
    { value: "todos", label: "Todos os períodos" },
    { value: "hoje", label: "Hoje" },
    { value: "7", label: "Últimos 7 dias" },
    { value: "15", label: "Últimos 15 dias" },
    { value: "30", label: "Últimos 30 dias" },
    { value: "mes", label: "Este mês" },
    { value: "mes_passado", label: "Mês passado" },
    { value: "personalizado", label: "Personalizado" },
    { value: "maximo", label: "Máximo" },
  ];

  const buildMessage = (
    clientName: string,
    productName: string,
    remaining: number,
    statusLabel: string,
    dueDate: string,
    late: number,
  ) => {
    const firstName = (clientName || "").split(" ")[0] || clientName;
    const valor = formatBRL(remaining);
    const venc = formatDateBR(dueDate);
    switch (statusLabel) {
      case "Reserva vencida":
        return `Olá, ${firstName}! Aqui é da Star Games. Sua *reserva* do item *${productName}* venceu em ${venc} (${late} dias em atraso) e o valor restante é *${valor}*. Consegue regularizar hoje para mantermos o item reservado?`;
      case "Pendente vencido":
        return `Olá, ${firstName}! Aqui é da Star Games. Identificamos um *pagamento pendente* do item *${productName}*, vencido em ${venc} (${late} dias em atraso). Valor restante: *${valor}*. Podemos acertar?`;
      case "MGMV vencido":
      case "Parcela MGMV vencida":
        return `Olá, ${firstName}! Aqui é da Star Games. Sua *parcela MGMV* (${productName}) venceu em ${venc} (${late} dias em atraso). Valor: *${valor}*. Consegue regularizar hoje?`;
      case "Reserva":
        return `Olá, ${firstName}! Aqui é da Star Games. Passando para lembrar da *reserva* do item *${productName}*. Valor restante: *${valor}*, vencimento em ${venc}.`;
      case "Pendente":
        return `Olá, ${firstName}! Aqui é da Star Games. Lembrete do *pagamento pendente* do item *${productName}*, no valor de *${valor}*, com vencimento em ${venc}.`;
      default:
        return `Olá, ${firstName}! Aqui é da Star Games. Sobre o item *${productName}*, o valor restante é *${valor}* com vencimento em ${venc}. Podemos regularizar?`;
    }
  };

  const formatPhoneIntl = (phone: string) => {
    const digits = (phone || "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.startsWith("55") ? digits : `55${digits}`;
  };

  const openWhatsApp = (
    phone: string,
    clientName: string,
    productName: string,
    remaining: number,
    statusLabel: string,
    dueDate: string,
    late: number,
  ) => {
    const intl = formatPhoneIntl(phone);
    if (!intl) {
      toast.error("Cliente sem telefone cadastrado");
      return;
    }
    const msg = buildMessage(clientName, productName, remaining, statusLabel, dueDate, late);
    const url = `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openPayDialog = (productId: string, remaining: number, productName: string) => {
    setPayTarget({ id: productId, remaining, productName });
    setPayAmount(remaining.toFixed(2));
  };

  const clearFilters = () => {
    setFilter("nenhum");
    setPeriod("todos");
    setCustomFrom("");
    setCustomTo("");
    setFolderFilter("Todas");
    setFinancialFilter("Todos");
    setSituationFilter("Todas");
    setSearch("");
    setActiveSavedId("");
  };

  const saveCurrentFilter = () => {
    const name = window.prompt("Nome do filtro:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const existing = savedFilters.find((s) => s.name === trimmed);
    const snapshot = { filter, period, customFrom, customTo };
    if (existing) {
      const next = savedFilters.map((s) =>
        s.id === existing.id ? { ...existing, ...snapshot } : s,
      );
      setSavedFilters(next);
      setActiveSavedId(existing.id);
      toast.success(`Filtro "${trimmed}" atualizado`);
    } else {
      const id =
        (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `f-${Date.now()}`;
      setSavedFilters([...savedFilters, { id, name: trimmed, ...snapshot }]);
      setActiveSavedId(id);
      toast.success(`Filtro "${trimmed}" salvo`);
    }
  };

  const exportCobrancas = () => {
    const header =
      "cliente;telefone;produto;plataforma;total;pago;restante;status;situacao;data_limite;atraso\n";
    const body = filtered
      .map((row) => {
        if (row.kind === "mgmv") {
          const { client, display } = row;
          const next = display.nextInstallment;
          const dueIso = next?.dueDate ?? "";
          const late = next ? daysLate(dueIso) : 0;
          const remaining = next?.value ?? display.installmentValue;
          const productLabel = next ? `Parcela ${next.number}/${next.total} — MGMV` : "Acordo MGMV";
          const statusLabel = display.hasOverdue ? "Parcela MGMV vencida" : "Parcela MGMV";
          return `${client.name};${client.phone};${productLabel};—;${display.totalDebt.toFixed(2)};${(display.totalDebt - display.remainingBalance).toFixed(2)};${remaining.toFixed(2)};${statusLabel};MGMV;${dueIso ? formatDateBR(dueIso) : ""};${late}`;
        }
        const p = row.product;
        const client = clients.find((c) => c.id === p.clientId);
        const status = productCollectionStatus(p);
        const remaining = p.totalValue - p.paidValue;
        const late = daysLate(p.dueDate);
        return `${client?.name ?? ""};${client?.phone ?? ""};${p.name};${p.platform};${p.totalValue.toFixed(2)};${p.paidValue.toFixed(2)};${remaining.toFixed(2)};${status.label};${p.situation};${formatDateBR(p.dueDate)};${late}`;
      })
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cobrancas.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Cobranças exportadas");
  };

  const confirmPayment = () => {
    if (!payTarget) return;
    const amount = Number(payAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    registerPayment(payTarget.id, amount);
    toast.success("Pagamento registrado");
    setPayTarget(null);
    setPayAmount("");
  };

  return (
    <section id="collection" data-tour="collection-section" className="one-page-section">
      <PageHeader
        title="Collection"
        description="Controle cobranças, inadimplências, reservas vencidas e acordos em atraso."
        actions={
          <>
            <Button variant="outline" onClick={exportCobrancas}>
              Exportar Cobranças
            </Button>
            <Button variant="outline" onClick={saveCurrentFilter}>
              Salvar filtro
            </Button>
          </>
        }
      />

      <StatusLegend className="mt-4" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Total em atraso"
          value={formatBRL(totalAtraso)}
          status="danger"
          onClick={() => applyCardFilter("em_aberto")}
          tooltip="Ver cobranças em aberto"
        />
        <MetricCard
          label="Clientes inadimplentes"
          value={inadimplentes}
          onClick={() => applyCardFilter("em_aberto")}
          tooltip="Ver clientes inadimplentes"
        />
        <MetricCard
          label="Reservas vencidas"
          value={reservasVencidas}
          status="danger"
          onClick={() => applyCardFilter("reserva_vencida")}
          tooltip="Ver reservas vencidas"
        />
        <MetricCard
          label="Pendentes vencidos"
          value={pendentesVencidos}
          status="danger"
          onClick={() => applyCardFilter("pendente_vencido")}
          tooltip="Ver pendentes vencidos"
        />
        <MetricCard
          label="Parcelas MGMV vencidas"
          value={mgmvVencidas}
          status="danger"
          onClick={() => applyCardFilter("mgmv_vencido")}
          tooltip="Ver parcelas MGMV vencidas"
        />
        <MetricCard
          label="Valor total restante"
          value={formatBRL(valorRestante)}
          onClick={() => applyCardFilter("em_aberto")}
          tooltip="Ver cobranças com valor em aberto"
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
              <FilterIcon className="h-4 w-4" />
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
                    onClick={() => setFilter(c.id)}
                    className={
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                      (filter === c.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent")
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
                      <option key={f} value={f}>{f}</option>
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
                  <option>Desistiu</option>
                  <option>Abandonou</option>
                </select>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as Period)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {periodOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {period === "personalizado" && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">até</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              )}

              {savedFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={activeSavedId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setActiveSavedId(id);
                      const f = savedFilters.find((s) => s.id === id);
                      if (f) {
                        setFilter(f.filter);
                        setPeriod(f.period);
                        setCustomFrom(f.customFrom);
                        setCustomTo(f.customTo);
                        toast.success(`Filtro "${f.name}" aplicado`);
                      }
                    }}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    title="Filtros salvos"
                  >
                    <option value="">Filtros salvos…</option>
                    {savedFilters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={saveCurrentFilter}
                    className="gap-1.5"
                  >
                    <Save className="h-4 w-4" />
                    Salvar filtro
                  </Button>
                  {activeSavedId && savedFilters.some((s) => s.id === activeSavedId) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const s = savedFilters.find((x) => x.id === activeSavedId);
                        if (!s) return;
                        if (!window.confirm(`Excluir filtro "${s.name}"?`)) return;
                        setSavedFilters(savedFilters.filter((x) => x.id !== activeSavedId));
                        setActiveSavedId("");
                        toast.success("Filtro excluído");
                      }}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>
                  {filtered.length} cobrança(s) encontrada(s)
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
                    Buscando “{search}” em Cobranças:
                  </span>
                  {[
                    { k: "client", label: "Cliente", n: matchCols.client },
                    { k: "phone", label: "Telefone", n: matchCols.phone },
                    { k: "product", label: "Produto", n: matchCols.product },
                    { k: "platform", label: "Plataforma", n: matchCols.platform },
                    { k: "values", label: "Valores", n: matchCols.values },
                    { k: "status", label: "Status", n: matchCols.status },
                    { k: "situation", label: "Situação", n: matchCols.situation },
                    { k: "due", label: "Data limite", n: matchCols.due },
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
            </>
          )}
        </div>

        <>
        <div className="relative table-scroll-y mt-4 max-h-[28rem] overflow-x-auto rounded-md border border-border/60">
          {noFilterApplied && <FilterEmptyState />}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Cliente<ColumnMatchDot active={searchActive} count={matchCols.client} /></th>
                <th className="py-2 pr-3 font-medium">Telefone<ColumnMatchDot active={searchActive} count={matchCols.phone} /></th>
                <th className="py-2 pr-3 font-medium">Produto<ColumnMatchDot active={searchActive} count={matchCols.product} /></th>
                <th className="py-2 pr-3 font-medium">Plataforma<ColumnMatchDot active={searchActive} count={matchCols.platform} /></th>
                <th className="py-2 pr-3 font-medium">Total<ColumnMatchDot active={searchActive} count={matchCols.values} /></th>
                <th className="py-2 pr-3 font-medium">Pago<ColumnMatchDot active={searchActive} count={matchCols.values} /></th>
                <th className="py-2 pr-3 font-medium">Restante<ColumnMatchDot active={searchActive} count={matchCols.values} /></th>
                <th className="py-2 pr-3 font-medium">Status<ColumnMatchDot active={searchActive} count={matchCols.status} /></th>
                <th className="py-2 pr-3 font-medium">Situação<ColumnMatchDot active={searchActive} count={matchCols.situation} /></th>
                <th className="py-2 pr-3 font-medium">Data Limite<ColumnMatchDot active={searchActive} count={matchCols.due} /></th>
                <th className="py-2 pr-3 font-medium">Atraso</th>
                <th className="py-2 pr-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, idx) => {
                if (row.kind === "mgmv") {
                  const { client, display } = row;
                  const next = display.nextInstallment;
                  const dueIso = next?.dueDate ?? new Date().toISOString();
                  const late = next ? daysLate(dueIso) : 0;
                  const remaining = next?.value ?? display.installmentValue;
                  const statusLabel =
                    display.hasOverdue ? "Parcela MGMV vencida" : "Parcela MGMV";
                  const productLabel = next
                    ? `Parcela ${next.number}/${next.total} — MGMV`
                    : "Acordo MGMV";
                  return (
                    <tr key={`mgmv-${client.id}`} className="border-b border-border/60 last:border-0 bg-primary/[0.04]">
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 font-medium"}>{highlight(client.name, search)}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{highlight(client.phone, search)}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>{highlight(productLabel, search)}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>—</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums"}>{formatBRL(display.totalDebt)}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums text-muted-foreground"}>
                        {formatBRL(display.totalDebt - display.remainingBalance)}
                      </td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums font-medium"}>{formatBRL(remaining)}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>
                        <Tag variant={display.hasOverdue ? "danger" : "warning"}>{statusLabel}</Tag>
                      </td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag>MGMV</Tag></td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>
                        {next ? formatDateBR(dueIso) : "—"}
                      </td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>
                        {display.hasOverdue ? (
                          <Tag variant={late > 7 ? "danger" : "warning"}>{late} dias</Tag>
                        ) : (
                          <span className="text-xs text-muted-foreground">no prazo</span>
                        )}
                      </td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              openClient(client.id);
                            }}
                          >
                            Abrir
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Enviar mensagem no WhatsApp"
                            aria-label="Enviar mensagem no WhatsApp"
                            onClick={() => {
                              const firstName =
                                (client.name || "").split(" ")[0] || client.name;
                              const totalParcelas = next?.total ?? display.installmentsTotal;
                              const parcelaAtual = next?.number ?? display.installmentsPaid + 1;
                              const valorParcela = formatBRL(remaining);
                              const vencimento = next ? formatDateBR(dueIso) : "—";
                              const saldoRestante = formatBRL(display.remainingBalance);
                              const message =
                                `Olá, ${firstName}. Tudo bem?\n\n` +
                                `Passando para lembrar sobre o seu acordo MGMV.\n\n` +
                                `Parcela: ${parcelaAtual}/${totalParcelas}\n` +
                                `Valor da parcela: ${valorParcela}\n` +
                                `Vencimento: ${vencimento}\n` +
                                `Saldo restante: ${saldoRestante}\n\n` +
                                `Assim que conseguir, me envie o comprovante para atualizarmos seu acordo por aqui.`;
                              const phone = formatPhoneIntl(client.phone);
                              if (!phone) {
                                toast.error("Cliente sem telefone válido.");
                                return;
                              }
                              window.open(
                                `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            disabled={!next}
                            onClick={async () => {
                              if (next) {
                                try {
                                  await payMGMVInstallment(client.id, next.number);
                                  toast.success(`Parcela ${next.number} marcada como paga`);
                                } catch (error) {
                                  toast.error(error instanceof Error ? error.message : "Falha ao salvar parcela.");
                                }
                              }
                            }}
                          >
                            Pagar parcela
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                const p = row.product;
                const client = clients.find((c) => c.id === p.clientId);
                const status = productCollectionStatus(p);
                const remaining = p.totalValue - p.paidValue;
                const late = daysLate(p.dueDate);
                const editing = collectionEdit.isEditing(p.id);
                const draft = collectionEdit.draftValues;
                return (
                  <tr
                    key={`p-${p.id}-${idx}`}
                    className={cn("border-b border-border/60 last:border-0", productStatusTone(p))}
                  >
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 font-medium"}>{highlight(client?.name ?? "", search)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{highlight(client?.phone ?? "", search)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>{highlight(p.name, search)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{highlight(p.platform ?? "", search)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums"}>
                      {editing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                          value={draft?.totalValue ?? 0}
                          onChange={(e) => collectionEdit.setField("totalValue", Number(e.target.value))}
                          aria-label="Editar valor total"
                        />
                      ) : (
                        formatBRL(p.totalValue)
                      )}
                    </td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums text-muted-foreground"}>
                      {editing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                          value={draft?.paidValue ?? 0}
                          onChange={(e) => collectionEdit.setField("paidValue", Number(e.target.value))}
                          aria-label="Editar valor pago"
                        />
                      ) : (
                        formatBRL(p.paidValue)
                      )}
                    </td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums font-medium"}>{formatBRL(remaining)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag variant={status.variant === "danger" ? "danger" : status.variant === "warning" ? "warning" : "neutral"} className={productStatusTextTone(p)}>{status.label}</Tag></td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag>{displaySituation(p.situation)}</Tag></td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>
                      {editing ? (
                        <input
                          type="date"
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={(draft?.dueDate ?? "").slice(0, 10)}
                          onChange={(e) => collectionEdit.setField("dueDate", e.target.value ? new Date(e.target.value).toISOString() : "")}
                          aria-label="Editar data limite"
                        />
                      ) : (
                        formatDateBR(p.dueDate)
                      )}
                    </td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag variant={late > 7 ? "danger" : "warning"}>{late} dias</Tag></td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>
                      <div className="flex flex-wrap gap-1.5">
                        {editing ? (
                          <RowEditActions
                            onConfirm={() =>
                              collectionEdit.confirm(
                                (d) => {
                                  updateProduct(p.id, {
                                    totalValue: Math.max(0, d.totalValue),
                                    paidValue: Math.max(0, d.paidValue),
                                    dueDate: d.dueDate || p.dueDate,
                                  });
                                  toast.success("Cobrança atualizada");
                                },
                                {
                                  validate: (d) => {
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
                            onClose={collectionEdit.close}
                          />
                        ) : (
                          <RowEditPencil
                            label="Editar cobrança"
                            onStart={() =>
                              collectionEdit.startEdit(p.id, {
                                totalValue: p.totalValue,
                                paidValue: p.paidValue,
                                dueDate: p.dueDate,
                              })
                            }
                          />
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            openClient(p.clientId);
                          }}
                        >
                          Abrir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Enviar mensagem no WhatsApp"
                          aria-label="Enviar mensagem no WhatsApp"
                          onClick={() =>
                            openWhatsApp(
                              client?.phone ?? "",
                              client?.name ?? "",
                              p.name,
                              remaining,
                              status.label,
                              p.dueDate,
                              late,
                            )
                          }
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        <Button size="sm" onClick={() => openPayDialog(p.id, remaining, p.name)}>
                          Pagar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !noFilterApplied && (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                    {activeFilterCount > 0 || search
                      ? "Nenhuma cobrança encontrada para os filtros selecionados."
                      : "Nenhuma cobrança encontrada."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="mt-6 flex flex-col items-center gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
            <span className="text-center">
              {visible.length} de {filtered.length} cobranças exibidas
              {period === "maximo" && filtered.length > 200 && (
                <span className="ml-2 text-amber-500">
                  (modo Máximo — muitos registros podem ser exibidos)
                </span>
              )}
            </span>
            {hasMore && <LoadMoreButton count={nextChunk} onClick={loadMore} />}
          </div>
        )}
        </>
      </Card>

      <div className="mt-4 text-xs text-muted-foreground">
        <button
          className="underline-offset-2 hover:underline"
          onClick={() => onScrollTo("dashboard")}
        >
          ← Voltar para o Dashboard
        </button>
      </div>

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {payTarget ? `${payTarget.productName} — Restante: ${formatBRL(payTarget.remaining)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pay-amount">Valor recebido (R$)</Label>
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmPayment();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmPayment}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}