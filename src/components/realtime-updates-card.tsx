import { useMemo, useState } from "react";
import {
  Activity,
  Users,
  Package,
  HandCoins,
  Upload,
  HardDrive,
  Receipt,
  Settings2,
  ShieldAlert,
  Pause,
  Play,
  RefreshCw,
  Search,
  ChevronRight,
  SlidersHorizontal,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useActivityFeed,
  activityCategoryLabels,
  relativeTime,
  groupActivityEvents,
  type ActivityCategory,
  type ActivitySeverity,
  type ActivityEvent,
} from "@/lib/activity-feed";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityBatchCard } from "@/components/activity-batch-card";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<ActivityCategory, typeof Users> = {
  clientes: Users,
  mgmv: HandCoins,
  importacao: Upload,
  backup: HardDrive,
  financeiro: Receipt,
  equipe: Package,
  configuracoes: Settings2,
  seguranca: ShieldAlert,
  sistema: Activity,
};

const SEVERITY_STYLE: Record<ActivitySeverity, string> = {
  info: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const PERIOD_MS: Record<string, number | null> = {
  all: null,
  today: 0,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

const SEVERITY_LABELS: Record<ActivitySeverity, string> = {
  info: "Informativo",
  success: "Sucesso",
  warning: "Atenção",
  danger: "Crítico",
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Hoje";
  if (same(d, yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

export function RealtimeUpdatesCard() {
  const {
    events,
    loading,
    live,
    paused,
    setPaused,
    hasMore,
    loadMore,
    online,
    meId,
    actors,
  } = useActivityFeed();

  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [onlyMine, setOnlyMine] = useState(false);
  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [globalDetailed, setGlobalDetailed] = useState(false);
  const [detailByCategory, setDetailByCategory] = useState<
    Partial<Record<ActivityCategory, boolean>>
  >({});
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [period, setPeriod] = useState<string>("all");
  const [operation, setOperation] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [groupBatches, setGroupBatches] = useState(true);
  const [groupByDay, setGroupByDay] = useState(true);

  const isDetailed = (c: ActivityCategory) =>
    detailByCategory[c] ?? globalDetailed;

  const toggleCategory = (c: ActivityCategory) =>
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const filtered = useMemo(
    () =>
      events
        .filter((e) => {
          if (categories.length > 0 && !categories.includes(e.category)) return false;
          if (onlyMine && e.actorId !== meId) return false;
          if (actorFilter && e.actorId !== actorFilter) return false;
          if (operation !== "all" && e.entity?.action !== operation) return false;
          if (severity !== "all" && e.severity !== severity) return false;
          if (tableFilter !== "all" && e.entity?.table !== tableFilter) return false;
          const window = PERIOD_MS[period];
          if (window !== null && window !== undefined) {
            if (window === 0) {
              if (new Date(e.at).toDateString() !== new Date().toDateString()) return false;
            } else if (Date.now() - +new Date(e.at) > window) {
              return false;
            }
          }
          if (query.trim()) {
            const q = query.trim().toLowerCase();
            const hay = `${e.title} ${e.description ?? ""} ${e.actorLabel} ${
              e.entity?.recordLabel ?? ""
            }`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => +new Date(b.at) - +new Date(a.at)),
    [
      events,
      categories,
      onlyMine,
      actorFilter,
      query,
      meId,
      operation,
      severity,
      tableFilter,
      period,
    ],
  );

  const groups = useMemo(
    () => groupActivityEvents(filtered, { enabled: groupBatches }),
    [filtered, groupBatches],
  );

  const tables = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.entity) map.set(e.entity.table, e.entity.tableLabel);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [events]);

  const filtersActive =
    categories.length > 0 ||
    onlyMine ||
    !!actorFilter ||
    !!query.trim() ||
    period !== "all" ||
    operation !== "all" ||
    severity !== "all" ||
    tableFilter !== "all";

  const clearFilters = () => {
    setCategories([]);
    setOnlyMine(false);
    setActorFilter(null);
    setQuery("");
    setPeriod("all");
    setOperation("all");
    setSeverity("all");
    setTableFilter("all");
  };

  const allCategories = Object.keys(activityCategoryLabels) as ActivityCategory[];

  return (
    <Card title="Atualizações em tempo real">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-medium",
                live && !paused
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-foreground/5 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  live && !paused
                    ? "animate-pulse bg-emerald-500"
                    : "bg-muted-foreground/50",
                )}
              />
              {paused ? "Pausado" : live ? "Ao vivo" : "Conectando..."}
            </span>
            Acompanhe edições, importações, backups e configurações conforme acontecem.
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Retomar" : "Pausar"}
          </Button>
        </div>

        {/* Ativos agora */}
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Ativos agora ({online.length})
          </p>
          {online.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ninguém com sessão ativa no momento.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {online.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() =>
                    setActorFilter((c) => (c === u.userId ? null : u.userId))
                  }
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-xs transition-colors hover:bg-foreground/5",
                    actorFilter === u.userId && "border-primary/50 bg-primary/10",
                  )}
                >
                  <span className="grid size-5 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {initials(u.label)}
                  </span>
                  {u.label}
                  {u.userId === meId && (
                    <span className="text-muted-foreground">(você)</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <Tabs defaultValue="atividade" className="space-y-4">
          <TabsList>
            <TabsTrigger value="atividade">Atividade</TabsTrigger>
          </TabsList>

          <TabsContent value="atividade" className="mt-0 space-y-4">
        {/* Filtros */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {allCategories.map((c) => {
              const active = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-foreground/5",
                  )}
                >
                  {activityCategoryLabels[c]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="only-mine"
                checked={onlyMine}
                onCheckedChange={(v) => setOnlyMine(v)}
              />
              <Label htmlFor="only-mine" className="text-xs">
                Somente minhas ações
              </Label>
            </div>
            {actorFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setActorFilter(null)}
              >
                <RefreshCw className="size-3" />
                Limpar filtro de pessoa (
                {actors.find((a) => a.id === actorFilter)?.label ?? "usuário"})
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder="Buscar por ação, registro ou pessoa"
                className="h-8 pl-8 text-xs"
              />
            </div>

            <Select
              value={actorFilter ?? "all"}
              onValueChange={(v) => setActorFilter(v === "all" ? null : v)}
            >
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue placeholder="Todas as pessoas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as pessoas</SelectItem>
                {actors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                    {a.id === meId ? " (você)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-2 text-xs">
                  <SlidersHorizontal className="size-3.5" />
                  Nível de detalhe
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Modo detalhado</p>
                    <p className="text-xs text-muted-foreground">
                      Mostra os campos alterados direto na timeline.
                    </p>
                  </div>
                  <Switch
                    checked={globalDetailed}
                    onCheckedChange={(v) => {
                      setGlobalDetailed(v);
                      setDetailByCategory({});
                    }}
                  />
                </div>
                <div className="space-y-1.5 border-t border-border pt-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Por categoria
                  </p>
                  {allCategories.map((c) => (
                    <div key={c} className="flex items-center justify-between gap-3">
                      <Label className="text-xs font-normal">
                        {activityCategoryLabels[c]}
                      </Label>
                      <Switch
                        checked={isDetailed(c)}
                        onCheckedChange={(v) =>
                          setDetailByCategory((prev) => ({ ...prev, [c]: v }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select value={operation} onValueChange={setOperation}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Operação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda operação</SelectItem>
                <SelectItem value="INSERT">Criação</SelectItem>
                <SelectItem value="UPDATE">Edição</SelectItem>
                <SelectItem value="DELETE">Exclusão</SelectItem>
              </SelectContent>
            </Select>

            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Gravidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Qualquer gravidade</SelectItem>
                {(Object.keys(SEVERITY_LABELS) as ActivitySeverity[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Tipo de registro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os registros</SelectItem>
                {tables.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Switch id="group-batches" checked={groupBatches} onCheckedChange={setGroupBatches} />
              <Label htmlFor="group-batches" className="text-xs">
                Agrupar em lote
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="group-day" checked={groupByDay} onCheckedChange={setGroupByDay} />
              <Label htmlFor="group-day" className="text-xs">
                Separar por dia
              </Label>
            </div>

            <span className="text-xs text-muted-foreground">
              {filtered.length} evento(s)
            </span>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={clearFilters}
              >
                <RefreshCw className="size-3" />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>

        {/* Feed */}
        <div className="divide-y divide-border rounded-lg border border-border bg-background/40">
          {loading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-foreground/5" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma atividade registrada ainda. Assim que alguém editar algo, aparece aqui.
            </p>
          ) : (
            groups.map((g, gi) => {
              const prev = gi > 0 ? groups[gi - 1] : null;
              const separator =
                groupByDay && (!prev || dayLabel(prev.at) !== dayLabel(g.at)) ? (
                  <p
                    key={`day-${g.id}`}
                    className="bg-foreground/[0.03] px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    {dayLabel(g.at)}
                  </p>
                ) : null;

              if (g.kind === "batch") {
                return (
                  <div key={g.id}>
                    {separator}
                    <ActivityBatchCard batch={g} onSelectEvent={setSelected} />
                  </div>
                );
              }

              const e = g.event;
              const Icon = CATEGORY_ICON[e.category];
              const detailed = isDetailed(e.category);
              const changes = e.changes ?? [];
              return (
                <div key={e.id}>
                  {separator}
                <button
                  type="button"
                  onClick={() => setSelected(e)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/5"
                >
                  <div
                    className={cn(
                      "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                      SEVERITY_STYLE[e.severity],
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      {e.title}
                      {e.clientLabel && (
                        <span className="text-muted-foreground">
                          {" "}
                          — cliente {e.clientLabel}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">
                        {e.actorLabel}
                      </span>
                      <span>·</span>
                      <span>{activityCategoryLabels[e.category]}</span>
                      <span>·</span>
                      <span>{relativeTime(e.at)}</span>
                      {changes.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{changes.length} campo(s)</span>
                        </>
                      )}
                    </p>
                    {!detailed && e.description && (
                      <p
                        className="mt-1 text-xs leading-relaxed text-muted-foreground"
                        title={e.description}
                      >
                        {e.description}
                      </p>
                    )}
                    {detailed && changes.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {changes.slice(0, 6).map((c, i) => (
                          <li
                            key={`${c.label}-${i}`}
                            className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
                          >
                            {c.scope && (
                              <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                {c.scope}
                              </span>
                            )}
                            <span className="text-foreground/80">{c.label}:</span>
                            <span className="line-through opacity-70">{c.from}</span>
                            <ArrowRight className="size-3" />
                            <span className="text-foreground/90">{c.to}</span>
                          </li>
                        ))}
                        {changes.length > 6 && (
                          <li className="text-xs text-muted-foreground">
                            e mais {changes.length - 6} campo(s) — clique para ver tudo
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" />
                </button>
                </div>
              );
            })
          )}
        </div>

        {hasMore && !loading && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => void loadMore()}>
              Carregar mais
            </Button>
          </div>
        )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{selected.title}</DialogTitle>
                <DialogDescription className="text-xs">
                  {selected.actorLabel} ·{" "}
                  {activityCategoryLabels[selected.category]} ·{" "}
                  {new Date(selected.at).toLocaleString("pt-BR")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {selected.entity && (
                  <div className="grid gap-2 rounded-lg border border-border bg-background/40 p-3 text-xs sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground">Registro afetado</p>
                      <p className="font-medium">
                        {selected.entity.recordLabel ?? selected.entity.tableLabel}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tipo</p>
                      <p className="font-medium">{selected.entity.tableLabel}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Operação</p>
                      <p className="font-medium">
                        {selected.entity.action === "INSERT"
                          ? "Criação"
                          : selected.entity.action === "DELETE"
                            ? "Exclusão"
                            : "Atualização"}
                      </p>
                    </div>
                    {selected.entity.rowId && (
                      <div className="min-w-0">
                        <p className="text-muted-foreground">Identificador</p>
                        <p className="truncate font-mono text-[11px]">
                          {selected.entity.rowId}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Campos alterados ({selected.changes?.length ?? 0})
                  </p>
                  {!selected.changes || selected.changes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {selected.description ??
                        "Sem detalhes de campos para esta ação."}
                    </p>
                  ) : (
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {selected.changes.map((c, i) => (
                        <div key={`${c.label}-${i}`} className="p-2.5 text-xs">
                          <p className="mb-1 font-medium">
                            {c.scope ? `${c.scope} · ` : ""}
                            {c.label}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                              {c.from}
                            </span>
                            <ArrowRight className="size-3 text-muted-foreground" />
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                              {c.to}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
