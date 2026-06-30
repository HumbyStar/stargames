import { Check, CheckCheck, Bell as BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotifications, notificationTypeLabels } from "@/lib/notifications";
import { useStore, formatDateBR } from "@/lib/store";

export function NotificationsPanel({ onOpenClient }: { onOpenClient?: (clientId: string) => void }) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const openClient = useStore((s) => s.openClient);

  const visible = notifications.filter((n) => !n.read);

  if (visible.length === 0) {
    return (
      <div className="grid place-items-center gap-2 py-10 text-sm text-muted-foreground">
        <BellIcon className="size-8 opacity-60" />
        Nenhuma notificação não lida.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {unreadCount} não lida(s) · {notifications.length} no total
        </span>
        {unreadCount > 0 && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={markAllRead}>
            <CheckCheck className="size-3.5" /> Marcar todas
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {visible.map((n) => (
          <li
            key={n.id}
            className={cn(
              "group flex items-start gap-3 rounded-lg border border-border bg-accent/30 p-3 transition hover:bg-accent/50 animate-fade-in",
            )}
          >
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                n.severity === "danger" && "bg-destructive",
                n.severity === "warning" && "bg-amber-500",
                n.severity === "info" && "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="line-clamp-2 text-sm font-semibold">
                  {n.title}
                </p>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {notificationTypeLabels[n.type].label.split(" ")[0]}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.description}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatDateBR(n.createdAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {n.clientId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      if (n.clientId) {
                        openClient(n.clientId);
                        onOpenClient?.(n.clientId);
                      }
                      markRead(n.id);
                    }}
                  >
                    Abrir cliente
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => markRead(n.id)}
                >
                  <Check className="size-3" /> Marcar como lida
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}