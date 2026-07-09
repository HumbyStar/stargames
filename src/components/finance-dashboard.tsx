import { useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CircleDollarSign,
  AlertTriangle,
  Receipt,
  Users,
  PiggyBank,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Trophy,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  useStore,
  calculateClientFinancialSummary,
  isOpenSituation,
  isOverdue,
  type Client,
  type Product,
} from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const STATUS_COLORS: Record<string, string> = {
  Pago: "oklch(0.65 0.16 150)",
  Pendente: "oklch(0.78 0.15 75)",
  Reserva: "oklch(0.65 0.2 260)",
  MGMV: "oklch(0.6 0.22 25)",
};

type TimelineMode = "7d" | "30d" | "6m" | "12m" | "all";

interface TimelineBucket {
  key: string;
  label: string;
  registrado: number;
  recebido: number;
  aReceber: number;
  inadimplencia: number;
}

function bucketKeyFor(
  date: Date,
  granularity: "day" | "month" | "year",
): { key: string; label: string } {
  if (granularity === "day") {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const label = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return { key, label };
  }
  if (granularity === "month") {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleString("pt-BR", { month: "short" }).replace(".", "");
    return { key, label };
  }
  const key = String(date.getFullYear());
  return { key, label: key };
}

function buildTimeline(
  products: readonly Product[],
  clients: readonly Client[],
  mode: TimelineMode,
): TimelineBucket[] {
  const now = new Date();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  let granularity: "day" | "month" | "year";
  const buckets: TimelineBucket[] = [];
  const idx = new Map<string, number>();

  const push = (d: Date) => {
    const { key, label } = bucketKeyFor(d, granularity);
    if (idx.has(key)) return;
    idx.set(key, buckets.length);
    buckets.push({ key, label, registrado: 0, recebido: 0, aReceber: 0, inadimplencia: 0 });
  };

  if (mode === "7d" || mode === "30d") {
    granularity = "day";
    const days = mode === "7d" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    }
  } else if (mode === "6m" || mode === "12m") {
    granularity = "month";
    const months = mode === "6m" ? 6 : 12;
    for (let i = months - 1; i >= 0; i--) {
      push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }
  } else {
    granularity = "year";
    let earliest = now.getFullYear();
    for (const p of products) {
      const d = new Date(p.registerDate || p.dueDate || now);
      if (!Number.isNaN(d.getTime())) earliest = Math.min(earliest, d.getFullYear());
    }
    for (const c of clients) {
      if (!c.mgmv) continue;
      const d = new Date(c.mgmv.startDate || now);
      if (!Number.isNaN(d.getTime())) earliest = Math.min(earliest, d.getFullYear());
    }
    for (let y = earliest; y <= now.getFullYear(); y++) {
      push(new Date(y, 0, 1));
    }
  }

  const bucketOf = (d: Date) => idx.get(bucketKeyFor(d, granularity).key);

  for (const p of products) {
    const owner = clientById.get(p.clientId);
    if (owner?.mgmv && p.financialStatus === "MGMV") continue;

    const reg = new Date(p.registerDate || p.dueDate || 0);
    if (!Number.isNaN(reg.getTime())) {
      const i = bucketOf(reg);
      if (i !== undefined) {
        buckets[i].registrado += p.totalValue || 0;
        buckets[i].recebido += p.paidValue || 0;
      }
    }
    const saldo = Math.max(0, (p.totalValue || 0) - (p.paidValue || 0));
    if (
      saldo > 0 &&
      p.financialStatus !== "Pago" &&
      p.financialStatus !== "MGMV" &&
      isOpenSituation(p)
    ) {
      const due = new Date(p.dueDate || 0);
      if (!Number.isNaN(due.getTime())) {
        const i = bucketOf(due);
        if (i !== undefined) {
          buckets[i].aReceber += saldo;
          if (isOverdue(p.dueDate)) buckets[i].inadimplencia += saldo;
        }
      }
    }
  }

  for (const c of clients) {
    if (!c.mgmv) continue;
    const start = new Date(c.mgmv.startDate || 0);
    if (!Number.isNaN(start.getTime())) {
      const i = bucketOf(start);
      if (i !== undefined) buckets[i].registrado += c.mgmv.totalDebt || 0;
    }

    for (const inst of c.mgmv.installments) {
      const paidAmt = inst.paidAmount ?? (inst.paid ? inst.value : 0);
      if (paidAmt > 0) {
        const pd = new Date(inst.paidAt || inst.dueDate || 0);
        if (!Number.isNaN(pd.getTime())) {
          const i = bucketOf(pd);
          if (i !== undefined) buckets[i].recebido += paidAmt;
        }
      }
      const rem = Math.max(0, inst.value - paidAmt);
      if (!inst.paid && rem > 0) {
        const due = new Date(inst.dueDate || 0);
        if (!Number.isNaN(due.getTime())) {
          const i = bucketOf(due);
          if (i !== undefined) {
            buckets[i].aReceber += rem;
            if (isOverdue(inst.dueDate)) buckets[i].inadimplencia += rem;
          }
        }
      }
    }
  }

  return buckets;
}

