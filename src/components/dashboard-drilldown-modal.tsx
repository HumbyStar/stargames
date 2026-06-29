import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui-bits";
import { setUiValue } from "@/lib/db-sync";
import {
  daysLate,
  formatBRL,
  formatDateBR,
  getMGMVDisplay,
  isOverdue,
  shouldAppearInCollection,
  useStore,
  type Client,
  type Product,
} from "@/lib/store";
import { toast } from "sonner";
import {
  ArrowRight,
  ExternalLink,
  MessageCircle,
  CheckCircle2,
  Truck,
  User,
} from "lucide-react";

export type DashboardCardId =
  | "total-clients"
  | "total-products"
  | "active-reservations"
  | "overdue-reservations"
  | "pending"
  | "mgmv-clients"
  | "mgmv-overdue"
  | "paid-awaiting-shipment"
  | "shipped"
  | "withdrawals"
  | "abandons"
  | "review-required"
  | "ai-reviewed";

type Row = {
  id: string;
  client: Client;
  // optional product context
  product?: Product;
  // formatted columns
  primary: string; // product name or "Acordo MGMV"
  meta: string; // platform / parcela
  value: number; // remaining or installment value
  dueDate?: string;
  statusLabel: string;
  statusVariant: "danger" | "warning" | "success" | "neutral" | "primary";
  kind: "product" | "mgmv" | "client";
};

type CardConfig = {
  title: string;
  description: string;
  targetSection: "clientes" | "mgmv" | "collection" | "dashboard";
  applySectionFilter?: () => void;
  buildRows: (clients: Client[], products: Product[]) => Row[];
  actions: ("openClient" | "whatsapp" | "markShipped" | "markDelivered" | "markPaid" | "payInstallment")[];
  showTotal?: boolean;
};

function buildClientRow(c: Client): Row {
  return {
    id: c.id,
    client: c,
    primary: c.name,
    meta: c.phone || "—",
    value: 0,
    statusLabel: c.mgmv ? "MGMV" : "Comum",
    statusVariant: c.mgmv ? "primary" : "neutral",
    kind: "client",
  };
}

function buildProductRow(
  p: Product,
  client: Client,
  statusLabel: string,
  statusVariant: Row["statusVariant"],
): Row {
  return {
    id: p.id,
    client,
    product: p,
    primary: p.name,
    meta: p.platform,
    value: p.totalValue - p.paidValue,
    dueDate: p.dueDate,
    statusLabel,
    statusVariant,
    kind: "product",
  };
}

function buildMgmvRow(c: Client): Row | null {
  const d = getMGMVDisplay(c);
  if (!d) return null;
  const next = d.nextInstallment;
  return {
    id: c.id,
    client: c,
    primary: "Acordo MGMV",
    meta: next ? `Parcela ${next.number}/${next.total}` : "—",
    value: next?.value ?? d.installmentValue,
    dueDate: next?.dueDate,
    statusLabel: d.hasOverdue ? "Parcela vencida" : d.active ? "Ativo" : "Quitado",
    statusVariant: d.hasOverdue ? "danger" : d.active ? "primary" : "success",
    kind: "mgmv",
  };
}

function hasIncludedInMgmv(p: Product, clients: Client[]): boolean {
  const c = clients.find((x) => x.id === p.clientId);
  return !!c?.mgmv;
}

