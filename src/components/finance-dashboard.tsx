import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import {
  getFinanceAggregates,
  type FinanceAggregates,
  type TimelineMode,
} from "@/lib/api/finance.functions";
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
  const openClient = useStore((s) => s.openClient);
  const closeFinance = useUiStore((s) => s.closeFinance);
  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("6m");

  // Finanças agora vem pronto do servidor: uma única consulta agregada,
  // com cache de 5 minutos e botão de atualizar (em vez de recalcular a base
  // inteira no navegador a cada abertura).
  const aggregatesFn = useServerFn(getFinanceAggregates);
  const query = useQuery({
    queryKey: ["finance-aggregates"],
    queryFn: () => aggregatesFn(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const handleOpenClient = (clientId: string, isMgmv: boolean) => {
    closeFinance();
    setActiveSection(isMgmv ? "mgmv" : "clientes");
    openClient(clientId);
  };

  const empty: FinanceAggregates = {
    total: 0,
    received: 0,
    open: 0,
    receivedPct: 0,
    statusData: [],
    platforms: [],
    topDebtors: [],
    topBuyers: [],
    mgmvTotal: 0,
    mgmvPaid: 0,
    overdueValue: 0,
    overdueCount: 0,
    ticket: 0,
    activeClients: 0,
    productsCount: 0,
    timelines: { "7d": [], "30d": [], "6m": [], "12m": [], all: [] },
    generatedAt: "",
  };
  const data = query.data ?? empty;
  const timeline = data.timelines[timelineMode] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Finanças</h2>
        <p className="text-sm text-muted-foreground">
          Visão consolidada do desempenho financeiro da operação.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={cn("mr-2 size-3.5", query.isFetching && "animate-spin")} />
            Atualizar
          </Button>
          <span className="text-xs text-muted-foreground">
            {query.isFetching
              ? "Calculando..."
              : data.generatedAt
                ? `Atualizado às ${new Date(data.generatedAt).toLocaleTimeString("pt-BR")}`
                : ""}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Faturamento Total"
          value={fmt(data.total)}
          icon={CircleDollarSign}
          tone="primary"
          hint={`${data.productsCount} produtos`}
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
              <li key={d.clientId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <p className="truncate text-sm font-medium">{d.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-destructive">{fmt(d.value)}</p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => handleOpenClient(d.clientId, d.isMgmv)}
                    aria-label={`Abrir ${d.name}`}
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
              <li key={d.clientId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-success/10 text-xs font-semibold text-success">
                    {i + 1}
                  </span>
                  <p className="truncate text-sm font-medium">{d.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-success">{fmt(d.value)}</p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => handleOpenClient(d.clientId, d.isMgmv)}
                    aria-label={`Abrir ${d.name}`}
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