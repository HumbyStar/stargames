import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole =
  | "admin"
  | "manager"
  | "operator"
  | "viewer"
  | "admin_master"
  | "gerente"
  | "supervisor"
  | "funcionario"
  | "envio"
  | "mgmv";
export type AppPermission =
  | "dashboard.view"
  | "clientes.view"
  | "clientes.edit"
  | "collection.view"
  | "collection.edit"
  | "mgmv.view"
  | "mgmv.edit"
  | "import.use"
  | "finance.view"
  | "settings.view"
  | "users.manage"
  | "team.view"
  | "team.assign.all"
  | "team.assign.team"
  | "team.task.update_own"
  | "team.task.comment"
  | "punch.clock"
  | "shipping.mark_sent"
  | "mgmv.register_product";

export interface MyAccess {
  userId: string;
  email: string | null;
  roles: AppRole[];
  permissions: AppPermission[];
  isFirstUser: boolean;
}

/**
 * Retorna papéis e permissões do usuário autenticado.
 * Faz bootstrap (promove a admin) se ainda não existir nenhum admin.
 */
export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyAccess> => {
    const { supabase, userId, claims } = context;

    // Bootstrap: se ainda não há admin, promove o usuário atual.
    await supabase.rpc("bootstrap_first_admin");

    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = ((rolesRows ?? []).map((r) => r.role) as AppRole[]) ?? [];

    let permissions: AppPermission[] = [];
    if (roles.length > 0) {
      const { data: permRows } = await supabase
        .from("role_permissions")
        .select("permission")
        .in("role", roles);
      const set = new Set<AppPermission>();
      for (const r of permRows ?? []) set.add(r.permission as AppPermission);
      permissions = Array.from(set);
    }

    return {
      userId,
      email: (claims as { email?: string } | null)?.email ?? null,
      roles,
      permissions,
      isFirstUser: roles.includes("admin"),
    };
  });

export const listRolePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("role_permissions")
      .select("role, permission");
    if (error) throw new Error(error.message);
    return (data ?? []) as { role: AppRole; permission: AppPermission }[];
  });
