import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AppRole } from "./permissions.functions";

const ROLES: AppRole[] = [
  "admin_master","admin","gerente","manager","supervisor",
  "funcionario","envio","mgmv","operator","viewer",
];
const roleSchema = z.enum([
  "admin_master","admin","gerente","manager","supervisor",
  "funcionario","envio","mgmv","operator","viewer",
]);

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .in("role", ["admin", "admin_master"]);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("Forbidden: admin only");
  }
}

/** Somente admin_master pode conceder ou remover o perfil admin_master. */
async function assertCanAssignRoles(
  ctx: { supabase: any; userId: string },
  desiredRoles: AppRole[],
  targetUserId?: string,
) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin_master");
  if (error) throw new Error(error.message);
  const isMaster = Boolean(data && data.length > 0);
  if (isMaster) return;

  if (desiredRoles.includes("admin_master")) {
    throw new Error("Somente um admin master pode conceder o perfil admin master.");
  }
  if (targetUserId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetUserId)
      .eq("role", "admin_master");
    if (current && current.length > 0) {
      throw new Error("Somente um admin master pode alterar os perfis de outro admin master.");
    }
  }
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
  roles: AppRole[];
  responsibilities: UserResponsibility[];
  canReceiveTasks: boolean;
}

export type UserResponsibility =
  | "cobranca"
  | "mgmv"
  | "envio"
  | "importacao"
  | "revisao_ia"
  | "cadastro"
  | "financeiro"
  | "atendimento"
  | "leiloes"
  | "admin";

const responsibilityEnum = z.enum([
  "cobranca","mgmv","envio","importacao","revisao_ia",
  "cadastro","financeiro","atendimento","leiloes","admin",
]);

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 200,
    });
    if (usersErr) throw new Error(usersErr.message);

    const ids = usersData.users.map((u) => u.id);
    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const { data: profilesRows } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, can_receive_tasks")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const { data: respRows } = await supabaseAdmin
      .from("user_responsibilities")
      .select("user_id, responsibility")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of rolesRows ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as AppRole);
      rolesByUser.set(r.user_id, arr);
    }
    const profileByUser = new Map<string, { name: string | null; canReceive: boolean }>();
    for (const p of profilesRows ?? [])
      profileByUser.set((p as any).id, {
        name: (p as any).display_name ?? null,
        canReceive: (p as any).can_receive_tasks ?? true,
      });
    const respByUser = new Map<string, UserResponsibility[]>();
    for (const r of respRows ?? []) {
      const arr = respByUser.get((r as any).user_id) ?? [];
      arr.push((r as any).responsibility as UserResponsibility);
      respByUser.set((r as any).user_id, arr);
    }

    return usersData.users.map<AdminUserRow>((u) => ({
      id: u.id,
      email: u.email ?? null,
      fullName: profileByUser.get(u.id)?.name ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      banned: Boolean((u as any).banned_until),
      roles: rolesByUser.get(u.id) ?? [],
      responsibilities: respByUser.get(u.id) ?? [],
      canReceiveTasks: profileByUser.get(u.id)?.canReceive ?? true,
    }));
  });

const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().max(120).optional(),
  roles: z.array(roleSchema).min(1).max(ROLES.length),
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await assertCanAssignRoles(context, data.roles);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verificação de duplicidade: rejeita antes de criar para não disparar
    // erros confusos do gotrue e evitar travas de permissões.
    const targetEmail = data.email.toLowerCase();
    const { data: existingList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw new Error(listErr.message);
    const duplicate = existingList.users.find((u) => (u.email ?? "").toLowerCase() === targetEmail);
    if (duplicate) {
      throw new Error(
        `Já existe um usuário com este e-mail (${data.email}). Edite o usuário existente em vez de criar outro.`,
      );
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName ?? null },
    });
    if (error || !created.user) {
      const msg = error?.message ?? "Falha ao criar usuário";
      if (/already|registered|exists/i.test(msg)) {
        throw new Error(`Já existe um usuário com este e-mail (${data.email}).`);
      }
      throw new Error(msg);
    }

    const uid = created.user.id;
    if (data.fullName) {
      await supabaseAdmin.from("profiles").upsert({ id: uid, display_name: data.fullName });
    }
    const rows = Array.from(new Set(data.roles)).map((role) => ({ user_id: uid, role: role as AppRole }));
    // upsert idempotente com base na restrição UNIQUE(user_id, role) — evita
    // duplicidade caso a função seja reexecutada.
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .upsert(rows, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (insErr) throw new Error(insErr.message);
    return { id: uid };
  });

const updateRolesSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(roleSchema).min(1),
});

export const updateUserRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateRolesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await assertCanAssignRoles(context, data.roles, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const desired = Array.from(new Set(data.roles));
    if (desired.length === 0) {
      throw new Error("É necessário atribuir pelo menos um perfil interno ao usuário.");
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const rows = desired.map((role) => ({ user_id: data.userId, role }));
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(rows, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const resetPwSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(8).max(128),
});

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resetPwSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const toggleBanSchema = z.object({
  userId: z.string().uuid(),
  banned: z.boolean(),
});

export const setUserBanned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => toggleBanSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.banned ? "876000h" : "none",
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteSchema = z.object({ userId: z.string().uuid() });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => deleteSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("Você não pode excluir sua própria conta.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const respSchema = z.object({
  userId: z.string().uuid(),
  responsibilities: z.array(responsibilityEnum),
  canReceiveTasks: z.boolean(),
});

export const updateUserResponsibilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => respSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("profiles").upsert({
      id: data.userId,
      can_receive_tasks: data.canReceiveTasks,
    } as any);
    await supabaseAdmin.from("user_responsibilities").delete().eq("user_id", data.userId);
    if (data.responsibilities.length > 0) {
      const rows = Array.from(new Set(data.responsibilities)).map((r) => ({
        user_id: data.userId,
        responsibility: r,
      }));
      const { error } = await supabaseAdmin
        .from("user_responsibilities")
        .upsert(rows, { onConflict: "user_id,responsibility", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
