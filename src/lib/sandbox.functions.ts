import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  SANDBOX_TABLES,
  CLONE_ORDER,
  type CloneTable,
  remapRow,
} from "./sandbox-clone";

export interface SandboxState {
  active: boolean;
  clonedAt: string | null;
  counts: Record<string, number>;
  isAdmin: boolean;
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .in("role", ["admin", "admin_master"]);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Forbidden: admin only");
}

async function isAdminUser(ctx: { supabase: any; userId: string }) {
  try {
    await assertAdmin(ctx);
    return true;
  } catch {
    return false;
  }
}

async function readState(admin: any, userId: string) {
  const { data } = await admin
    .from("sandbox_state")
    .select("active,cloned_at")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    active: Boolean(data?.active),
    clonedAt: (data?.cloned_at as string | null) ?? null,
  };
}

async function countsForEnv(admin: any, env: "producao" | "sandbox") {
  const entries = await Promise.all(
    SANDBOX_TABLES.map(async (table) => {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("env", env);
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, number>;
}

export const getSandboxState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SandboxState> => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) {
      return { active: false, clonedAt: null, counts: {}, isAdmin: false };
    }
    const { supabaseAdmin: adminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminClient as any;
    const state = await readState(supabaseAdmin, context.userId);
    const counts = await countsForEnv(supabaseAdmin, "sandbox");
    return { ...state, counts, isAdmin: true };
  });

export const setSandboxMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { active: boolean }) => z.object({ active: z.boolean() }).parse(data))
  .handler(async ({ data, context }): Promise<SandboxState> => {
    await assertAdmin(context);
    const { supabaseAdmin: adminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminClient as any;
    const { error } = await supabaseAdmin
      .from("sandbox_state")
      .upsert(
        { user_id: context.userId, active: data.active, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    const state = await readState(supabaseAdmin, context.userId);
    const counts = await countsForEnv(supabaseAdmin, "sandbox");
    return { ...state, counts, isAdmin: true };
  });

export const resetSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ deleted: Record<string, number> }> => {
    await assertAdmin(context);
    const { supabaseAdmin: adminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminClient as any;
    const before = await countsForEnv(supabaseAdmin, "sandbox");
    // Ordem inversa das dependências
    for (const table of [...CLONE_ORDER].reverse()) {
      const { error } = await supabaseAdmin.from(table.name).delete().eq("env", "sandbox");
      if (error) throw new Error(`${table.name}: ${error.message}`);
    }
    await supabaseAdmin
      .from("sandbox_state")
      .upsert(
        { user_id: context.userId, cloned_at: null, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    return { deleted: before };
  });

export interface CloneResult {
  copied: Record<string, number>;
  errors: string[];
  clonedAt: string;
}

const BATCH = 400;

export const cloneProductionToSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CloneResult> => {
    await assertAdmin(context);
    const { supabaseAdmin: adminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminClient as any;

    // Limpa o sandbox anterior (ordem inversa de dependência)
    for (const table of [...CLONE_ORDER].reverse()) {
      const { error } = await supabaseAdmin.from(table.name).delete().eq("env", "sandbox");
      if (error) throw new Error(`limpeza ${table.name}: ${error.message}`);
    }

    const idMaps: Record<string, Record<string, string>> = {};
    const copied: Record<string, number> = {};
    const errors: string[] = [];

    for (const table of CLONE_ORDER as CloneTable[]) {
      idMaps[table.name] = {};
      let from = 0;
      let total = 0;
      for (;;) {
        const { data, error } = await supabaseAdmin
          .from(table.name)
          .select("*")
          .eq("env", "producao")
          .range(from, from + BATCH - 1);
        if (error) {
          errors.push(`${table.name}: ${error.message}`);
          break;
        }
        const rows = (data ?? []) as Record<string, unknown>[];
        if (rows.length === 0) break;

        const mapped = rows.map((row) => remapRow(table, row, idMaps));
        const { error: insertError } = await supabaseAdmin.from(table.name).insert(mapped);
        if (insertError) {
          errors.push(`${table.name}: ${insertError.message}`);
          break;
        }
        total += mapped.length;
        if (rows.length < BATCH) break;
        from += BATCH;
      }
      copied[table.name] = total;
    }

    const clonedAt = new Date().toISOString();
    await supabaseAdmin
      .from("sandbox_state")
      .upsert(
        { user_id: context.userId, cloned_at: clonedAt, updated_at: clonedAt },
        { onConflict: "user_id" },
      );

    return { copied, errors, clonedAt };
  });
