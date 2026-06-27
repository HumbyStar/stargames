import { Bell } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Switch } from "@/components/ui/switch";
import {
  useNotificationPrefs,
  notificationTypeLabels,
  type NotificationType,
  type NotificationPreferences,
} from "@/lib/notifications";
import { toast } from "sonner";

export function NotificationsPrefsCard() {
  const [prefs, setPrefs] = useNotificationPrefs();

  const types = Object.keys(notificationTypeLabels) as NotificationType[];

  const toggle = (t: NotificationType, value: boolean) => {
    setPrefs((prev: NotificationPreferences) => ({ ...prev, [t]: value }));
    toast.success(
      value
        ? `${notificationTypeLabels[t].label} ativadas.`
        : `${notificationTypeLabels[t].label} desativadas.`,
    );
  };

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Bell className="size-4 text-primary" /> Notificações
        </span>
      }
    >
      <div className="divide-y divide-border rounded-lg border border-border bg-background/40">
        {types.map((t) => (
          <div key={t} className="flex items-start justify-between gap-4 px-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{notificationTypeLabels[t].label}</p>
              <p className="text-xs text-muted-foreground">
                {notificationTypeLabels[t].description}
              </p>
            </div>
            <Switch
              checked={prefs[t]}
              onCheckedChange={(v) => toggle(t, v)}
              aria-label={notificationTypeLabels[t].label}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        As preferências são salvas automaticamente e refletem no ícone de
        notificações da navbar em tempo real.
      </p>
    </Card>
  );
}