function computeClientDebt(client: Client, products: readonly Product[]): number {
  return calculateClientFinancialSummary(client, products).totalRemaining;
}

/**
 * Inadimplência real por cliente: soma apenas o que está VENCIDO e em aberto.
 * Alinhado com computeClientDebt — assim os KPIs "A Receber" e
 * "Inadimplência" batem com o saldo exibido no card do cliente e no
 * "Top devedores", em vez de contar produtos MGMV (cujo vencimento
 * original é histórico e já foi substituído pelas parcelas do acordo).
 */
function computeClientOverdue(client: Client, products: readonly Product[]): number {
  return calculateClientFinancialSummary(client, products).overdueValue;
}

function computeClientBuyerScore(
  client: Client,
  products: readonly Product[],
): { eligible: boolean; totalPurchased: number } {
  const clientProducts = products.filter((p) => p.clientId === client.id);
  const summary = calculateClientFinancialSummary(client, products);
  if (clientProducts.length === 0 && !client.mgmv) return { eligible: false, totalPurchased: 0 };
  if (summary.totalRemaining > 0 || summary.overdueValue > 0) {
    return { eligible: false, totalPurchased: 0 };
  }

  for (const p of clientProducts) {
    if (p.situation === "Desistiu" || p.situation === "Abandonou" || p.situation === "Removido") {
      return { eligible: false, totalPurchased: 0 };
    }
    if (p.financialStatus === "Pendente") return { eligible: false, totalPurchased: 0 };
    if (
      p.financialStatus === "Reserva" &&
      isOpenSituation(p) &&
      isOverdue(p.dueDate)
    ) {
      return { eligible: false, totalPurchased: 0 };
    }
  }

  if (client.mgmv) {
    for (const inst of client.mgmv.installments) {
      if (!inst.paid && isOverdue(inst.dueDate)) {
        return { eligible: false, totalPurchased: 0 };
      }
    }
  }

  return { eligible: summary.totalPurchased > 0, totalPurchased: summary.totalPurchased };
}

function Kpi({
  label,
  value,
  trend,
  hint,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  trend?: { dir: "up" | "down"; pct: string };
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  const toneBg: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("grid size-10 place-items-center rounded-xl", toneBg[tone])}>
          <Icon className="size-5" />
        </div>
      </div>
      {trend && (
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            trend.dir === "up"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {trend.dir === "up" ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {trend.pct}
        </div>
      )}
    </div>
  );
}

