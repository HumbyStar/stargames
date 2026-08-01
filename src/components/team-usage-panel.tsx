import { Award, Flame, RefreshCw, Timer, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatMinutes,
  useTeamUsage,
  TABLE_ACTION_LABELS,
  type TeamUsageStat,
} from "@/lib/team-usage";
import { relativeTime } from "@/lib/activity-feed";

const TIER_STYLE: Record<number, string> = {
  1: "bg-amber-700/10 text-amber-700 dark:text-amber-500",
  2: "bg-slate-400/15 text-slate-600 dark:text-slate-300",
  3: "bg-amber-400/15 text-amber-600 dark:text-amber-400",
  4: "bg-cyan-400/15 text-cyan-600 dark:text-cyan-300",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function Sparkline({ stat, days }: { stat: TeamUsageStat; days: number }) {
  const map = new Map(stat.daily.map((d) => [d.day, d.count]));
  const series: number[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    series.push(map.get(cursor.toISOString().slice(0, 10)) ?? 0);
    cursor.setDate(cursor.getDate() + 1);
  }
  const max = Math.max(1, ...series);
  return (
    <div className="flex h-8 items-end gap-[2px]" aria-hidden>
      {series.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-full rounded-sm",
            v > 0 ? "bg-primary/60" : "bg-foreground/10",
          )}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

interface Props {
  days?: number;
  meId?: string | null;
  onSelectUser?: (userId: string) => void;
}

/** Painel gamificado de uso do sistema por pessoa. */
export function TeamUsagePanel({ days = 30, meId, onSelectUser }: Props) {
  const { stats, loading, error, reload, average } = useTeamUsage(days);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Desempenho da equipe nos últimos {days} dias — tempo ativo, ações mais
          usadas e nível de uso do sistema.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-xs"
          onClick={() => void reload()}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Não foi possível carregar o desempenho da equipe: {error}
        </p>
      )}

      {loading && stats.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-foreground/5" />
          ))}
        </div>
      ) : stats.length === 0 && !error ? (
        <p className="rounded-lg border border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
          Ainda não há atividade suficiente no período para montar o painel.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {stats.map((s) => {
            const top = s.byTable.slice(0, 3);
            const topMax = Math.max(1, ...top.map((t) => t.count));
            return (
              <button
                key={s.userId}
                type="button"
                onClick={() => onSelectUser?.(s.userId)}
                className="rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:bg-foreground/5"
              >
                <div className="flex items-start gap-3">
                  <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {initials(s.label)}
                    {s.online && (
                      <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-500" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {s.label}
                      {s.userId === meId && (
                        <span className="ml-1 text-xs text-muted-foreground">(você)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.roles.join(", ") || "sem papel"} ·{" "}
                      {s.online
                        ? "online agora"
                        : s.lastSeen
                          ? `visto ${relativeTime(s.lastSeen)}`
                          : "offline"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      TIER_STYLE[s.level.tier],
                    )}
                  >
                    <Award className="size-3" />
                    {s.level.name}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md bg-foreground/5 p-1.5">
                    <p className="font-semibold">{s.totalActions}</p>
                    <p className="text-[11px] text-muted-foreground">ações</p>
                  </div>
                  <div className="rounded-md bg-foreground/5 p-1.5">
                    <p className="font-semibold">{formatMinutes(s.activeMinutes)}</p>
                    <p className="text-[11px] text-muted-foreground">tempo ativo</p>
                  </div>
                  <div className="rounded-md bg-foreground/5 p-1.5">
                    <p className="font-semibold">{s.activeDays}</p>
                    <p className="text-[11px] text-muted-foreground">dias ativos</p>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Nível de uso</span>
                    <span>
                      {s.score}/100 · #{s.rank}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                </div>

                {top.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Mais utiliza
                    </p>
                    {top.map((t) => (
                      <div key={t.table} className="flex items-center gap-2 text-xs">
                        <span className="w-28 shrink-0 truncate text-muted-foreground">
                          {TABLE_ACTION_LABELS[t.table] ?? t.table}
                        </span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                          <span
                            className="block h-full rounded-full bg-primary/60"
                            style={{ width: `${(t.count / topMax) * 100}%` }}
                          />
                        </span>
                        <span className="w-8 text-right text-muted-foreground">
                          {t.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3">
                  <Sparkline stat={s} days={days} />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Flame className="size-3" /> {s.streak} dia(s) seguidos
                  </span>
                  {s.punchMinutes > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Timer className="size-3" /> ponto {formatMinutes(s.punchMinutes)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="size-3" />
                    {average > 0
                      ? `${Math.round((s.totalActions / average) * 100)}% da média`
                      : "—"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}