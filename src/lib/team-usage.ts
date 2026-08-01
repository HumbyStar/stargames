import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TeamUsageStat {
  userId: string;
  label: string;
  email?: string | null;
  roles: string[];
  online: boolean;
  lastSeen?: string | null;
  totalActions: number;
  inserts: number;
  updates: number;
  deletes: number;
  activeDays: number;
  /** Minutos estimados de uso ativo do sistema (blocos de 5 min com ação). */
  activeMinutes: number;
  /** Minutos registrados no ponto da equipe. */
  punchMinutes: number;
  lastActionAt?: string | null;
  byTable: { table: string; count: number }[];
  daily: { day: string; count: number }[];
  streak: number;
  /** 0–100: volume + constância + regularidade. */
  score: number;
  level: { name: string; tier: 1 | 2 | 3 | 4 };
  rank: number;
}

export const TABLE_ACTION_LABELS: Record<string, string> = {
  clients: "Clientes",
  products: "Produtos",
  mgmv_agreements: "Acordos MGMV",
  mgmv_installments: "Parcelas MGMV",
  import_history: "Importações",
  system_backups: "Backups",
  nf_invoices: "Notas fiscais",
  team_tasks: "Tarefas",
  app_settings: "Configurações",
  saved_filters: "Filtros salvos",
  user_roles: "Papéis",
  role_permissions: "Permissões",
  ai_automations: "Automações",
  sandbox_state: "Modo Teste",
  team_punch_entries: "Ponto",
};

function levelFor(score: number): TeamUsageStat["level"] {
  if (score >= 85) return { name: "Diamante", tier: 4 };
  if (score >= 65) return { name: "Ouro", tier: 3 };
  if (score >= 40) return { name: "Prata", tier: 2 };
  return { name: "Bronze", tier: 1 };
}

function streakFrom(daily: { day: string; count: number }[]): number {
  const set = new Set(daily.filter((d) => d.count > 0).map((d) => d.day));
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 180; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if (set.has(key)) streak++;
    else if (i > 0) break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Soma minutos trabalhados a partir das batidas de ponto. */
function punchMinutes(
  rows: { user_id: string; day: string; kind: string; punched_at: string }[],
): Map<string, number> {
  const byUserDay = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const k = `${r.user_id}|${r.day}`;
    if (!byUserDay.has(k)) byUserDay.set(k, new Map());
    byUserDay.get(k)!.set(r.kind, r.punched_at);
  }
  const out = new Map<string, number>();
  for (const [k, kinds] of byUserDay) {
    const userId = k.split("|")[0];
    const start = kinds.get("in");
    const end = kinds.get("out");
    if (!start || !end) continue;
    let mins = (+new Date(end) - +new Date(start)) / 60_000;
    const lo = kinds.get("lunch_out");
    const li = kinds.get("lunch_in");
    if (lo && li) mins -= (+new Date(li) - +new Date(lo)) / 60_000;
    if (mins > 0) out.set(userId, (out.get(userId) ?? 0) + Math.round(mins));
  }
  return out;
}

export function useTeamUsage(days = 30) {
  const [stats, setStats] = useState<TeamUsageStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const [statsRes, profilesRes, rolesRes, sessionsRes, punchRes] = await Promise.all([
      supabase.rpc("team_usage_stats", { _days: days }),
      supabase.from("profiles").select("id, display_name"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("active_sessions").select("user_id, last_seen"),
      supabase
        .from("team_punch_entries")
        .select("user_id, day, kind, punched_at")
        .gte("day", since),
    ]);

    if (statsRes.error) {
      setError(statsRes.error.message);
      setStats([]);
      setLoading(false);
      return;
    }

    const names = new Map<string, string>();
    for (const p of profilesRes.data ?? []) {
      if (p.display_name) names.set(p.id, p.display_name);
    }
    const roles = new Map<string, string[]>();
    for (const r of rolesRes.data ?? []) {
      roles.set(r.user_id, [...(roles.get(r.user_id) ?? []), r.role as string]);
    }
    const cutoff = Date.now() - 5 * 60_000;
    const lastSeen = new Map<string, string>();
    for (const s of sessionsRes.data ?? []) {
      const cur = lastSeen.get(s.user_id);
      if (!cur || +new Date(s.last_seen) > +new Date(cur)) {
        lastSeen.set(s.user_id, s.last_seen);
      }
    }
    const punches = punchMinutes(
      (punchRes.data ?? []) as {
        user_id: string;
        day: string;
        kind: string;
        punched_at: string;
      }[],
    );

    const rows = (statsRes.data ?? []) as {
      user_id: string;
      user_email: string | null;
      total_actions: number;
      inserts: number;
      updates: number;
      deletes: number;
      active_days: number;
      active_blocks: number;
      last_action_at: string | null;
      by_table: Record<string, number> | null;
      daily: Record<string, number> | null;
    }[];

    const maxActions = Math.max(1, ...rows.map((r) => Number(r.total_actions) || 0));

    const mapped: TeamUsageStat[] = rows.map((r) => {
      const total = Number(r.total_actions) || 0;
      const activeDays = Number(r.active_days) || 0;
      const activeMinutes = (Number(r.active_blocks) || 0) * 5;
      const daily = Object.entries(r.daily ?? {})
        .map(([day, count]) => ({ day, count: Number(count) }))
        .sort((a, b) => a.day.localeCompare(b.day));
      const byTable = Object.entries(r.by_table ?? {})
        .map(([table, count]) => ({ table, count: Number(count) }))
        .sort((a, b) => b.count - a.count);
      const volume = (total / maxActions) * 55;
      const constancia = Math.min(activeDays / days, 1) * 30;
      const regularidade = Math.min(activeMinutes / (days * 60), 1) * 15;
      const score = Math.round(Math.min(100, volume + constancia + regularidade));
      const seen = lastSeen.get(r.user_id) ?? null;
      return {
        userId: r.user_id,
        label: names.get(r.user_id) ?? r.user_email ?? "Usuário",
        email: r.user_email,
        roles: roles.get(r.user_id) ?? [],
        online: seen ? +new Date(seen) >= cutoff : false,
        lastSeen: seen,
        totalActions: total,
        inserts: Number(r.inserts) || 0,
        updates: Number(r.updates) || 0,
        deletes: Number(r.deletes) || 0,
        activeDays,
        activeMinutes,
        punchMinutes: punches.get(r.user_id) ?? 0,
        lastActionAt: r.last_action_at,
        byTable,
        daily,
        streak: streakFrom(daily),
        score,
        level: levelFor(score),
        rank: 0,
      };
    });

    mapped.sort((a, b) => b.score - a.score || b.totalActions - a.totalActions);
    mapped.forEach((m, i) => {
      m.rank = i + 1;
    });
    setStats(mapped);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  const average = useMemo(
    () =>
      stats.length === 0
        ? 0
        : Math.round(stats.reduce((s, x) => s + x.totalActions, 0) / stats.length),
    [stats],
  );

  return { stats, loading, error, reload: load, average };
}

export function formatMinutes(mins: number): string {
  if (mins <= 0) return "0min";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}