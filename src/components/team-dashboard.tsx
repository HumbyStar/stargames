import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTeamDashboard } from "@/lib/punch.functions";
import {
  CheckCircle2, Clock, AlertTriangle, TrendingUp, Users, Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function TeamDashboard() {
  const dashFn = useServerFn(getTeamDashboard);
  const q = useQuery({
    queryKey: ["team-dashboard"],
    queryFn: () => dashFn(),
    staleTime: 30_000,
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Carregando…</div>;
  if (q.error) return <div className="text-sm text-destructive py-6">{(q.error as Error).message}</div>;
  const d = q.data!;
  const totalOpen = d.totals.todo + d.totals.doing + d.totals.review + d.totals.blocked;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={CheckCircle2} label="Concluídas 7d" value={d.doneLast7} tone="text-success" />
        <Kpi icon={TrendingUp} label="Concluídas 30d" value={d.doneLast30} tone="text-primary" />
        <Kpi icon={Clock} label="Em aberto" value={totalOpen} tone="text-warning-foreground" />
        <Kpi icon={AlertTriangle} label="Atrasadas" value={d.overdue} tone="text-destructive" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Status do Kanban */}
        <div className="rounded-2xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Status do Kanban</h3>
          <div className="space-y-2">
            {[
              ["todo", "A Fazer", "bg-muted"],
              ["doing", "Em Andamento", "bg-primary"],
              ["review", "Revisão", "bg-warning"],
              ["blocked", "Bloqueado", "bg-destructive"],
              ["done", "Concluído", "bg-success"],
            ].map(([k, label, color]) => {
              const n = (d.totals as any)[k as string] as number;
              const total = Object.values(d.totals).reduce((a, b) => a + b, 0) || 1;
              return (
                <div key={k as string}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span>{label}</span>
                    <span className="font-mono text-muted-foreground">{n}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full transition-all", color)} style={{ width: `${(n / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {d.avgCompletionHours !== null && (
            <p className="mt-3 text-xs text-muted-foreground">
              ⏱️ Tempo médio de conclusão: <strong>{d.avgCompletionHours.toFixed(1)}h</strong>
            </p>
          )}
        </div>

        {/* Eficiência por papel */}
        <div className="rounded-2xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Users className="size-4" /> Por cargo
          </h3>
          {d.byRole.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Sem dados ainda.</p>
          ) : (
            <ul className="space-y-2">
              {d.byRole.map((r) => (
                <li key={r.role} className="flex items-center justify-between text-sm">
                  <Badge variant="outline" className="text-[10px]">{r.role}</Badge>
                  <span className="text-xs">
                    <span className="text-success font-semibold">{r.done}</span>
                    <span className="text-muted-foreground"> / {r.done + r.open}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Por responsável */}
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Conclusões por responsável</h3>
        {d.byAssignee.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Sem tarefas atribuídas.</p>
        ) : (
          <div className="space-y-2">
            {d.byAssignee.slice(0, 10).map((a) => {
              const total = a.done + a.open || 1;
              return (
                <div key={a.user_id} className="flex items-center gap-3">
                  <div className="w-32 truncate text-sm">{a.name}</div>
                  <Badge variant="outline" className="text-[10px]">{a.role}</Badge>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-success" style={{ width: `${(a.done / total) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono w-16 text-right">
                    {a.done}/{total}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Atividade recente + ponto hoje */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Activity className="size-4" /> Atividade recente
          </h3>
          {d.recentActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Sem atividade.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[240px] overflow-y-auto">
              {d.recentActivity.map((a) => (
                <li key={a.id} className="text-xs flex items-center justify-between">
                  <span><Badge variant="outline" className="text-[9px] mr-1">{a.action}</Badge> {a.task_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Ponto hoje</h3>
          {d.punchToday.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Ninguém bateu ponto ainda.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[240px] overflow-y-auto">
              {d.punchToday.map((p) => (
                <li key={p.user_id} className="text-xs flex items-center justify-between">
                  <span className="truncate">{p.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {p.in ? new Date(p.in).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    {" → "}
                    {p.out ? new Date(p.out).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", tone)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", tone)}>{value}</div>
    </div>
  );
}
