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
} from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useActivityFeed,
  activityCategoryLabels,
  relativeTime,
  type ActivityCategory,
  type ActivitySeverity,
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

  const toggleCategory = (c: ActivityCategory) =>
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (categories.length > 0 && !categories.includes(e.category)) return false;
        if (onlyMine && e.actorId !== meId) return false;
        if (actorFilter && e.actorId !== actorFilter) return false;
        return true;
      }),
    [events, categories, onlyMine, actorFilter, meId],
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
              return (
                <div key={e.id} className="flex items-start gap-3 px-3 py-2.5">
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
                    </p>
                    {e.description && (
                      <p
                        className="mt-1 text-xs leading-relaxed text-muted-foreground"
                        title={e.description}
                      >
                        {e.description}
                      </p>
                    )}
                  </div>
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
      </div>
    </Card>
  );
}
