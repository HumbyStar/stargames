import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listOnlineUsers, type OnlineUser } from "@/lib/presence.functions";
import type { ConnectionStatus } from "@/lib/use-connection-status";
import { useIdle } from "@/lib/use-idle";
import { cn } from "@/lib/utils";

/** Bolinha de status (verde = conectado, laranja = instável, vermelho = offline, cinza = ocioso). Apenas visual. */
export function PresenceDot({
  online,
  status,
  idle,
  className,
}: {
  online?: boolean;
  status?: ConnectionStatus;
  idle?: boolean;
  className?: string;
}) {
  const isIdle = idle ?? useIdle().idle;
  const state: ConnectionStatus = status ?? (online === false ? "offline" : "online");
  const label = isIdle
    ? "Ocioso"
    : state === "online"
      ? "Conectado"
      : state === "unstable"
        ? "Rede instável"
        : "Offline";
  const color = isIdle
    ? "bg-slate-400"
    : state === "online"
      ? "bg-emerald-500"
      : state === "unstable"
        ? "bg-orange-500"
        : "bg-red-500";
  const ping = isIdle
    ? null
    : state === "online"
      ? "bg-emerald-500/60"
      : state === "unstable"
        ? "bg-orange-500/60"
        : null;
  return (
    <span
      aria-hidden
      title={label}
      className={cn(
        "pointer-events-none absolute -bottom-0.5 -right-0.5 z-10 grid size-3.5 place-items-center rounded-full ring-2 ring-background",
        color,
        className,
      )}
    >
      {ping && (
        <span className={cn("absolute inset-0 animate-ping rounded-full", ping)} />
      )}
    </span>
  );
}

/** Faixa minimalista com quem está conectado agora. Pausa enquanto ocioso. */
export function OnlineUsersStrip({ active }: { active: boolean }) {
  const fetchOnline = useServerFn(listOnlineUsers);
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const { idle } = useIdle();

  useEffect(() => {
    if (!active || idle) return;
    let cancelled = false;

    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        const res = await fetchOnline();
        if (cancelled) return;
        setUsers(res.users);
        setMe(res.me);
      } catch {
        // conexão instável — tenta no próximo ciclo
      }
    }

    void load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, idle, fetchOnline]);

  if (users.length === 0) return null;

  const others = users.filter((u) => u.userId !== me);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80">
        {users.length} {users.length === 1 ? "conectado" : "conectados"}
      </span>
      {others.length === 0 ? (
        <span>Somente você conectado</span>
      ) : (
        users.map((u) => (
          <span key={u.userId} className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="max-w-[140px] truncate">
              {u.userId === me ? "você" : u.label}
            </span>
          </span>
        ))
      )}
    </div>
  );
}
