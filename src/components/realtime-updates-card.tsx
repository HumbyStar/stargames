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
  type ActivityCategory,
  type ActivitySeverity,
  type ActivityEvent,
} from "@/lib/activity-feed";
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
    [events, categories, onlyMine, actorFilter, query, meId],
  );

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
        </div>

        {/* Feed */}
        <div className="divide-y divide-border rounded-lg border border-border bg-background/40">
          {loading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-foreground/5" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma atividade registrada ainda. Assim que alguém editar algo, aparece aqui.
            </p>
          ) : (
            filtered.map((e) => {
              const Icon = CATEGORY_ICON[e.category];
              const detailed = isDetailed(e.category);
              const changes = e.changes ?? [];
              return (
                <button
                  key={e.id}
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
                    <p className="text-sm leading-snug">{e.title}</p>
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
