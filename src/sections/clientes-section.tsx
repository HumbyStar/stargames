import { useEffect, useMemo, useState } from "react";
import { Folder, Filter, Maximize2, Minimize2, X } from "lucide-react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useSectionCompact } from "@/lib/use-section-compact";
import { Button } from "@/components/ui/button";
import { ListExpansionToggle, MinimizedListCard } from "@/components/list-expansion";
import { useListExpansion } from "@/lib/list-expansion";
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
  useStore,
  type Client,
  type Product,
  type FinancialStatus,
  type Situation,
} from "@/lib/store";
import { toast } from "sonner";
import { MgmvCreateModal } from "@/components/mgmv-create-modal";
import { MgmvPartialPaymentPopover } from "@/components/mgmv-partial-payment-popover";
import { RetiradoConfirmModal } from "@/components/retirado-confirm-modal";
import { useRowEdit } from "@/lib/use-row-edit";
import { RowEditPencil, RowEditActions } from "@/components/row-edit-controls";

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
  products: Product[],
): {
  label: string;
  variant: "danger" | "warning" | "success" | "neutral" | "primary";
} {
  const ps = products.filter((p) => p.clientId === client.id);
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
  const addProduct = useStore((s) => s.addProduct);
  const updateProduct = useStore((s) => s.updateProduct);
  const registerPayment = useStore((s) => s.registerPayment);
  const setProductSituation = useStore((s) => s.setProductSituation);
  const payMGMVInstallment = useStore((s) => s.payMGMVInstallment);

  const [search, setSearch] = usePersistedState<string>("clientes.search", "");
  const [chip, setChip] = usePersistedState<ChipFilter>("clientes.chip", "todos");
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
  const [compact, setCompact] = useSectionCompact("clientes");
  const [showFilters, setShowFilters] = useState(true);
  const { expanded: listExpanded, expand: expandList } = useListExpansion("clients");

  /**
   * Drill-down a partir de um card de resumo: ajusta o chip do contexto
   * Clientes e expande a lista quando estiver minimizada.
   */
  const applyCardFilter = (next: ChipFilter) => {
    setChip(next);
    setSearch("");
    if (!listExpanded) expandList();
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

  const drawerClient = clients.find((c) => c.id === drawerClientId) ?? null;

  // Edição por lápis (linha da tabela de clientes). Somente o botão
  // "Confirmar" persiste; "Fechar" descarta. Clique fora / blur não
  // disparam confirm nem close — o hook não escuta esses eventos.
  const clientEdit = useRowEdit<{ name: string; phone: string }>();

  const folders = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.folder && c.folder.trim()) set.add(c.folder);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  }, [clients]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const productsByClient = new Map<string, typeof products>();
    for (const p of products) {
      const arr = productsByClient.get(p.clientId);
      if (arr) arr.push(p);
      else productsByClient.set(p.clientId, [p]);
    }
    return (
      clients
        // Seção Clientes lista apenas clientes comuns. Clientes MGMV (com
        // acordo ativo ou classificados como mgmv pela importação) vão para
        // a seção MGMV dedicada.
        .filter((c) => {
          const isMgmv = c.clientType === "mgmv" || (!!c.mgmv && c.mgmv.installments.length > 0);
          return !isMgmv;
        })
        .map((c) => {
          const ps = productsByClient.get(c.id) ?? [];
          const totalPurchased = ps.reduce((a, p) => a + p.totalValue, 0);
          const totalOpen = ps
            .filter((p) => isOpenSituation(p))
            .reduce((a, p) => a + (p.totalValue - p.paidValue), 0);
          const last = ps
            .map((p) => p.registerDate)
            .sort()
            .pop();
          const status = generalStatus(c, products);
          return { client: c, products: ps, totalPurchased, totalOpen, last, status };
        })
        .filter((r) => {
          if (q) {
            const hit =
              r.client.name.toLowerCase().includes(q) ||
              r.client.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
              r.products.some((p) => p.name.toLowerCase().includes(q));
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
        })
    );
  }, [
    clients,
    products,
    search,
    chip,
    financialFilter,
    situationFilter,
    platformFilter,
    periodFilter,
    folderFilter,
  ]);

  const pagedRows = rows;

  const activeFilterCount =
    (chip !== "todos" ? 1 : 0) +
    (financialFilter !== "Todos" ? 1 : 0) +
    (situationFilter !== "Todas" ? 1 : 0) +
    (platformFilter !== "Todas" ? 1 : 0) +
    (periodFilter !== "Todos" ? 1 : 0) +
    (folderFilter !== "Todas" ? 1 : 0);

  const clearFilters = () => {
    setChip("todos");
    setFinancialFilter("Todos");
    setSituationFilter("Todas");
    setPlatformFilter("Todas");
    setPeriodFilter("Todos");
    setFolderFilter("Todas");
    setSearch("");
  };

  const totalClients = clients.length;
  const clientesPendencia = clients.filter((c) =>
    products.some(
      (p) =>
        p.clientId === c.id &&
        p.situation === "Em Aberto" &&
        (p.financialStatus === "Pendente" ||
          (p.financialStatus === "Reserva" && isOverdue(p.dueDate))),
    ),
  ).length;
  const pagosAgEnvio = products.filter(
    (p) => p.financialStatus === "Pago" && p.situation === "Em Aberto",
  ).length;

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
            <Button variant="outline" onClick={() => onScrollTo("import")}>
              Importar Clientes
            </Button>
            <Button variant="outline" onClick={exportBase}>
              Exportar Base
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricCard
          label="Total de Clientes"
          value={totalClients}
          onClick={() => applyCardFilter("todos")}
          tooltip="Ver todos os clientes"
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
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, telefone ou produto..."
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
            <ListExpansionToggle section="clients" />
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
            </>
          )}
        </div>

        {!listExpanded && (
          <MinimizedListCard
            section="clients"
            title="Lista de clientes minimizada"
            lines={[
              `${rows.length} cliente(s) encontrado(s)`,
              activeFilterCount > 0
                ? `${activeFilterCount} filtro(s) ativo(s)`
                : "Sem filtros ativos",
            ]}
          />
        )}
        {listExpanded && (
          <>
            <div className="table-scroll-y mt-5 max-h-[28rem] overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Cliente</th>
                    <th className="py-2 pr-3 font-medium">Telefone</th>
                    <th className="py-2 pr-3 font-medium">Status Geral</th>
                    <th className="py-2 pr-3 font-medium">Qtd. Produtos</th>
                    <th className="py-2 pr-3 font-medium">Total Comprado</th>
                    <th className="py-2 pr-3 font-medium">Total em Aberto</th>
                    <th className="py-2 pr-3 font-medium">Última Compra</th>
                    {!compact && <th className="py-2 pr-3 font-medium">Observações</th>}
                    <th className="py-2 pr-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => (
                    <tr key={r.client.id} className="border-b border-border/60 last:border-0">
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
                            {r.client.name}
                            {r.client.folder && (
                              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                                <Folder className="h-2.5 w-2.5" />
                                {r.client.folder}
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
                          r.client.phone
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
                        {r.last ? formatDateBR(r.last) : "—"}
                      </td>
                      {!compact && (
                        <td className="py-3 pr-3 max-w-[220px] truncate text-muted-foreground">
                          {r.client.notes ?? "—"}
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
                                    });
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
                            </>
                          )}
                          {!compact && !clientEdit.isEditing(r.client.id) && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setClientModal({ open: true, client: r.client })}
                              >
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  setProductModal({ open: true, clientId: r.client.id })
                                }
                              >
                                + Produto
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onScrollTo("collection")}
                              >
                                Cobrança
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pagedRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={compact ? 8 : 9}
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
                  {rows.length} cliente(s) carregado(s)
                </span>
              </div>
            )}
          </>
        )}
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
              onSaveNotes={(notes) => {
                updateClient(drawerClient.id, { notes });
                toast.success("Observação salva");
              }}
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
            />
          )}
        </DialogContent>
      </Dialog>

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