const CARDS: Record<DashboardCardId, CardConfig> = {
  "total-clients": {
    title: "Clientes cadastrados",
    description: "Todos os clientes comuns cadastrados no sistema.",
    targetSection: "clientes",
    applySectionFilter: () => setUiValue("clientes.chip", "todos"),
    buildRows: (clients) =>
      clients
        .filter((c) => c.clientType !== "mgmv" && !c.mgmv)
        .map(buildClientRow),
    actions: ["openClient"],
  },
  "total-products": {
    title: "Produtos cadastrados",
    description: "Todos os produtos cadastrados no sistema.",
    targetSection: "clientes",
    buildRows: (clients, products) =>
      products.map((p) => {
        const client = clients.find((c) => c.id === p.clientId)!;
        return buildProductRow(p, client, p.financialStatus, "neutral");
      }),
    actions: ["openClient"],
    showTotal: false,
  },
  "active-reservations": {
    title: "Reservas ativas",
    description: "Reservas em aberto (não inclui produtos MGMV).",
    targetSection: "clientes",
    applySectionFilter: () => setUiValue("clientes.chip", "reserva_vencida"),
    buildRows: (clients, products) =>
      products
        .filter(
          (p) =>
            p.financialStatus === "Reserva" &&
            p.situation === "Em Aberto" &&
            !hasIncludedInMgmv(p, clients),
        )
        .map((p) => buildProductRow(p, clients.find((c) => c.id === p.clientId)!, "Reserva", "primary")),
    actions: ["openClient", "whatsapp", "markPaid"],
    showTotal: true,
  },
  "overdue-reservations": {
    title: "Reservas vencidas",
    description: "Reservas vencidas acionáveis (não inclui MGMV).",
    targetSection: "collection",
    applySectionFilter: () => setUiValue("collection.filter", "reserva_vencida"),
    buildRows: (clients, products) =>
      products
        .filter(
          (p) =>
            shouldAppearInCollection(p) &&
            p.financialStatus === "Reserva" &&
            !hasIncludedInMgmv(p, clients),
        )
        .map((p) => buildProductRow(p, clients.find((c) => c.id === p.clientId)!, "Reserva vencida", "danger")),
    actions: ["openClient", "whatsapp", "markPaid"],
    showTotal: true,
  },
  pending: {
    title: "Pendências em aberto",
    description: "Cobranças pendentes e pendentes vencidas.",
    targetSection: "collection",
    applySectionFilter: () => setUiValue("collection.filter", "pendente_vencido"),
    buildRows: (clients, products) =>
      products
        .filter(
          (p) =>
            p.financialStatus === "Pendente" &&
            p.situation === "Em Aberto" &&
            !hasIncludedInMgmv(p, clients),
        )
        .map((p) =>
          buildProductRow(
            p,
            clients.find((c) => c.id === p.clientId)!,
            isOverdue(p.dueDate) ? "Pendente vencido" : "Pendente",
            isOverdue(p.dueDate) ? "danger" : "warning",
          ),
        ),
    actions: ["openClient", "whatsapp", "markPaid"],
    showTotal: true,
  },
  "mgmv-clients": {
    title: "Clientes MGMV",
    description: "Todos os clientes com acordo MGMV.",
    targetSection: "mgmv",
    applySectionFilter: () => setUiValue("mgmv.chip", "todos"),
    buildRows: (clients) =>
      clients
        .filter((c) => c.mgmv)
        .map((c) => buildMgmvRow(c))
        .filter((r): r is Row => !!r),
    actions: ["openClient"],
  },
  "mgmv-overdue": {
    title: "MGMV vencidas",
    description: "Acordos MGMV com parcelas vencidas.",
    targetSection: "mgmv",
    applySectionFilter: () => setUiValue("mgmv.chip", "vencidos"),
    buildRows: (clients) =>
      clients
        .filter((c) => c.mgmv?.installments.some((i) => !i.paid && isOverdue(i.dueDate)))
        .map((c) => buildMgmvRow(c))
        .filter((r): r is Row => !!r),
    actions: ["openClient", "whatsapp", "payInstallment"],
    showTotal: true,
  },
  "paid-awaiting-shipment": {
    title: "Pagos aguardando envio",
    description: "Produtos pagos que ainda não foram enviados.",
    targetSection: "clientes",
    applySectionFilter: () => setUiValue("clientes.chip", "pago_aguardando"),
    buildRows: (clients, products) =>
      products
        .filter((p) => p.financialStatus === "Pago" && p.situation === "Em Aberto")
        .map((p) => buildProductRow(p, clients.find((c) => c.id === p.clientId)!, "Pago ag. envio", "success")),
    actions: ["openClient", "markShipped"],
  },
  shipped: {
    title: "Produtos enviados",
    description: "Produtos com situação Enviado.",
    targetSection: "clientes",
    applySectionFilter: () => setUiValue("clientes.chip", "enviado"),
    buildRows: (clients, products) =>
      products
        .filter((p) => p.situation === "Enviado")
        .map((p) => buildProductRow(p, clients.find((c) => c.id === p.clientId)!, "Enviado", "neutral")),
    actions: ["openClient", "markDelivered"],
  },
  withdrawals: {
    title: "Desistências",
    description: "Produtos cuja situação foi marcada como Desistiu.",
    targetSection: "clientes",
    applySectionFilter: () => setUiValue("clientes.chip", "desistiu"),
    buildRows: (clients, products) =>
      products
        .filter((p) => p.situation === "Desistiu")
        .map((p) => buildProductRow(p, clients.find((c) => c.id === p.clientId)!, "Desistiu", "warning")),
    actions: ["openClient"],
  },
  abandons: {
    title: "Abandonos",
    description: "Produtos cuja situação foi marcada como Abandonou.",
    targetSection: "clientes",
    applySectionFilter: () => setUiValue("clientes.chip", "abandonou"),
    buildRows: (clients, products) =>
      products
        .filter((p) => p.situation === "Abandonou")
        .map((p) => buildProductRow(p, clients.find((c) => c.id === p.clientId)!, "Abandonou", "danger")),
    actions: ["openClient"],
  },
  "review-required": {
    title: "Revisões necessárias",
    description: "Acordos MGMV que precisam de revisão.",
    targetSection: "mgmv",
    applySectionFilter: () => setUiValue("mgmv.chip", "revisao"),
    buildRows: (clients) =>
      clients
        .filter((c) => c.mgmv?.reviewStatus === "review_required")
        .map((c) => buildMgmvRow(c))
        .filter((r): r is Row => !!r),
    actions: ["openClient"],
  },
  "ai-reviewed": {
    title: "Revisados com IA",
    description: "Acordos MGMV revisados via inteligência artificial.",
    targetSection: "mgmv",
    applySectionFilter: () => setUiValue("mgmv.chip", "revisado_ia"),
    buildRows: (clients) =>
      clients
        .filter((c) => c.mgmv?.reviewStatus === "ai_reviewed")
        .map((c) => buildMgmvRow(c))
        .filter((r): r is Row => !!r),
    actions: ["openClient"],
  },
};

