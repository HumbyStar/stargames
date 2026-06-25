import { useMemo, useState } from "react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  daysLate,
  formatBRL,
  formatDateBR,
  isOverdue,
  productCollectionStatus,
  shouldAppearInCollection,
  useStore,
} from "@/lib/store";
import { toast } from "sonner";

type Filter = "todos" | "reserva_vencida" | "pendente_vencido" | "mgmv_vencido" | "em_aberto";

export function CollectionSection({
  onScrollTo,
  initialFilter = "todos",
}: {
  onScrollTo: (id: string) => void;
  initialFilter?: Filter;
}) {
  const { clients, products, registerPayment, openClient } = useStore();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [platform, setPlatform] = useState("Todas");
  const [period, setPeriod] = useState("Todos");

  const overdueAll = useMemo(() => products.filter(shouldAppearInCollection), [products]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return overdueAll.filter((p) => {
      if (filter === "reserva_vencida" && p.financialStatus !== "Reserva") return false;
      if (filter === "pendente_vencido" && p.financialStatus !== "Pendente") return false;
      if (filter === "mgmv_vencido" && p.financialStatus !== "MGMV") return false;
      if (filter === "em_aberto" && p.situation !== "Em Aberto") return false;
      if (platform !== "Todas" && p.platform !== platform) return false;
      if (period !== "Todos") {
        const reg = new Date(p.registerDate).getTime();
        const diff = (now - reg) / 86400000;
        if (period === "7" && diff > 7) return false;
        if (period === "30" && diff > 30) return false;
        if (period === "mes") {
          const d = new Date();
          const r = new Date(p.registerDate);
          if (d.getMonth() !== r.getMonth() || d.getFullYear() !== r.getFullYear()) return false;
        }
      }
      return true;
    });
  }, [overdueAll, filter, platform, period]);

  const totalAtraso = overdueAll.reduce((a, p) => a + (p.totalValue - p.paidValue), 0);
  const valorRestante = products
    .filter((p) => p.situation === "Em Aberto")
    .reduce((a, p) => a + (p.totalValue - p.paidValue), 0);
  const inadimplentes = new Set(overdueAll.map((p) => p.clientId)).size;
  const reservasVencidas = overdueAll.filter((p) => p.financialStatus === "Reserva").length;
  const pendentesVencidos = overdueAll.filter((p) => p.financialStatus === "Pendente").length;
  const mgmvVencidas = clients.reduce(
    (a, c) => a + (c.mgmv?.installments.filter((i) => !i.paid && isOverdue(i.dueDate)).length ?? 0),
    0,
  );

  const chips: { id: Filter; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "reserva_vencida", label: "Reserva vencida" },
    { id: "pendente_vencido", label: "Pendente vencido" },
    { id: "mgmv_vencido", label: "MGMV vencido" },
    { id: "em_aberto", label: "Em aberto" },
  ];

  const copyMessage = (clientName: string, productName: string, remaining: number) => {
    const msg = `Olá, ${clientName}. Identificamos uma pendência referente ao item ${productName}, no valor restante de ${formatBRL(remaining)}. Podemos regularizar?`;
    navigator.clipboard.writeText(msg);
    toast.success("Mensagem de cobrança copiada");
  };

  const quickPayment = (productId: string, remaining: number) => {
    const raw = window.prompt("Valor recebido (R$):", remaining.toFixed(2));
    if (!raw) return;
    const amount = Number(raw.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    registerPayment(productId, amount);
    toast.success("Pagamento registrado");
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
          <div className="ml-auto flex gap-2">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="Todas">Todas as plataformas</option>
              <option>PS5</option>
              <option>PS4</option>
              <option>PS2</option>
              <option>Xbox</option>
              <option>Colecionável</option>
            </select>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="Todos">Todos os períodos</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="mes">Este mês</option>
            </select>
          </div>
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
              {filtered.map((p) => {
                const client = clients.find((c) => c.id === p.clientId);
                const status = productCollectionStatus(p);
                const remaining = p.totalValue - p.paidValue;
                const late = daysLate(p.dueDate);
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-3 font-medium">{client?.name}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{client?.phone}</td>
                    <td className="py-3 pr-3">{p.name}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{p.platform}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatBRL(p.totalValue)}</td>
                    <td className="py-3 pr-3 tabular-nums text-muted-foreground">{formatBRL(p.paidValue)}</td>
                    <td className="py-3 pr-3 tabular-nums font-medium">{formatBRL(remaining)}</td>
                    <td className="py-3 pr-3"><Tag variant={status.variant === "danger" ? "danger" : status.variant === "warning" ? "warning" : "neutral"}>{status.label}</Tag></td>
                    <td className="py-3 pr-3"><Tag>{p.situation}</Tag></td>
                    <td className="py-3 pr-3 text-muted-foreground">{formatDateBR(p.dueDate)}</td>
                    <td className="py-3 pr-3"><Tag variant={late > 7 ? "danger" : "warning"}>{late} dias</Tag></td>
                    <td className="py-3 pr-3">
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
                          onClick={() => copyMessage(client?.name ?? "", p.name, remaining)}
                        >
                          Copiar
                        </Button>
                        <Button size="sm" onClick={() => quickPayment(p.id, remaining)}>
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
      </Card>

      <div className="mt-4 text-xs text-muted-foreground">
        <button
          className="underline-offset-2 hover:underline"
          onClick={() => onScrollTo("dashboard")}
        >
          ← Voltar para o Dashboard
        </button>
      </div>
    </section>
  );
}