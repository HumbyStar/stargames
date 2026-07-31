import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Modo Manutenção — bloqueia usuários não-admin enquanto o banco é migrado
// para uma conta Supabase própria. O estado vive em uma linha dedicada de
// app_settings (id="system_flags"), isolada das configurações comuns, lida
// e gravada apenas por admins via service role.
// ---------------------------------------------------------------------------

/** Linha dedicada em app_settings — nunca tocada pelo store/ui_state. */
const FLAGS_ID = "system_flags";
const FLAGS_ENV = "producao" as const;

export interface MaintenanceState {
  active: boolean;
  startedAt: string | null;
  message: string;
  isAdmin: boolean;
  adminName: string | null;
}

function defaultState(): MaintenanceState {
  return { active: false, startedAt: null, message: "", isAdmin: false, adminName: null };
}

interface FlagsRow {
  ui_state: unknown;
}

function parseFlags(row: FlagsRow | null): { active: boolean; startedAt: string | null; message: string } {
  const m = (row?.ui_state as Record<string, unknown> | null | undefined)?.maintenance as
    | { active?: unknown; startedAt?: unknown; message?: unknown }
    | undefined;
  return {
    active: Boolean(m?.active),
    startedAt: typeof m?.startedAt === "string" ? (m.startedAt as string) : null,
    message: typeof m?.message === "string" ? (m.message as string) : "",
  };
}

async function readFlags(admin: any): Promise<{ active: boolean; startedAt: string | null; message: string }> {
  const { data, error } = await admin
    .from("app_settings")
    .select("ui_state")
    .eq("id", FLAGS_ID)
    .eq("env", FLAGS_ENV)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseFlags((data as FlagsRow | null) ?? null);
}

async function isAdmin(ctx: { supabase: any; userId: string }): Promise<boolean> {
  const [admin, adminMaster] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin_master" }),
  ]);
  if (admin.error) throw new Error(admin.error.message);
  if (adminMaster.error) throw new Error(adminMaster.error.message);
  return Boolean(admin.data) || Boolean(adminMaster.data);
}

/**
 * Leitura autoritativa do estado de manutenção. Pública para qualquer
 * usuário autenticado (o guard e o SessionGuard chamam para decidir o
 * bloqueio), mas isenta de dados sensíveis além da própria flag.
 */
export const getMaintenanceState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MaintenanceState> => {
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const flags = await readFlags(supabaseAdmin);
    let adminName: string | null = null;
    if (admin) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("full_name")
        .eq("id", context.userId)
        .maybeSingle();
      adminName = (prof as { full_name?: string | null } | null)?.full_name ?? null;
    }
    return { ...flags, isAdmin: admin, adminName };
  });

const setSchema = z.object({
  active: z.boolean(),
  message: z.string().max(500).optional().default(""),
});

/** Alterna o modo manutenção. Somente admin / admin_master. */
export const setMaintenanceMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setSchema.parse(d))
  .handler(async ({ data, context }): Promise<MaintenanceState> => {
    const admin = await isAdmin(context);
    if (!admin) throw new Error("Forbidden: admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const current = await readFlags(supabaseAdmin);
    const next = {
      active: data.active,
      startedAt: data.active
        ? current.startedAt ?? new Date().toISOString()
        : null,
      message: data.active ? (data.message ?? current.message ?? "") : "",
    };

    // Lê o ui_state atual da linha dedicada (se existir) para preservar
    // quaisquer outras flags futuras, e faz merge do objeto maintenance.
    const { data: existing } = await supabaseAdmin
      .from("app_settings")
      .select("ui_state")
      .eq("id", FLAGS_ID)
      .eq("env", FLAGS_ENV)
      .maybeSingle();
    const prevUi = ((existing as FlagsRow | null)?.ui_state as Record<string, unknown> | null) ?? {};
    const mergedUi = { ...prevUi, maintenance: next };

    const { error } = await supabaseAdmin.from("app_settings").upsert({
      id: FLAGS_ID,
      env: FLAGS_ENV,
      ui_state: mergedUi,
    });
    if (error) throw new Error(error.message);

    let adminName: string | null = null;
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    adminName = (prof as { full_name?: string | null } | null)?.full_name ?? null;

    return { ...next, isAdmin: true, adminName };
  });