function ClientDrawer({
  client,
  products,
  onEdit,
  onAddProduct,
  onSaveNotes,
  onRegisterPayment,
  onChangeSituation,
  onRequestRetirado,
  onMarkPaid,
  onPayMGMVInstallment,
}: {
  client: Client;
  products: Product[];
  onEdit: () => void;
  onAddProduct: () => void;
  onSaveNotes: (notes: string) => void;
  onRegisterPayment: (productId: string, remaining: number) => void;
  onChangeSituation: (productId: string, s: Situation) => void;
  onRequestRetirado: (productId: string) => void;
  onMarkPaid: (p: Product) => void;
  onPayMGMVInstallment: (installmentNumber: number) => void;
}) {
  const [notes, setNotes] = useState(client.notes ?? "");
  const [mgmvCreateOpen, setMgmvCreateOpen] = useState(false);
  const updateProduct = useStore((s) => s.updateProduct);
  // Edição por lápis dos produtos do cliente. Apenas Confirmar persiste;
  // Fechar descarta. Blur / click-outside são ignorados pelo hook.
  const productEdit = useRowEdit<{
    name: string;
    platform: string;
    totalValue: number;
    paidValue: number;
    financialStatus: FinancialStatus;
  }>();
  const mgmv = getMGMVDisplay(client);
  const mgmvProducts = products.filter((p) => p.financialStatus === "MGMV");
  const individualAll = products.filter((p) => p.financialStatus !== "MGMV");
  // Retirado = arquivado: sai da lista ativa e migra para o histórico do
  // cliente. Mantido nas somas totais para não perder o histórico financeiro.
  const individualProducts = individualAll.filter((p) => !isProductArchived(p));
  const archivedProducts = individualAll.filter((p) => isProductArchived(p));
  // Evita double-counting: produtos MGMV são consolidados no acordo.
  // Total comprado = soma dos produtos individuais + valor total do acordo MGMV.
  const individualBought = individualAll.reduce((a, p) => a + p.totalValue, 0);
  const individualPaid = individualAll.reduce((a, p) => a + p.paidValue, 0);
  const individualRest = individualAll
    .filter((p) => p.situation === "Em Aberto")
    .reduce((a, p) => a + (p.totalValue - p.paidValue), 0);
  const mgmvPaid = mgmv ? mgmv.installmentValue * mgmv.installmentsPaid : 0;
  const mgmvRest = mgmv ? mgmv.remainingBalance : 0;
  const totalBought = individualBought + (mgmv?.totalDebt ?? 0);
  const totalPaid = individualPaid + mgmvPaid;
  const totalRest = individualRest + mgmvRest;
  const pctPaid =
    mgmv && mgmv.installmentsTotal > 0
      ? Math.round((mgmv.installmentsPaid / mgmv.installmentsTotal) * 100)
      : 0;

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
        {!client.mgmv && products.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setMgmvCreateOpen(true)}>
            Criar acordo MGMV
          </Button>
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

      {mgmv && (
        <Card title={`Acordo MGMV — ${mgmv.status}`}>
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
                  <th className="py-2 pr-3 font-medium">Pagamento</th>
                  <th className="py-2 pr-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {client.mgmv?.installments.map((i) => {
                  const overdue = !i.paid && isOverdue(i.dueDate);
                  const label = i.paid ? "Pago" : overdue ? "Vencido" : "Pendente";
                  const variant = i.paid ? "success" : overdue ? "danger" : "warning";
                  return (
                    <tr key={i.number} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        {i.number}/{i.total}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{formatDateBR(i.dueDate)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatBRL(i.value)}</td>
                      <td className="py-2 pr-3">
                        <Tag variant={variant}>{label}</Tag>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {i.paidAt ? formatDateBR(i.paidAt) : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {!i.paid && (
                          <Button size="sm" onClick={() => onPayMGMVInstallment(i.number)}>
                            Marcar como paga
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mgmvProducts.length > 0 && (
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
                    {mgmvProducts.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 px-3 font-medium">{p.name}</td>
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
        </Card>
      )}

      <Card title={`Histórico de Produtos${mgmvProducts.length > 0 ? " — Individuais" : ""}`}>
        {mgmvProducts.length > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            Itens do MGMV aparecem no card &ldquo;Itens incluídos no MGMV&rdquo; acima e são
            cobrados pelas parcelas do acordo (sem cobrança individual).
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                const isPaid = p.financialStatus === "Pago";
                const editing = productEdit.isEditing(p.id);
                const draft = productEdit.draftValues;
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      {editing ? (
                        <input
                          className="h-8 w-full min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
                          value={draft?.name ?? ""}
                          onChange={(e) => productEdit.setField("name", e.target.value)}
                          aria-label="Editar nome do produto"
                        />
                      ) : (
                        p.name
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
                        variant={
                          status.variant === "danger"
                            ? "danger"
                            : status.variant === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {status.label}
                      </Tag>
                    </td>
                    <td className="py-2 pr-3">
                      <Tag>{displaySituation(p.situation)}</Tag>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {formatDateBR(p.registerDate)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {getProductDisplayDueDate(p)}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {editing ? (
                          <RowEditActions
                            onConfirm={() =>
                              productEdit.confirm(
                                (d) => {
                                  updateProduct(p.id, {
                                    name: d.name.trim(),
                                    platform: d.platform.trim(),
                                    totalValue: Math.max(0, d.totalValue),
                                    paidValue: Math.max(0, d.paidValue),
                                    financialStatus: d.financialStatus,
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
                              })
                            }
                          />
                        )}
                        {!isPaid && (
                          <Button size="sm" onClick={() => onRegisterPayment(p.id, remaining)}>
                            Pagar
                          </Button>
                        )}
                        {!isPaid && (
                          <Button size="sm" variant="outline" onClick={() => onMarkPaid(p)}>
                            Pago
                          </Button>
                        )}
                        {/* Fluxo: (aberto) Abandonou → Retirar → Retirado */}
                        {p.situation !== "Abandonou" &&
                          p.situation !== "Desistiu" &&
                          p.situation !== "Retirar" &&
                          p.situation !== "Retirado" &&
                          !(status.label === "Enviado" && p.situation === "Enviado") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onChangeSituation(p.id, "Enviado")}
                            >
                              Enviado
                            </Button>
                          )}
                        {isOpenSituation(p) &&
                          p.situation !== "Retirar" &&
                          p.situation !== "Retirado" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onChangeSituation(p.id, "Abandonou")}
                            >
                              Abandonou
                            </Button>
                          )}
                        {(p.situation === "Abandonou" ||
                          p.situation === "Desistiu") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  "Marcar produto para retirada?\n\nEste produto continuará vinculado ao cliente, mas ficará marcado como pendente de retirada pelo estoque. Ele ainda não voltará para o estoque central.",
                                )
                              )
                                return;
                              onChangeSituation(p.id, "Retirar");
                            }}
                          >
                            Retirar
                          </Button>
                        )}
                        {p.situation === "Retirar" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onRequestRetirado(p.id)}
                          >
                            Retirado
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {individualProducts.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-muted-foreground">
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
                  <div className="truncate font-medium">{p.name}</div>
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
