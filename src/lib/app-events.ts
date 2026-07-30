// Barramento simples de eventos locais do app (backup, sandbox, modo local, reset).
export type AppEventCategory =
  | "backup"
  | "sandbox"
  | "local"
  | "sistema"
  | "importacao";

export interface AppLocalEvent {
  id: string;
  category: AppEventCategory;
  title: string;
  description?: string;
  severity?: "info" | "success" | "warning" | "danger";
  at: string;
}

const EVENT_NAME = "app:activity";

export function emitAppEvent(
  e: Omit<AppLocalEvent, "id" | "at"> & { id?: string; at?: string },
): void {
  if (typeof window === "undefined") return;
  const detail: AppLocalEvent = {
    id: e.id ?? `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    at: e.at ?? new Date().toISOString(),
    severity: e.severity ?? "info",
    category: e.category,
    title: e.title,
    description: e.description,
  };
  window.dispatchEvent(new CustomEvent<AppLocalEvent>(EVENT_NAME, { detail }));
}

export function onAppEvent(cb: (e: AppLocalEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (ev: Event) => cb((ev as CustomEvent<AppLocalEvent>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
