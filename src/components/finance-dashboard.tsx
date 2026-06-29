import { useMemo } from "react";
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
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const STATUS_COLORS: Record<string, string> = {
  Pago: "oklch(0.65 0.16 150)",
  Pendente: "oklch(0.78 0.15 75)",
  Reserva: "oklch(0.65 0.2 260)",
  MGMV: "oklch(0.6 0.22 25)",
};

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

  const data = useMemo(() => {
    const total = products.reduce((s, p) => s + (p.totalValue || 0), 0);
    const received = products.reduce((s, p) => s + (p.paidValue || 0), 0);
    const open = Math.max(0, total - received);

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

    // Monthly registered/received over last 6 months
    const months: { key: string; label: string; registrado: number; recebido: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({
        key,
        label: d.toLocaleString("pt-BR", { month: "short" }).replace(".", ""),
        registrado: 0,
        recebido: 0,
      });
    }
    const idx = new Map(months.map((m, i) => [m.key, i]));
    for (const p of products) {
      const d = new Date(p.registerDate || p.dueDate || Date.now());
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const i = idx.get(key);
      if (i !== undefined) {
        months[i].registrado += p.totalValue || 0;
        months[i].recebido += p.paidValue || 0;
      }
    }

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

    // Top devedores
    const debtByClient = new Map<string, number>();
    for (const p of products) {
      const debt = Math.max(0, (p.totalValue || 0) - (p.paidValue || 0));
      if (debt > 0) debtByClient.set(p.clientId, (debtByClient.get(p.clientId) || 0) + debt);
    }
    const topDebtors = [...debtByClient.entries()]
      .map(([clientId, debt]) => {
        const c = clients.find((cl) => cl.id === clientId);
        return { name: c?.name ?? "Cliente removido", debt };
      })
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 6);

    // MGMV totals
    const mgmvClients = clients.filter((c) => c.mgmv);
    const mgmvTotal = mgmvClients.reduce((s, c) => s + (c.mgmv?.totalDebt || 0), 0);
    const mgmvPaid = mgmvClients.reduce(
      (s, c) =>
        s + (c.mgmv?.installments.filter((i) => i.paid).reduce((ss, i) => ss + i.value, 0) || 0),
      0,
    );
    const overdueProducts = products.filter(
      (p) =>
        p.financialStatus !== "Pago" &&
        p.dueDate &&
        new Date(p.dueDate).getTime() < Date.now(),
    );
    const overdueValue = overdueProducts.reduce(
      (s, p) => s + Math.max(0, (p.totalValue || 0) - (p.paidValue || 0)),
      0,
    );
    const receivedPct = total > 0 ? (received / total) * 100 : 0;
    const ticket = products.length > 0 ? total / products.length : 0;
    return {
      total,
      received,
      open,
      receivedPct,
      statusData,
      months,
      platforms,
      topDebtors,
      mgmvTotal,
      mgmvPaid,
      overdueValue,
      overdueCount: overdueProducts.length,
      ticket,
      activeClients: clients.length,
    };
  }, [clients, products]);

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
              <p className="text-sm font-semibold">Fluxo financeiro (6 meses)</p>
              <p className="text-xs text-muted-foreground">Registrado vs Recebido</p>
            </div>
            <TrendingUp className="size-4 text-primary" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.months}>
                <defs>
                  <linearGradient id="grad-reg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.65 0.2 260)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="oklch(0.65 0.2 260)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-rec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.65 0.16 150)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="oklch(0.65 0.16 150)" stopOpacity={0} />
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
                <Area type="monotone" dataKey="registrado" name="Registrado" stroke="oklch(0.55 0.2 260)" fill="url(#grad-reg)" strokeWidth={2} />
                <Area type="monotone" dataKey="recebido" name="Recebido" stroke="oklch(0.65 0.16 150)" fill="url(#grad-rec)" strokeWidth={2} />
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <p className="truncate text-sm font-medium">{d.name}</p>
                </div>
                <p className="text-sm font-semibold text-destructive">{fmt(d.debt)}</p>
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