export function FinanceDashboard() {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);
  const closeFinance = useUiStore((s) => s.closeFinance);
  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("6m");

  const handleOpenClient = (client: Client) => {
    closeFinance();
    setActiveSection(client.mgmv ? "mgmv" : "clientes");
    openClient(client.id);
  };

  const data = useMemo(() => {
    const summaries = clients.map((c) => ({
      client: c,
      summary: calculateClientFinancialSummary(c, products),
    }));
    const total = summaries.reduce((s, r) => s + r.summary.totalPurchased, 0);
    const received = summaries.reduce((s, r) => s + r.summary.totalPaid, 0);

    const byStatus = products.reduce<Record<string, { count: number; value: number }>>((acc, p) => {
      const k = p.financialStatus || "Pendente";
      if (!acc[k]) acc[k] = { count: 0, value: 0 };
      acc[k].count += 1;
      acc[k].value += p.totalValue || 0;
      return acc;
    }, {});
    const statusData = Object.entries(byStatus).map(([name, v]) => ({
      name,
      value: v.value,
      count: v.count,
    }));

    // Top 5 platforms
    const byPlatform = products.reduce<Record<string, number>>((acc, p) => {
      const k = p.platform || "Outros";
      acc[k] = (acc[k] || 0) + (p.totalValue || 0);
      return acc;
    }, {});
    const platforms = Object.entries(byPlatform)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Top devedores — inclui parcelas MGMV em aberto + produtos fora do acordo
    const topDebtors = clients
      .map((c) => ({ client: c, debt: computeClientDebt(c, products) }))
      .filter((r) => r.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 6);

    // Top compradores — apenas clientes sem pendência
    const topBuyers = clients
      .map((c) => {
        const s = computeClientBuyerScore(c, products);
        return { client: c, totalPurchased: s.totalPurchased, eligible: s.eligible };
      })
      .filter((r) => r.eligible)
      .sort((a, b) => b.totalPurchased - a.totalPurchased)
      .slice(0, 6);

    // MGMV totals
    const mgmvClients = clients.filter((c) => c.mgmv);
    const mgmvTotal = mgmvClients.reduce((s, c) => s + (c.mgmv?.totalDebt || 0), 0);
    const mgmvPaid = summaries.reduce((s, r) => s + r.summary.mgmvPaid, 0);
    // "A Receber" e "Inadimplência" precisam usar as mesmas regras do saldo
    // por cliente (computeClientDebt), senão produtos MGMV (que têm dueDate
    // histórico do produto original) inflam o valor mesmo quando o acordo
    // está em dia. Um cliente sem parcelas vencidas nem produtos em aberto
    // vencidos passa a mostrar R$ 0 de inadimplência.
    const openTotal = summaries.reduce((s, r) => s + r.summary.totalRemaining, 0);
    const overdueValue = summaries.reduce((s, r) => s + r.summary.overdueValue, 0);
    const overdueCount = summaries.reduce((s, r) => s + r.summary.overdueCount, 0);
    const receivedPct = total > 0 ? (received / total) * 100 : 0;
    const ticket = products.length > 0 ? total / products.length : 0;
    return {
      total,
      received,
      open: openTotal,
      receivedPct,
      statusData,
      platforms,
      topDebtors,
      topBuyers,
      mgmvTotal,
      mgmvPaid,
      overdueValue,
      overdueCount,
      ticket,
      activeClients: clients.length,
    };
  }, [clients, products]);

  const timeline = useMemo(
    () => buildTimeline(products, clients, timelineMode),
    [products, clients, timelineMode],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Finanças</h2>
        <p className="text-sm text-muted-foreground">
          Visão consolidada do desempenho financeiro da operação.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Faturamento Total"
          value={fmt(data.total)}
          icon={CircleDollarSign}
          tone="primary"
          hint={`${products.length} produtos`}
        />
        <Kpi
          label="Recebido"
          value={fmt(data.received)}
          icon={Wallet}
          tone="success"
          trend={{ dir: "up", pct: `${data.receivedPct.toFixed(1)}%` }}
          hint="do faturamento total"
        />
        <Kpi
          label="A Receber"
          value={fmt(data.open)}
          icon={Receipt}
          tone="warning"
          hint={`${data.activeClients} clientes ativos`}
        />
        <Kpi
          label="Inadimplência"
          value={fmt(data.overdueValue)}
          icon={AlertTriangle}
          tone="destructive"
          trend={{ dir: "down", pct: `${data.overdueCount} vencidos` }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Fluxo financeiro</p>
              <p className="text-xs text-muted-foreground">Registrado, Recebido, A Receber e Inadimplência</p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={timelineMode} onValueChange={(v) => setTimelineMode(v as TimelineMode)}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="6m">Últimos 6 meses</SelectItem>
                  <SelectItem value="12m">Últimos 12 meses</SelectItem>
                  <SelectItem value="all">Todos os anos</SelectItem>
                </SelectContent>
              </Select>
              <TrendingUp className="size-4 text-primary" />
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <defs>
                  <linearGradient id="grad-reg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.65 0.2 260)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="oklch(0.65 0.2 260)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-rec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.65 0.16 150)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="oklch(0.65 0.16 150)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-arec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.78 0.15 75)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.78 0.15 75)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-inad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.6 0.22 25)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.6 0.22 25)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.15)" />
                <XAxis dataKey="label" stroke="currentColor" fontSize={11} />
                <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => fmt(v).replace("R$", "")} />
                <RTooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="registrado" name="Registrado" stroke="oklch(0.55 0.2 260)" fill="url(#grad-reg)" strokeWidth={2} />
                <Area type="monotone" dataKey="recebido" name="Recebido" stroke="oklch(0.65 0.16 150)" fill="url(#grad-rec)" strokeWidth={2} />
                <Area type="monotone" dataKey="aReceber" name="A Receber" stroke="oklch(0.78 0.15 75)" fill="url(#grad-arec)" strokeWidth={2} />
                <Area type="monotone" dataKey="inadimplencia" name="Inadimplência" stroke="oklch(0.6 0.22 25)" fill="url(#grad-inad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Status financeiro</p>
              <p className="text-xs text-muted-foreground">Distribuição por valor</p>
            </div>
            <PiggyBank className="size-4 text-primary" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.statusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {data.statusData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "oklch(0.6 0.05 260)"} />
                  ))}
                </Pie>
                <RTooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Top plataformas</p>
              <p className="text-xs text-muted-foreground">Faturamento por plataforma</p>
            </div>
            <TrendingUp className="size-4 text-primary" />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.platforms} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.15)" horizontal={false} />
                <XAxis type="number" stroke="currentColor" fontSize={11} tickFormatter={(v) => fmt(v).replace("R$", "")} />
                <YAxis type="category" dataKey="name" stroke="currentColor" fontSize={11} width={90} />
                <RTooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="value" fill="oklch(0.55 0.2 260)" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Top devedores</p>
              <p className="text-xs text-muted-foreground">Maior saldo em aberto</p>
            </div>
            <TrendingDown className="size-4 text-destructive" />
          </div>
          <ul className="divide-y divide-border">
            {data.topDebtors.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">
                Nenhum saldo em aberto.
              </li>
            )}
            {data.topDebtors.map((d, i) => (
              <li key={d.client.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <p className="truncate text-sm font-medium">{d.client.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-destructive">{fmt(d.debt)}</p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => handleOpenClient(d.client)}
                    aria-label={`Abrir ${d.client.name}`}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Top compradores</p>
              <p className="text-xs text-muted-foreground">Clientes em dia, sem pendência</p>
            </div>
            <Trophy className="size-4 text-success" />
          </div>
          <ul className="divide-y divide-border">
            {data.topBuyers.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">
                Nenhum cliente elegível.
              </li>
            )}
            {data.topBuyers.map((d, i) => (
              <li key={d.client.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-success/10 text-xs font-semibold text-success">
                    {i + 1}
                  </span>
                  <p className="truncate text-sm font-medium">{d.client.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-success">{fmt(d.totalPurchased)}</p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => handleOpenClient(d.client)}
                    aria-label={`Abrir ${d.client.name}`}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi label="MGMV em acordo" value={fmt(data.mgmvTotal)} icon={Users} tone="primary" hint="Total negociado" />
        <Kpi
          label="MGMV recebido"
          value={fmt(data.mgmvPaid)}
          icon={Wallet}
          tone="success"
          hint={data.mgmvTotal > 0 ? `${((data.mgmvPaid / data.mgmvTotal) * 100).toFixed(1)}% do acordo` : "—"}
        />
        <Kpi label="Ticket médio" value={fmt(data.ticket)} icon={CircleDollarSign} tone="primary" hint="Por produto" />
      </div>
    </div>
  );
}