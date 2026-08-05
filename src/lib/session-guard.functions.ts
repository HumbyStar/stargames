import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { hasAnyInternalRole } from "./session-guard.server";

export type ClaimResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: "no_internal_access" }
  | { ok: false; reason: "session_already_active"; lastSeen: string };

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

    // Sessões concorrentes liberadas: o dispositivo atual sempre toma o slot.
    // O `existing` é mantido apenas para registro/auditoria — nunca bloqueia.
    void existing;

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

    // Sessões concorrentes liberadas: cada dispositivo mantém o próprio
    // heartbeat sem expulsar os outros. O dispositivo em uso sempre permanece
    // ativo. A tabela ainda registra a última sessão vista, apenas para
    // auditoria — nunca rejeitamos por "replaced".
    await supabase
      .from("active_sessions")
      .upsert(
        { user_id: userId, session_id: data.sessionId, last_seen: new Date().toISOString() },
        { onConflict: "user_id" },
      );
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