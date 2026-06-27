import { useEffect, useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  daysLate,
  formatBRL,
  formatDateBR,
  getMGMVDisplay,
  isOverdue,
  productCollectionStatus,
  shouldAppearInCollection,
  useStore,
  type Client,
  type Product,
  type MGMVDisplay,
} from "@/lib/store";
import { toast } from "sonner";
import { MessageCircle, Maximize2, Minimize2, Filter as FilterIcon, Save, Trash2 } from "lucide-react";
import { LoadMoreButton } from "@/components/load-more-button";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useSectionCompact } from "@/lib/use-section-compact";
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

type Filter = "todos" | "reserva_vencida" | "pendente_vencido" | "mgmv" | "mgmv_vencido" | "em_aberto";

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

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;
const DEFAULT_PAGE_SIZE = 50;

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
  initialFilter = "todos",
}: {
  onScrollTo: (id: string) => void;
  initialFilter?: Filter;
}) {
  const { clients, products, registerPayment, openClient, payMGMVInstallment } = useStore();
  const [filter, setFilter] = usePersistedState<Filter>("collection.filter", initialFilter);
  const [period, setPeriod] = usePersistedState<Period>("collection.period", "todos");
  const [customFrom, setCustomFrom] = usePersistedState<string>("collection.customFrom", "");
  const [customTo, setCustomTo] = usePersistedState<string>("collection.customTo", "");
  const [pageSize, setPageSize] = usePersistedState<number>("collection.pageSize", DEFAULT_PAGE_SIZE);
  const [visibleCount, setVisibleCount] = useState<number>(DEFAULT_PAGE_SIZE);
  const [compact, setCompact] = useSectionCompact("collection");
  const [payTarget, setPayTarget] = useState<{ id: string; remaining: number; productName: string } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [savedFilters, setSavedFilters] = usePersistedState<SavedFilter[]>("collection.savedFilters", []);
  const [activeSavedId, setActiveSavedId] = usePersistedState<string>("collection.activeSavedId", "");

  const activeFilterCount =
    (filter !== "todos" ? 1 : 0) +
    (period !== "todos" ? 1 : 0) +
    (period === "personalizado" && (customFrom || customTo) ? 1 : 0);

  const overdueProducts = useMemo(() => products.filter(shouldAppearInCollection), [products]);

  // Acordos MGMV consolidados (1 linha por cliente com acordo ativo + parcelas vencidas)
  const mgmvRows = useMemo(() => {
    return clients
      .map((c) => {
        const d = getMGMVDisplay(c);
        if (!d || !d.active || !d.hasOverdue) return null;
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

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 86400000;
    return allRows.filter((row) => {
      // Filtro por tipo
      if (filter === "reserva_vencida")
        if (row.kind !== "product" || row.product.financialStatus !== "Reserva") return false;
      if (filter === "pendente_vencido")
        if (row.kind !== "product" || row.product.financialStatus !== "Pendente") return false;
      if (filter === "mgmv" || filter === "mgmv_vencido")
        if (row.kind !== "mgmv") return false;
      if (filter === "em_aberto")
        if (row.kind === "product" && row.product.situation !== "Em Aberto") return false;

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
  }, [allRows, filter, period, customFrom, customTo]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Reseta a janela visível ao mudar filtros/tamanho.
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [pageSize, filter, period, customFrom, customTo]);

  const hasMore = visible.length < filtered.length;

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
    { id: "todos", label: "Todos" },
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
    <section id="collection" className="one-page-section">
      <PageHeader
        title="Collection"
        description="Controle cobranças, inadimplências, reservas vencidas e acordos em atraso."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Total em atraso" value={formatBRL(totalAtraso)} status="danger" />
        <MetricCard label="Clientes inadimplentes" value={inadimplentes} />
        <MetricCard label="Reservas vencidas" value={reservasVencidas} status="danger" />
        <MetricCard label="Pendentes vencidos" value={pendentesVencidos} status="danger" />
        <MetricCard label="Parcelas MGMV vencidas" value={mgmvVencidas} status="danger" />
        <MetricCard label="Valor total restante" value={formatBRL(valorRestante)} />
      </div>

      <Card className="mt-6">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-wrap items-center gap-2">
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompact((v) => !v)}
                className="gap-1.5"
                title={compact ? "Expandir linhas" : "Compactar linhas"}
              >
                {compact ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
                {compact ? "Expandir" : "Compactar"}
              </Button>
              {savedFilters.length > 0 && (
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
              )}
            </div>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              title="Máximo de linhas por carga"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Máx. {n}
                </option>
              ))}
            </select>
          </div>

          {showFilters && (
            <>
              <div className="flex flex-wrap items-center gap-2">
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

              <div className="flex flex-wrap items-center gap-2">
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
                {period === "personalizado" && (
                  <>
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
                  </>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
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
                          (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
                          `f-${Date.now()}`;
                        setSavedFilters([...savedFilters, { id, name: trimmed, ...snapshot }]);
                        setActiveSavedId(id);
                        toast.success(`Filtro "${trimmed}" salvo`);
                      }
                    }}
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
              </div>
            </>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Telefone</th>
                <th className="py-2 pr-3 font-medium">Produto</th>
                <th className="py-2 pr-3 font-medium">Plataforma</th>
                <th className="py-2 pr-3 font-medium">Total</th>
                <th className="py-2 pr-3 font-medium">Pago</th>
                <th className="py-2 pr-3 font-medium">Restante</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 pr-3 font-medium">Data Limite</th>
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
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 font-medium"}>{client.name}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{client.phone}</td>
                      <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>{productLabel}</td>
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
                              onScrollTo("clientes");
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
                                client.phone,
                                client.name,
                                productLabel,
                                remaining,
                                statusLabel,
                                dueIso,
                                late,
                              )
                            }
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            disabled={!next}
                            onClick={() => {
                              if (next) {
                                payMGMVInstallment(client.id, next.number);
                                toast.success(`Parcela ${next.number} marcada como paga`);
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
                return (
                  <tr key={`p-${p.id}-${idx}`} className="border-b border-border/60 last:border-0">
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 font-medium"}>{client?.name}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{client?.phone}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>{p.name}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{p.platform}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums"}>{formatBRL(p.totalValue)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums text-muted-foreground"}>{formatBRL(p.paidValue)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 tabular-nums font-medium"}>{formatBRL(remaining)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag variant={status.variant === "danger" ? "danger" : status.variant === "warning" ? "warning" : "neutral"}>{status.label}</Tag></td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag>{p.situation}</Tag></td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300 text-muted-foreground"}>{formatDateBR(p.dueDate)}</td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}><Tag variant={late > 7 ? "danger" : "warning"}>{late} dias</Tag></td>
                    <td className={(compact ? "py-1.5" : "py-3") + " pr-3 transition-[padding] duration-300"}>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            openClient(p.clientId);
                            onScrollTo("clientes");
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma cobrança encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="mt-6 flex flex-col items-center gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
            <span className="text-center">
              Mostrando {Math.min(visible.length, filtered.length)} de {filtered.length} cobranças encontradas
              {period === "maximo" && filtered.length > 200 && (
                <span className="ml-2 text-amber-500">
                  (modo Máximo — muitos registros podem ser exibidos)
                </span>
              )}
            </span>
            {hasMore ? (
              <LoadMoreButton
                count={Math.min(pageSize, filtered.length - visible.length)}
                onClick={() => setVisibleCount((c) => c + pageSize)}
              />
            ) : (
              <span>Todas as cobranças carregadas.</span>
            )}
          </div>
        )}
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