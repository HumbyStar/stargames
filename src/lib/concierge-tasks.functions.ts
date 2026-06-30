import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ConciergeTaskType =
  | "cobranca"
  | "mgmv"
  | "envio"
  | "importacao"
  | "revisao_ia"
  | "cadastro"
  | "financeiro"
  | "atendimento"
  | "leiloes"
  | "dados_inconsistentes";

export type ConciergePriority = "baixa" | "media" | "alta" | "urgente";

export interface SuggestedAssignee {
  id: string;
  name: string | null;
  email: string | null;
  responsibilities: string[];
  canReceiveTasks: boolean;
}

const taskTypeEnum = z.enum([
  "cobranca","mgmv","envio","importacao","revisao_ia",
  "cadastro","financeiro","atendimento","leiloes","dados_inconsistentes",
]);
const priorityEnum = z.enum(["baixa", "media", "alta", "urgente"]);

// Mapeia tipo -> responsabilidades compatíveis
function responsibilitiesForTaskType(t: ConciergeTaskType): string[] {
  switch (t) {
    case "cobranca": return ["cobranca"];
    case "mgmv": return ["mgmv", "revisao_ia"];
    case "envio": return ["envio"];
    case "importacao": return ["importacao"];
    case "revisao_ia": return ["revisao_ia", "mgmv"];
    case "cadastro": return ["cadastro"];
    case "financeiro": return ["financeiro"];
    case "atendimento": return ["atendimento"];
    case "leiloes": return ["leiloes"];
    case "dados_inconsistentes": return ["cadastro", "atendimento"];
  }
}

// Mapeia prioridade do Concierge -> team_tasks priority
function mapPriority(p: ConciergePriority): "low" | "med" | "high" | "urgent" {
  return p === "baixa" ? "low" : p === "media" ? "med" : p === "alta" ? "high" : "urgent";
}

function canCreateTasks(roles: string[]): boolean {
  return roles.some((r) =>
    ["admin_master", "admin", "gerente", "manager"].includes(r),
  );
}

async function loadCallerRoles(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/**
 * Sugere usuários compatíveis para um tipo de tarefa.
 */
export const suggestAssignees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ taskType: taskTypeEnum }).parse(d),
  )
  .handler(async ({ data, context }): Promise<SuggestedAssignee[]> => {
    const { supabase, userId } = context;
    const roles = await loadCallerRoles(supabase, userId);
    if (!canCreateTasks(roles)) {
      throw new Error("Você não tem permissão para criar tarefas pelo Concierge.");
    }
    const wanted = responsibilitiesForTaskType(data.taskType);

    // Carrega usuários com as responsabilidades alvo
    const { data: respRows } = await supabase
      .from("user_responsibilities")
      .select("user_id, responsibility")
      .in("responsibility", wanted as any);

    const userIds = Array.from(new Set((respRows ?? []).map((r) => (r as any).user_id))) as string[];
    if (userIds.length === 0) return [];

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, can_receive_tasks")
      .in("id", userIds);

    const profileById = new Map<string, { name: string | null; canReceive: boolean }>();
    for (const p of profiles ?? []) {
      profileById.set((p as any).id, {
        name: (p as any).display_name ?? null,
        canReceive: (p as any).can_receive_tasks ?? true,
      });
    }
    const respByUser = new Map<string, string[]>();
    for (const r of respRows ?? []) {
      const arr = respByUser.get((r as any).user_id) ?? [];
      arr.push((r as any).responsibility as string);
      respByUser.set((r as any).user_id, arr);
    }

    // Email apenas para admin
    let emailById = new Map<string, string | null>();
    try {
      const isAdmin = roles.includes("admin") || roles.includes("admin_master");
      if (isAdmin) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const res = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
        for (const u of res.data?.users ?? []) emailById.set(u.id, u.email ?? null);
      }
    } catch {
      // ignora
    }

    return userIds
      .map<SuggestedAssignee>((id) => ({
        id,
        name: profileById.get(id)?.name ?? null,
        email: emailById.get(id) ?? null,
        responsibilities: respByUser.get(id) ?? [],
        canReceiveTasks: profileById.get(id)?.canReceive ?? true,
      }))
      .filter((u) => u.canReceiveTasks);
  });

const createSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).nullable().optional(),
  taskType: taskTypeEnum,
  priority: priorityEnum,
  assigneeIds: z.array(z.string().uuid()).min(0).max(20),
  linkedFilter: z.record(z.string(), z.any()).nullable().optional(),
  linkedEntityType: z
    .enum(["client","product","mgmv_agreement","mgmv_installment","collection","import_batch"])
    .nullable()
    .optional(),
  linkedEntityId: z.string().max(120).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  source: z.enum(["concierge", "manual", "dashboard_card", "section_card"]).default("concierge"),
});

/**
 * Cria a tarefa (uma por responsável quando há múltiplos).
 * Exige confirmação no cliente — o servidor não valida UX, mas exige role.
 */
export const createConciergeTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await loadCallerRoles(supabase, userId);
    if (!canCreateTasks(roles)) {
      throw new Error("Você não tem permissão para criar tarefas pelo Concierge.");
    }

    const targets = data.assigneeIds.length > 0 ? data.assigneeIds : [null];
    const created: string[] = [];

    for (const assigneeId of targets) {
      // Valida escada de atribuição
      if (assigneeId && assigneeId !== userId) {
        const { data: ok } = await supabase.rpc("can_assign_to", {
          _assigner: userId,
          _assignee: assigneeId,
        });
        if (!ok) {
          throw new Error("Você não tem permissão para atribuir tarefas a um dos usuários selecionados.");
        }
      }
      const payload: Record<string, unknown> = {
        title: data.title,
        description: data.description ?? null,
        status: "todo",
        priority: mapPriority(data.priority),
        assignee_id: assigneeId,
        created_by: userId,
        due_at: data.dueAt ?? null,
        client_id: data.linkedEntityType === "client" ? data.linkedEntityId : null,
        product_id: data.linkedEntityType === "product" ? data.linkedEntityId : null,
        tags: [`concierge:${data.taskType}`],
        checklist: [],
        position: Date.now() % 1_000_000,
        task_type: data.taskType,
        source: data.source,
        linked_filter: data.linkedFilter ?? null,
        linked_entity_type: data.linkedEntityType ?? null,
        linked_entity_id: data.linkedEntityId ?? null,
      };
      const { data: row, error } = await supabase
        .from("team_tasks")
        .insert(payload as any)
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await supabase.from("team_task_activity").insert({
        task_id: (row as any).id,
        actor_id: userId,
        action: "created",
        payload: {
          source: "concierge",
          task_type: data.taskType,
          assignee_id: assigneeId,
          linked_filter: data.linkedFilter ?? null,
          linked_entity_type: data.linkedEntityType ?? null,
          linked_entity_id: data.linkedEntityId ?? null,
        } as any,
      } as any);
      created.push((row as any).id);
    }

    return { ok: true, createdIds: created };
  });