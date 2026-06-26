import { useEffect, useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
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
  formatBRL,
  formatDateBR,
  isOverdue,
  productCollectionStatus,
  useStore,
  type Client,
  type Product,
  type FinancialStatus,
  type Situation,
} from "@/lib/store";
import { toast } from "sonner";

type ChipFilter =
  | "todos"
  | "reserva_vencida"
  | "pendente"
  | "mgmv"
  | "pago_aguardando"
  | "enviado"
  | "desistiu"
  | "abandonou";

function generalStatus(client: Client, products: Product[]): {
  label: string;
  variant: "danger" | "warning" | "success" | "neutral" | "primary";
} {
  const ps = products.filter((p) => p.clientId === client.id);
  if (ps.some((p) => p.financialStatus === "Reserva" && p.situation === "Em Aberto" && isOverdue(p.dueDate)))
    return { label: "Reserva vencida", variant: "danger" };
  if (ps.some((p) => p.financialStatus === "Pendente" && p.situation === "Em Aberto"))
    return { label: "Pendente", variant: "danger" };
  if (client.mgmv && client.mgmv.installments.some((i) => !i.paid))
    return { label: "MGMV", variant: "primary" };
  if (ps.some((p) => p.financialStatus === "Pago" && p.situation === "Em Aberto"))
    return { label: "Pago ag. envio", variant: "success" };
  if (ps.some((p) => p.situation === "Enviado")) return { label: "Enviado", variant: "neutral" };
  if (ps.length === 0) return { label: "Sem produtos", variant: "neutral" };
  return { label: "Em dia", variant: "success" };
}

