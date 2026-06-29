import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PunchKind = "in" | "lunch_out" | "lunch_in" | "out";

export interface PunchEntry {
  id: string;
  user_id: string;
  day: string;
  kind: PunchKind;
  punched_at: string;
  feedback_mood: number | null;
  feedback_environment: number | null;
  feedback_optimization: string | null;
  feedback_notes: string | null;
}

const kindEnum = z.enum(["in", "lunch_out", "lunch_in", "out"]);

function todaySaoPaulo(): string {
  const d = new Date();
  // formato YYYY-MM-DD em America/Sao_Paulo
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}

// --------- Bater ponto ---------
const punchSchema = z.object({
  kind: kindEnum,
  feedback: z.object({
    mood: z.number().int().min(1).max(5).optional(),
    environment: z.number().int().min(1).max(5).optional(),
    optimization: z.string().trim().max(1500).optional(),
    notes: z.string().trim().max(1500).optional(),
  }).optional(),
});

export const punchClock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => punchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Valida permissão
    const { data: canPunch } = await supabase.rpc("has_permission", {
      _user_id: userId, _permission: "punch.clock",
    });
    if (!canPunch) throw new Error("Você não tem permissão para bater ponto.");

    const day = todaySaoPaulo();

    // Verifica ordem (entrada > saída almoço > volta almoço > saída final) e duplicidade
    const { data: today } = await supabase
      .from("team_punch_entries")
      .select("kind")
      .eq("user_id", userId)
      .eq("day", day);
    const done = new Set((today ?? []).map((r) => r.kind as PunchKind));
    const order: PunchKind[] = ["in", "lunch_out", "lunch_in", "out"];
    const idx = order.indexOf(data.kind);
    if (done.has(data.kind)) throw new Error("Você já registrou essa batida hoje.");
    for (let i = 0; i < idx; i++) {
      if (!done.has(order[i])) {
        throw new Error(`Registre a batida anterior primeiro (${order[i]}).`);
      }
    }

    // Saída final exige feedback
    if (data.kind === "out") {
      const fb = data.feedback;
      if (!fb || !fb.mood || !fb.environment || !fb.optimization || fb.optimization.trim().length < 3) {
        throw new Error("Para bater a saída final, responda o formulário de feedback.");
      }
    }

    const row = {
      user_id: userId,
      day,
      kind: data.kind,
      punched_at: new Date().toISOString(),
      feedback_mood: data.feedback?.mood ?? null,
      feedback_environment: data.feedback?.environment ?? null,
      feedback_optimization: data.feedback?.optimization?.trim() || null,
      feedback_notes: data.feedback?.notes?.trim() || null,
    };
    const { error } = await supabase.from("team_punch_entries").insert(row as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --------- Meu histórico ---------
export const listMyPunch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PunchEntry[]> => {
    const { data, error } = await context.supabase
      .from("team_punch_entries")
      .select("*")
      .eq("user_id", context.userId)
      .order("punched_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as PunchEntry[];
  });

// --------- Dashboard da Equipe ---------
export interface TeamDashboardData {
  totals: { todo: number; doing: number; review: number; blocked: number; done: number };
  doneLast7: number;
  doneLast30: number;
  overdue: number;
  avgCompletionHours: number | null;
  byAssignee: Array<{ user_id: string; name: string; role: string; done: number; open: number }>;
  byRole: Array<{ role: string; done: number; open: number }>;
  recentActivity: Array<{ id: string; action: string; created_at: string; actor_id: string; task_id: string }>;
  punchToday: Array<{ user_id: string; name: string; in: string | null; out: string | null }>;
}

export const getTeamDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TeamDashboardData> => {
    const { supabase, userId } = context;
    const { data: canView } = await supabase.rpc("can_view_team_tasks", { _user_id: userId });
    if (!canView) throw new Error("Sem permissão para o dashboard de equipe.");

    const [tasksRes, activityRes, rolesRes, profilesRes] = await Promise.all([
      supabase.from("team_tasks").select("id,status,assignee_id,due_at,started_at,completed_at,created_at"),
      supabase.from("team_task_activity").select("id,action,created_at,actor_id,task_id").order("created_at", { ascending: false }).limit(20),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("profiles").select("id,display_name"),
    ]);

    const tasks = (tasksRes.data ?? []) as any[];
    const totals = { todo: 0, doing: 0, review: 0, blocked: 0, done: 0 };
    let doneLast7 = 0, doneLast30 = 0, overdue = 0;
    let completionSum = 0, completionCount = 0;
    const now = Date.now();
    const d7 = now - 7 * 86400e3;
    const d30 = now - 30 * 86400e3;
    for (const t of tasks) {
      totals[t.status as keyof typeof totals]++;
      if (t.status === "done" && t.completed_at) {
        const ct = new Date(t.completed_at).getTime();
        if (ct >= d7) doneLast7++;
        if (ct >= d30) doneLast30++;
        const start = new Date(t.started_at ?? t.created_at).getTime();
        completionSum += (ct - start) / 3600e3;
        completionCount++;
      }
      if (t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < now) overdue++;
    }

    const roleByUser = new Map<string, string>();
    for (const r of rolesRes.data ?? []) {
      if (!roleByUser.has(r.user_id)) roleByUser.set(r.user_id, r.role as string);
    }
    const nameByUser = new Map<string, string>();
    for (const p of profilesRes.data ?? []) nameByUser.set(p.id, (p as any).display_name ?? p.id.slice(0, 8));

    const aggA = new Map<string, { done: number; open: number }>();
    const aggR = new Map<string, { done: number; open: number }>();
    for (const t of tasks) {
      const uid = t.assignee_id ?? "—";
      const a = aggA.get(uid) ?? { done: 0, open: 0 };
      if (t.status === "done") a.done++; else a.open++;
      aggA.set(uid, a);
      const role = roleByUser.get(uid) ?? "sem-cargo";
      const rr = aggR.get(role) ?? { done: 0, open: 0 };
      if (t.status === "done") rr.done++; else rr.open++;
      aggR.set(role, rr);
    }
    const byAssignee = Array.from(aggA.entries()).map(([uid, v]) => ({
      user_id: uid,
      name: nameByUser.get(uid) ?? uid.slice(0, 8),
      role: roleByUser.get(uid) ?? "—",
      done: v.done, open: v.open,
    })).sort((a, b) => b.done - a.done);
    const byRole = Array.from(aggR.entries()).map(([role, v]) => ({ role, ...v }))
      .sort((a, b) => b.done - a.done);

    // Ponto de hoje
    const today = (() => {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      });
      return fmt.format(new Date());
    })();
    const { data: punches } = await supabase
      .from("team_punch_entries")
      .select("user_id,kind,punched_at")
      .eq("day", today);
    const punchMap = new Map<string, { in: string | null; out: string | null }>();
    for (const p of punches ?? []) {
      const e = punchMap.get(p.user_id) ?? { in: null, out: null };
      if (p.kind === "in") e.in = p.punched_at;
      if (p.kind === "out") e.out = p.punched_at;
      punchMap.set(p.user_id, e);
    }
    const punchToday = Array.from(punchMap.entries()).map(([uid, v]) => ({
      user_id: uid, name: nameByUser.get(uid) ?? uid.slice(0, 8), ...v,
    }));

    return {
      totals,
      doneLast7, doneLast30, overdue,
      avgCompletionHours: completionCount ? completionSum / completionCount : null,
      byAssignee, byRole,
      recentActivity: (activityRes.data ?? []) as any[],
      punchToday,
    };
  });
