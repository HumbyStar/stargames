import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Janela em segundos durante a qual uma sessão é considerada "ativa".
// O heartbeat do cliente roda a cada 30s, então 90s tolera 2 falhas seguidas.
const ACTIVE_WINDOW_SECONDS = 90;

export type ClaimResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: "no_internal_access" }
  | { ok: false; reason: "session_already_active"; lastSeen: string };

async function hasAnyInternalRole(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

const claimSchema = z.object({
  sessionId: z.string().min(8).max(128),
  force: z.boolean().optional(),
});

export const claimSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => claimSchema.parse(d))
  .handler(async ({ data, context }): Promise<ClaimResult> => {
    const { supabase, userId } = context;

    const internal = await hasAnyInternalRole(supabase, userId);
    if (!internal) return { ok: false, reason: "no_internal_access" };

    const { data: existing } = await supabase
      .from("active_sessions")
      .select("session_id, last_seen")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing && existing.session_id !== data.sessionId && !data.force) {
      const lastSeenMs = new Date(existing.last_seen).getTime();
      const ageSeconds = (Date.now() - lastSeenMs) / 1000;
      if (ageSeconds < ACTIVE_WINDOW_SECONDS) {
        return {
          ok: false,
          reason: "session_already_active",
          lastSeen: existing.last_seen,
        };
      }
    }

    const { error: upErr } = await supabase
      .from("active_sessions")
      .upsert(
        { user_id: userId, session_id: data.sessionId, last_seen: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (upErr) throw new Error(upErr.message);
    return { ok: true, sessionId: data.sessionId };
  });

const heartbeatSchema = z.object({ sessionId: z.string().min(8).max(128) });

export type HeartbeatResult =
  | { valid: true }
  | { valid: false; reason: "replaced" | "no_internal_access" };

export const heartbeatSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => heartbeatSchema.parse(d))
  .handler(async ({ data, context }): Promise<HeartbeatResult> => {
    const { supabase, userId } = context;

    const internal = await hasAnyInternalRole(supabase, userId);
    if (!internal) return { valid: false, reason: "no_internal_access" };

    const { data: existing } = await supabase
      .from("active_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existing || existing.session_id !== data.sessionId) {
      return { valid: false, reason: "replaced" };
    }

    await supabase
      .from("active_sessions")
      .update({ last_seen: new Date().toISOString() })
      .eq("user_id", userId);
    return { valid: true };
  });

const releaseSchema = z.object({ sessionId: z.string().min(8).max(128) });

export const releaseSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => releaseSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("active_sessions")
      .delete()
      .eq("user_id", userId)
      .eq("session_id", data.sessionId);
    return { ok: true };
  });