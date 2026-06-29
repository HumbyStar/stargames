import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type TaskStatus = "todo" | "doing" | "review" | "blocked" | "done";
export type TaskPriority = "low" | "med" | "high" | "urgent";
export type CommentKind = "comment" | "completion" | "observation";

export interface TeamMember {
  id: string;
  email: string | null;
  fullName: string | null;
  roles: string[];
}

export interface TeamTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by: string;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  client_id: string | null;
  product_id: string | null;
  position: number;
  tags: string[];
  checklist: Array<{ id: string; text: string; done: boolean }>;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  kind: CommentKind;
  created_at: string;
}

const statusEnum = z.enum(["todo", "doing", "review", "blocked", "done"]);
const priorityEnum = z.enum(["low", "med", "high", "urgent"]);
const kindEnum = z.enum(["comment", "completion", "observation"]);

// ---------- Equipe ----------
export const listTeamMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TeamMember[]> => {
    const { supabase } = context;
    // Apenas quem pode ver tarefas da equipe deveria listar membros.
    // Funcionário comum recebe pelo menos a si próprio (para auto-atribuição).
    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("user_id, role");
    const byUser = new Map<string, string[]>();
    for (const r of rolesRows ?? []) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.role as string);
      byUser.set(r.user_id, arr);
    }
    const ids = Array.from(byUser.keys());
    if (ids.length === 0) return [];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    const nameById = new Map<string, string | null>();
    for (const p of profiles ?? []) nameById.set(p.id, (p as { display_name: string | null }).display_name);

    // email só fica disponível para admin; deixamos null para os demais
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server").catch(
      () => ({ supabaseAdmin: null as any }),
    );
    let emailById = new Map<string, string | null>();
    try {
      if (supabaseAdmin) {
        const { data: isAdmin } = await supabase.rpc("has_role", {
          _user_id: context.userId,
          _role: "admin",
        });
        const { data: isMaster } = await supabase.rpc("has_role", {
          _user_id: context.userId,
          _role: "admin_master",
        });
        if (isAdmin || isMaster) {
          const res = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
          for (const u of res.data?.users ?? []) emailById.set(u.id, u.email ?? null);
        }
      }
    } catch {
      // ignora — manter sem email
    }

    return ids.map((id) => ({
      id,
      email: emailById.get(id) ?? null,
      fullName: nameById.get(id) ?? null,
      roles: byUser.get(id) ?? [],
    }));
  });

// ---------- Tarefas ----------
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TeamTask[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("team_tasks")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((t) => ({
      ...(t as any),
      tags: ((t as any).tags as string[]) ?? [],
      checklist: ((t as any).checklist as any[]) ?? [],
    })) as TeamTask[];
  });

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).optional().nullable(),
  status: statusEnum.default("todo"),
  priority: priorityEnum.default("med"),
  assignee_id: z.string().uuid().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(12).default([]),
});

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createTaskSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      title: data.title,
      description: data.description ?? null,
      status: data.status,
      priority: data.priority,
      assignee_id: data.assignee_id ?? null,
      created_by: userId,
      due_at: data.due_at ?? null,
      client_id: data.client_id ?? null,
      product_id: data.product_id ?? null,
      tags: data.tags ?? [],
      checklist: [],
      position: Date.now() % 1_000_000,
    };
    const { data: row, error } = await supabase
      .from("team_tasks")
      .insert(payload as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("team_task_activity").insert({
      task_id: (row as any).id,
      actor_id: userId,
      action: "created",
      payload: { assignee_id: data.assignee_id ?? null },
    } as any);
    return row as any;
  });

const updateTaskSchema = z.object({
  id: z.string().uuid(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  position: z.number().int().optional(),
  tags: z.array(z.string()).optional(),
  completionNote: z.string().trim().max(1000).optional(),
});

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateTaskSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: getErr } = await supabase
      .from("team_tasks")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    if (!existing) throw new Error("Tarefa não encontrada.");

    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.assignee_id !== undefined) patch.assignee_id = data.assignee_id;
    if (data.due_at !== undefined) patch.due_at = data.due_at;
    if (data.position !== undefined) patch.position = data.position;
    if (data.tags !== undefined) patch.tags = data.tags;

    if (data.status !== undefined && data.status !== (existing as any).status) {
      patch.status = data.status;
      if (data.status === "doing" && !(existing as any).started_at) {
        patch.started_at = new Date().toISOString();
      }
      if (data.status === "done") {
        if (!data.completionNote || data.completionNote.trim().length < 3) {
          throw new Error("Para concluir, descreva brevemente a conclusão (mín. 3 caracteres).");
        }
        patch.completed_at = new Date().toISOString();
      }
    }

    const { error: upErr } = await supabase
      .from("team_tasks")
      .update(patch as any)
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);

    if (data.status === "done" && data.completionNote) {
      await supabase.from("team_task_comments").insert({
        task_id: data.id,
        author_id: userId,
        body: data.completionNote.trim(),
        kind: "completion",
      } as any);
    }

    await supabase.from("team_task_activity").insert({
      task_id: data.id,
      actor_id: userId,
      action: "updated",
      payload: patch as any,
    } as any);

    return { ok: true };
  });

const commentSchema = z.object({
  task_id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  kind: kindEnum.default("comment"),
});

export const addTaskComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => commentSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("team_task_comments")
      .insert({ ...data, author_id: userId } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTaskComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("team_task_comments")
      .select("*")
      .eq("task_id", data.task_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as TaskComment[];
  });

const deleteSchema = z.object({ id: z.string().uuid() });
export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => deleteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("team_tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });