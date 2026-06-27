import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, isOverdue, daysLate, formatDateBR, getMGMVDisplay, type Client, type Product, type ImportHistoryEntry } from "./store";
import { usePersistedState } from "./use-persisted-state";

export type NotificationType =
  | "overdue_product"
  | "overdue_mgmv"
  | "upcoming_mgmv"
  | "import_errors"
  | "import_completed";

export interface NotificationPreferences {
  overdue_product: boolean;
  overdue_mgmv: boolean;
  upcoming_mgmv: boolean;
  import_errors: boolean;
  import_completed: boolean;
}

export const defaultNotificationPrefs: NotificationPreferences = {
  overdue_product: true,
  overdue_mgmv: true,
  upcoming_mgmv: true,
  import_errors: true,
  import_completed: false,
};

export const notificationTypeLabels: Record<NotificationType, { label: string; description: string }> = {
  overdue_product: {
    label: "Produtos vencidos",
    description: "Reservas e pendências em aberto que passaram do prazo.",
  },
  overdue_mgmv: {
    label: "Parcelas MGMV vencidas",
    description: "Acordos MGMV com pelo menos uma parcela atrasada.",
  },
  upcoming_mgmv: {
    label: "Parcelas MGMV próximas",
    description: "Parcelas com vencimento nos próximos 3 dias.",
  },
  import_errors: {
    label: "Erros de importação",
    description: "Avisa quando a última importação registrou erros.",
  },
  import_completed: {
    label: "Importações concluídas",
    description: "Notifica ao final de cada importação bem-sucedida.",
  },
};

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  createdAt: string; // ISO
  severity: "info" | "warning" | "danger";
  clientId?: string;
}

export function deriveNotifications(
  clients: Client[],
  products: Product[],
  importHistory: ImportHistoryEntry[],
  prefs: NotificationPreferences,
): AppNotification[] {
  const out: AppNotification[] = [];
  const clientById = new Map(clients.map((c) => [c.id, c]));

  if (prefs.overdue_product) {
    for (const p of products) {
      if (p.situation !== "Em Aberto") continue;
      if (p.financialStatus !== "Reserva" && p.financialStatus !== "Pendente") continue;
      if (!isOverdue(p.dueDate)) continue;
      const owner = clientById.get(p.clientId);
      const late = daysLate(p.dueDate);
      out.push({
        id: `overdue_product:${p.id}`,
        type: "overdue_product",
        title: `${p.name} vencido há ${late}d`,
        description: `${owner?.name ?? "Cliente"} · venceu em ${formatDateBR(p.dueDate)}`,
        createdAt: p.dueDate,
        severity: late > 7 ? "danger" : "warning",
        clientId: p.clientId,
      });
    }
  }

  for (const c of clients) {
    const m = getMGMVDisplay(c);
    if (!m) continue;
    if (prefs.overdue_mgmv && m.hasOverdue) {
      const firstOverdue = c.mgmv!.installments
        .filter((i) => !i.paid && isOverdue(i.dueDate))
        .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))[0];
      if (firstOverdue) {
        out.push({
          id: `overdue_mgmv:${c.id}:${firstOverdue.number}`,
          type: "overdue_mgmv",
          title: `MGMV vencido — ${c.name}`,
          description: `Parcela ${firstOverdue.number}/${firstOverdue.total} venceu em ${formatDateBR(firstOverdue.dueDate)}`,
          createdAt: firstOverdue.dueDate,
          severity: "danger",
          clientId: c.id,
        });
      }
    }
    if (prefs.upcoming_mgmv && m.nextInstallment && !isOverdue(m.nextInstallment.dueDate)) {
      const diff = Math.ceil((+new Date(m.nextInstallment.dueDate) - Date.now()) / 86400000);
      if (diff >= 0 && diff <= 3) {
        out.push({
          id: `upcoming_mgmv:${c.id}:${m.nextInstallment.number}`,
          type: "upcoming_mgmv",
          title: `Parcela MGMV em ${diff}d — ${c.name}`,
          description: `Parcela ${m.nextInstallment.number}/${m.nextInstallment.total} vence em ${formatDateBR(m.nextInstallment.dueDate)}`,
          createdAt: new Date().toISOString(),
          severity: "warning",
          clientId: c.id,
        });
      }
    }
  }

  const last = importHistory[0];
  if (last) {
    if (prefs.import_errors && last.errors > 0) {
      out.push({
        id: `import_errors:${last.id}`,
        type: "import_errors",
        title: `Importação com ${last.errors} erro(s)`,
        description: `${last.file} · ${formatDateBR(last.date)}`,
        createdAt: last.date,
        severity: "danger",
      });
    }
    if (prefs.import_completed && last.errors === 0 && last.status === "Concluído") {
      const recent = Date.now() - +new Date(last.date) < 24 * 3600_000;
      if (recent) {
        out.push({
          id: `import_completed:${last.id}`,
          type: "import_completed",
          title: `Importação concluída`,
          description: `${last.file} · ${last.clientsCreated} clientes, ${last.productsAdded} produtos`,
          createdAt: last.date,
          severity: "info",
        });
      }
    }
  }

  return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function useNotificationPrefs() {
  return usePersistedState<NotificationPreferences>(
    "notifications.prefs",
    defaultNotificationPrefs,
  );
}

export function useNotifications() {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const importHistory = useStore((s) => s.importHistory);
  const [prefs, setPrefs] = useNotificationPrefs();
  const [readIds, setReadIds] = usePersistedState<string[]>("notifications.readIds", []);

  // Polling: força recálculo a cada 60s para refletir vencimentos baseados em data
  // mesmo quando o estado do store não mudou.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const all = useMemo(
    () => deriveNotifications(clients, products, importHistory, prefs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, products, importHistory, prefs, tick],
  );

  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const activeIds = useMemo(() => new Set(all.map((n) => n.id)), [all]);

  // Limpa IDs "lidos" que não existem mais entre as notificações ativas para
  // que, se a condição reaparecer no futuro, a notificação volte como nova.
  useEffect(() => {
    if (readIds.length === 0) return;
    const filtered = readIds.filter((id) => activeIds.has(id));
    if (filtered.length !== readIds.length) setReadIds(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds]);

  const notifications = useMemo(
    () => all.map((n) => ({ ...n, read: readSet.has(n.id) })),
    [all, readSet],
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    [setReadIds],
  );

  const markAllRead = useCallback(() => {
    setReadIds(all.map((n) => n.id));
  }, [setReadIds, all]);

  return { notifications, unreadCount, markRead, markAllRead, prefs, setPrefs };
}