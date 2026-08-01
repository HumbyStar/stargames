import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface OnlineUser {
  userId: string;
  label: string;
  lastSeen: string;
}

/** Lista quem está com sinal ativo (heartbeat) nos últimos 2 minutos. */
export const listOnlineUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ users: OnlineUser[]; me: string }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("list_online_users", {
      _window_seconds: 120,
    });
    if (error) throw new Error(error.message);
    const users: OnlineUser[] = (data ?? []).map((r: any) => ({
      userId: r.user_id as string,
      label:
        (r.display_name as string | null)?.trim() ||
        (r.user_email as string | null) ||
        "Usuário",
      lastSeen: r.last_seen as string,
    }));
    return { users, me: userId };
  });