function formatPhoneIntl(phone: string) {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("55") ? d : `55${d}`;
}

export function DashboardDrilldownModal({
  cardId,
  onClose,
  onScrollTo,
}: {
  cardId: DashboardCardId | null;
  onClose: () => void;
  onScrollTo: (id: string) => void;
}) {
  const { clients, products, openClient, registerPayment, setProductSituation, payMGMVInstallment } =
    useStore();
  const [search, setSearch] = useState("");

  const config = cardId ? CARDS[cardId] : null;
  const rows = useMemo(() => (config ? config.buildRows(clients, products) : []), [config, clients, products]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const qDigits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      const hay = `${r.client.name} ${r.primary} ${r.meta} ${r.statusLabel}`.toLowerCase();
      const phone = (r.client.phone || "").replace(/\D/g, "");
      return hay.includes(q) || (qDigits && phone.includes(qDigits));
    });
  }, [rows, search]);

  const total = useMemo(() => filtered.reduce((s, r) => s + r.value, 0), [filtered]);

  if (!config || !cardId) return null;

  const goToSection = () => {
    config.applySectionFilter?.();
    onClose();
    setTimeout(() => onScrollTo(config.targetSection), 50);
  };

  const openClientAt = (clientId: string) => {
    openClient(clientId);
    onClose();
    setTimeout(() => onScrollTo("clientes"), 50);
  };

  const doWhatsApp = (row: Row) => {
    const intl = formatPhoneIntl(row.client.phone);
    if (!intl) {
      toast.error("Cliente sem telefone");
      return;
    }
    const first = (row.client.name || "").split(" ")[0] || row.client.name;
    const valor = formatBRL(row.value);
    const venc = row.dueDate ? formatDateBR(row.dueDate) : "";
    const msg = `Olá, ${first}! Aqui é da Star Games. Sobre *${row.primary}* — valor *${valor}*${venc ? `, vencimento ${venc}` : ""}. Podemos regularizar?`;
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const doMarkPaid = (row: Row) => {
    if (!row.product) return;
    registerPayment(row.product.id, row.value);
    toast.success("Pagamento registrado");
  };

  const doMarkShipped = (row: Row) => {
    if (!row.product) return;
    setProductSituation(row.product.id, "Enviado");
    toast.success("Marcado como enviado");
  };

  const doMarkDelivered = (row: Row) => {
    if (!row.product) return;
    setProductSituation(row.product.id, "Resolvido");
    toast.success("Marcado como entregue");
  };

  const doPayInstallment = (row: Row) => {
    const next = row.client.mgmv?.installments.find((i) => !i.paid);
    if (!next) return;
    payMGMVInstallment(row.client.id, next.number);
    toast.success(`Parcela ${next.number}/${next.total} paga`);
  };

  return (
    <Dialog open={!!cardId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Tag variant="neutral">{filtered.length} registros</Tag>
            {config.showTotal && total > 0 ? (
              <Tag variant="danger">Em aberto: {formatBRL(total)}</Tag>
            ) : null}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, telefone ou produto..."
            className="h-9 w-full max-w-xs"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            Nenhum registro encontrado para este indicador.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Vencimento</th>
                  <th className="py-2 pr-3 font-medium text-right">Valor</th>
                  <th className="py-2 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.client.name}</div>
                      <div className="text-xs text-muted-foreground">{row.client.phone || "—"}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{row.primary}</div>
                      <div className="text-xs text-muted-foreground">{row.meta}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Tag variant={row.statusVariant}>{row.statusLabel}</Tag>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {row.dueDate ? (
                        <>
                          {formatDateBR(row.dueDate)}
                          {isOverdue(row.dueDate) ? (
                            <span className="ml-1 text-destructive">({daysLate(row.dueDate)}d)</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.value > 0 ? formatBRL(row.value) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        {config.actions.includes("openClient") && (
                          <Button size="sm" variant="ghost" onClick={() => openClientAt(row.client.id)} title="Abrir cliente">
                            <User className="size-3.5" />
                          </Button>
                        )}
                        {config.actions.includes("whatsapp") && (
                          <Button size="sm" variant="ghost" onClick={() => doWhatsApp(row)} title="Enviar WhatsApp">
                            <MessageCircle className="size-3.5" />
                          </Button>
                        )}
                        {config.actions.includes("markPaid") && row.product && (
                          <Button size="sm" variant="ghost" onClick={() => doMarkPaid(row)} title="Marcar pagamento">
                            <CheckCircle2 className="size-3.5" />
                          </Button>
                        )}
                        {config.actions.includes("markShipped") && row.product && (
                          <Button size="sm" variant="ghost" onClick={() => doMarkShipped(row)} title="Marcar como enviado">
                            <Truck className="size-3.5" />
                          </Button>
                        )}
                        {config.actions.includes("markDelivered") && row.product && (
                          <Button size="sm" variant="ghost" onClick={() => doMarkDelivered(row)} title="Marcar como entregue">
                            <CheckCircle2 className="size-3.5" />
                          </Button>
                        )}
                        {config.actions.includes("payInstallment") && row.client.mgmv && (
                          <Button size="sm" variant="ghost" onClick={() => doPayInstallment(row)} title="Pagar próxima parcela">
                            <CheckCircle2 className="size-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openClientAt(row.client.id)} title="Abrir na seção">
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={goToSection}>
            Ver na seção correspondente
            <ArrowRight className="size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}