export function ClientesSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const {
    clients,
    products,
    openClientId,
    openClient,
    addClient,
    updateClient,
    addProduct,
    updateProduct,
    registerPayment,
    setProductSituation,
  } = useStore();

  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<ChipFilter>("todos");
  const [financialFilter, setFinancialFilter] = useState("Todos");
  const [situationFilter, setSituationFilter] = useState("Todas");
  const [platformFilter, setPlatformFilter] = useState("Todas");
  const [periodFilter, setPeriodFilter] = useState("Todos");

  const drawerClientId = openClientId;
  const setDrawerClientId = (id: string | null) => openClient(id);
  const [clientModal, setClientModal] = useState<{ open: boolean; client?: Client | null }>({ open: false });
  const [productModal, setProductModal] = useState<{ open: boolean; clientId?: string; product?: Product | null }>({ open: false });

  const drawerClient = clients.find((c) => c.id === drawerClientId) ?? null;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .map((c) => {
        const ps = products.filter((p) => p.clientId === c.id);
        const totalPurchased = ps.reduce((a, p) => a + p.totalValue, 0);
        const totalOpen = ps
          .filter((p) => p.situation === "Em Aberto")
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
            pendente: r.products.some((p) => p.financialStatus === "Pendente" && p.situation === "Em Aberto"),
            mgmv: !!r.client.mgmv,
            pago_aguardando: r.products.some((p) => p.financialStatus === "Pago" && p.situation === "Em Aberto"),
            enviado: r.products.some((p) => p.situation === "Enviado"),
            desistiu: r.products.some((p) => p.situation === "Desistiu"),
            abandonou: r.products.some((p) => p.situation === "Abandonou"),
          };
          if (!map[chip]) return false;
        }
        if (financialFilter !== "Todos" && !r.products.some((p) => p.financialStatus === financialFilter)) return false;
        if (situationFilter !== "Todas" && !r.products.some((p) => p.situation === situationFilter)) return false;
        if (platformFilter !== "Todas" && !r.products.some((p) => p.platform === platformFilter)) return false;
        if (periodFilter !== "Todos" && r.last) {
          const diff = (Date.now() - new Date(r.last).getTime()) / 86400000;
          if (periodFilter === "7" && diff > 7) return false;
          if (periodFilter === "30" && diff > 30) return false;
        }
        return true;
      });
  }, [clients, products, search, chip, financialFilter, situationFilter, platformFilter, periodFilter]);

  const totalClients = clients.length;
  const clientesPendencia = clients.filter((c) =>
    products.some(
      (p) =>
        p.clientId === c.id &&
        p.situation === "Em Aberto" &&
        (p.financialStatus === "Pendente" || (p.financialStatus === "Reserva" && isOverdue(p.dueDate))),
    ),
  ).length;
  const clientesMGMV = clients.filter((c) => c.mgmv).length;
  const pagosAgEnvio = products.filter((p) => p.financialStatus === "Pago" && p.situation === "Em Aberto").length;

  const chips: { id: ChipFilter; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "reserva_vencida", label: "Reserva vencida" },
    { id: "pendente", label: "Pendente" },
    { id: "mgmv", label: "MGMV" },
    { id: "pago_aguardando", label: "Pago aguardando envio" },
    { id: "enviado", label: "Enviado" },
    { id: "desistiu", label: "Desistiu" },
    { id: "abandonou", label: "Abandonou" },
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
    <section id="clientes" className="one-page-section">
      <PageHeader
        title="Clientes"
        description="Gerencie clientes, produtos, histórico de compras e situação financeira."
        actions={
          <>
            <Button onClick={() => setClientModal({ open: true, client: null })}>Adicionar Cliente</Button>
            <Button variant="outline" onClick={() => onScrollTo("import")}>Importar Clientes</Button>
            <Button variant="outline" onClick={exportBase}>
              Exportar Base
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Total de Clientes" value={totalClients} />
        <MetricCard label="Clientes com Pendência" value={clientesPendencia} status="danger" />
        <MetricCard label="Clientes em MGMV" value={clientesMGMV} status="primary" />
        <MetricCard label="Pagos aguardando envio" value={pagosAgEnvio} status="success" />
      </div>

      <Card className="mt-6">
        <div className="space-y-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou produto..."
            className="h-10 w-full rounded-full border border-input bg-background px-4 text-sm outline-none focus:border-primary/40"
          />

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

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <select value={financialFilter} onChange={(e) => setFinancialFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="Todos">Status financeiro</option>
              <option>Pago</option><option>Reserva</option><option>Pendente</option><option>MGMV</option>
            </select>
            <select value={situationFilter} onChange={(e) => setSituationFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="Todas">Situação</option>
              <option>Em Aberto</option><option>Enviado</option><option>Desistiu</option><option>Abandonou</option>
            </select>
            <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="Todos">Período</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
            </select>
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="Todas">Plataforma</option>
              <option>PS5</option><option>PS4</option><option>PS2</option><option>Xbox</option><option>Colecionável</option>
            </select>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
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
                <th className="py-2 pr-3 font-medium">Observações</th>
                <th className="py-2 pr-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.client.id} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-3 font-medium">
                    <button onClick={() => setDrawerClientId(r.client.id)} className="text-left hover:text-primary">
                      {r.client.name}
                    </button>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">{r.client.phone}</td>
                  <td className="py-3 pr-3"><Tag variant={r.status.variant}>{r.status.label}</Tag></td>
                  <td className="py-3 pr-3 tabular-nums">{r.products.length}</td>
                  <td className="py-3 pr-3 tabular-nums">{formatBRL(r.totalPurchased)}</td>
                  <td className="py-3 pr-3 tabular-nums font-medium">{formatBRL(r.totalOpen)}</td>
                  <td className="py-3 pr-3 text-muted-foreground">{r.last ? formatDateBR(r.last) : "—"}</td>
                  <td className="py-3 pr-3 max-w-[220px] truncate text-muted-foreground">{r.client.notes ?? "—"}</td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDrawerClientId(r.client.id)}>Abrir</Button>
                      <Button size="sm" variant="ghost" onClick={() => setClientModal({ open: true, client: r.client })}>Editar</Button>
                      <Button size="sm" onClick={() => setProductModal({ open: true, clientId: r.client.id })}>+ Produto</Button>
                      <Button size="sm" variant="ghost" onClick={() => onScrollTo("collection")}>Cobrança</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">Nenhum cliente encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal cliente em tela cheia */}
      <Dialog open={!!drawerClient} onOpenChange={(o) => !o && setDrawerClientId(null)}>
        <DialogContent className="max-w-[min(1200px,95vw)] max-h-[92vh] overflow-y-auto p-8">
          {drawerClient && (
            <ClientDrawer
              client={drawerClient}
              products={products.filter((p) => p.clientId === drawerClient.id)}
              onEdit={() => setClientModal({ open: true, client: drawerClient })}
              onAddProduct={() => setProductModal({ open: true, clientId: drawerClient.id })}
              onEditProduct={(p) => setProductModal({ open: true, clientId: drawerClient.id, product: p })}
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
              onMarkPaid={(p) => {
                updateProduct(p.id, { paidValue: p.totalValue, financialStatus: "Pago" });
                toast.success("Marcado como pago");
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
    </section>
  );
}

function ClientDrawer({
  client,
  products,
  onEdit,
  onAddProduct,
  onEditProduct,
  onSaveNotes,
  onRegisterPayment,
  onChangeSituation,
  onMarkPaid,
}: {
  client: Client;
  products: Product[];
  onEdit: () => void;
  onAddProduct: () => void;
  onEditProduct: (p: Product) => void;
  onSaveNotes: (notes: string) => void;
  onRegisterPayment: (productId: string, remaining: number) => void;
  onChangeSituation: (productId: string, s: Situation) => void;
  onMarkPaid: (p: Product) => void;
}) {
  const [notes, setNotes] = useState(client.notes ?? "");
  const totalBought = products.reduce((a, p) => a + p.totalValue, 0);
  const totalPaid = products.reduce((a, p) => a + p.paidValue, 0);
  const totalRest = products
    .filter((p) => p.situation === "Em Aberto")
    .reduce((a, p) => a + (p.totalValue - p.paidValue), 0);

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle className="text-2xl">{client.name}</DialogTitle>
        <DialogDescription>Telefone: {client.phone}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>Editar Cliente</Button>
        <Button size="sm" onClick={onAddProduct}>Adicionar Produto</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <MetricCard label="Total Comprado" value={formatBRL(totalBought)} />
        <MetricCard label="Valor Pago" value={formatBRL(totalPaid)} status="success" />
        <MetricCard label="Valor Restante" value={formatBRL(totalRest)} status="danger" />
        <MetricCard label="Produtos" value={products.length} />
        <MetricCard label="MGMV" value={client.mgmv ? "Ativo" : "Inativo"} status={client.mgmv ? "primary" : "default"} />
      </div>

      <Card title="Observações">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20" />
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => onSaveNotes(notes)}>Salvar Observação</Button>
        </div>
      </Card>

      <Card title="Histórico de Produtos">
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
              {products.map((p) => {
                const remaining = p.totalValue - p.paidValue;
                const status = productCollectionStatus(p);
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{p.platform}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatBRL(p.totalValue)}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{formatBRL(p.paidValue)}</td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{formatBRL(remaining)}</td>
                    <td className="py-2 pr-3"><Tag variant={status.variant === "danger" ? "danger" : status.variant === "warning" ? "warning" : "neutral"}>{status.label}</Tag></td>
                    <td className="py-2 pr-3"><Tag>{p.situation}</Tag></td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatDateBR(p.registerDate)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatDateBR(p.dueDate)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" onClick={() => onRegisterPayment(p.id, remaining)}>Pagar</Button>
                        <Button size="sm" variant="ghost" onClick={() => onEditProduct(p)}>Editar</Button>
                        <Button size="sm" variant="outline" onClick={() => onMarkPaid(p)}>Pago</Button>
                        <Button size="sm" variant="outline" onClick={() => onChangeSituation(p.id, "Enviado")}>Enviado</Button>
                        <Button size="sm" variant="ghost" onClick={() => onChangeSituation(p.id, "Desistiu")}>Desistiu</Button>
                        <Button size="sm" variant="ghost" onClick={() => onChangeSituation(p.id, "Abandonou")}>Abandonou</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">Nenhum produto.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
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
      <DialogContent className="max-w-xl p-8">
        <DialogHeader>
          <DialogTitle className="text-xl">{state.client ? "Editar Cliente" : "Adicionar Cliente"}</DialogTitle>
          <DialogDescription>O telefone é o identificador principal do cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nome completo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 99999-9999" />
          </div>
          <div className="grid gap-1.5">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
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
  const [financialStatus, setFinancialStatus] = useState<FinancialStatus>(initial?.financialStatus ?? "Reserva");
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
          setDueDate((p?.dueDate ?? new Date(Date.now() + 30 * 86400000).toISOString()).slice(0, 10));
          setFinancialStatus(p?.financialStatus ?? "Reserva");
          setSituation(p?.situation ?? "Em Aberto");
          setNotes(p?.notes ?? "");
        }
      }}
    >
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-8">
        <DialogHeader>
          <DialogTitle className="text-xl">{initial ? "Editar Produto" : "Adicionar Produto"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Cliente vinculado</Label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
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
            <Input type="number" value={totalValue} onChange={(e) => setTotalValue(Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor pago</Label>
            <Input type="number" value={paidValue} onChange={(e) => setPaidValue(Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor restante</Label>
            <Input value={formatBRL(remaining)} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label>Data de cadastro</Label>
            <Input type="date" value={registerDate} onChange={(e) => {
              setRegisterDate(e.target.value);
              if (financialStatus === "Reserva") {
                const d = new Date(e.target.value);
                d.setDate(d.getDate() + 30);
                setDueDate(d.toISOString().slice(0, 10));
              }
            }} />
          </div>
          <div className="grid gap-1.5">
            <Label>Data limite</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Status financeiro</Label>
            <select value={financialStatus} onChange={(e) => {
              const s = e.target.value as FinancialStatus;
              setFinancialStatus(s);
              if (s === "Reserva") {
                const d = new Date(registerDate);
                d.setDate(d.getDate() + 30);
                setDueDate(d.toISOString().slice(0, 10));
              }
            }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option>Pago</option><option>Reserva</option><option>Pendente</option><option>MGMV</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Situação</Label>
            <select value={situation} onChange={(e) => setSituation(e.target.value as Situation)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option>Em Aberto</option><option>Enviado</option><option>Desistiu</option><option>Abandonou</option>
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
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={blockReserva}
            onClick={() => {
              if (!clientId || !name.trim() || !Number.isFinite(totalValue)) return toast.error("Preencha os campos obrigatórios");
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