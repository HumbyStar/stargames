import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { onAppEvent, type AppLocalEvent } from "./app-events";

export type ActivityCategory =
  | "clientes"
  | "mgmv"
  | "importacao"
  | "backup"
  | "financeiro"
  | "equipe"
  | "configuracoes"
  | "seguranca"
  | "sistema";

export type ActivitySeverity = "info" | "success" | "warning" | "danger";

export interface ActivityEvent {
  id: string;
  category: ActivityCategory;
  severity: ActivitySeverity;
  title: string;
  description?: string;
  at: string;
  actorId?: string | null;
  actorLabel: string;
  local?: boolean;
}

export const activityCategoryLabels: Record<ActivityCategory, string> = {
  clientes: "Clientes",
  mgmv: "MGMV",
  importacao: "Importação",
  backup: "Backup",
  financeiro: "Financeiro",
  equipe: "Equipe",
  configuracoes: "Configurações",
  seguranca: "Segurança",
  sistema: "Sistema",
};

interface AuditRow {
  id: string;
  table_name: string;
  action: string;
  row_id: string | null;
  user_id: string | null;
  user_email: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

const TABLE_CATEGORY: Record<string, ActivityCategory> = {
  clients: "clientes",
  products: "clientes",
  mgmv_agreements: "mgmv",
  mgmv_installments: "mgmv",
  import_history: "importacao",
  system_backups: "backup",
  nf_invoices: "financeiro",
  team_tasks: "equipe",
  app_settings: "configuracoes",
  saved_filters: "configuracoes",
  user_roles: "seguranca",
  role_permissions: "seguranca",
  ai_automations: "sistema",
  sandbox_state: "sistema",
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const CURRENCY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Campos alterados (ignora ruído técnico). */
function changedFields(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): string[] {
  if (!oldData || !newData) return [];
  const skip = new Set(["updated_at", "created_at", "id", "env"]);
  const out: string[] = [];
  for (const key of Object.keys(newData)) {
    if (skip.has(key)) continue;
    if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) out.push(key);
  }
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  name: "nome",
  phone: "telefone",
  notes: "observações",
  folder: "pasta",
  customer_data: "dados do cliente",
  client_type: "tipo de cliente",
  total_value: "valor total",
  paid_value: "valor pago",
  financial_status: "status financeiro",
  situation: "situação",
  due_date: "data limite",
  status: "status",
  paid_at: "pagamento",
  amount: "valor",
  remaining_value: "saldo restante",
  installments_count: "nº de parcelas",
  review_status: "revisão",
  assignee_id: "responsável",
  priority: "prioridade",
  title: "título",
  role: "papel",
  active: "ativo",
};

const labelField = (f: string) => FIELD_LABELS[f] ?? f.replace(/_/g, " ");

function describeChanges(fields: string[]): string | undefined {
  if (fields.length === 0) return undefined;
  const shown = fields.slice(0, 3).map(labelField).join(", ");
  return fields.length > 3 ? `${shown} +${fields.length - 3}` : shown;
}

/** Converte um registro de auditoria em um evento legível. */
export function mapAuditRow(
  row: AuditRow,
  actorLabel: string,
): ActivityEvent | null {
  const category = TABLE_CATEGORY[row.table_name] ?? "sistema";
  const data = row.new_data ?? row.old_data ?? {};
  const prev = row.old_data ?? {};
  const action = row.action.toUpperCase();
  const verb =
    action === "INSERT" ? "criou" : action === "DELETE" ? "removeu" : "atualizou";

  let title = `${actorLabel} ${verb} um registro em ${row.table_name}`;
  let description: string | undefined;
  let severity: ActivitySeverity = action === "DELETE" ? "warning" : "info";

  switch (row.table_name) {
    case "clients": {
      const nome = str(data.name) ?? "cliente";
      title = `${actorLabel} ${verb} o cliente ${nome}`;
      description = action === "UPDATE"
        ? describeChanges(changedFields(prev, row.new_data))
        : str(data.phone);
      break;
    }
    case "products": {
      const nome = str(data.name) ?? "produto";
      title =
        action === "INSERT"
          ? `${actorLabel} adicionou o produto ${nome}`
          : `${actorLabel} ${verb} o produto ${nome}`;
      const total = num(data.total_value);
      description =
        action === "UPDATE"
          ? describeChanges(changedFields(prev, row.new_data))
          : total !== undefined
            ? CURRENCY.format(total)
            : undefined;
      break;
    }
    case "mgmv_agreements": {
      const nome = str(data.client_name) ?? "cliente";
      title =
        action === "INSERT"
          ? `${actorLabel} criou o acordo MGMV de ${nome}`
          : action === "DELETE"
            ? `${actorLabel} removeu o acordo MGMV de ${nome}`
            : `${actorLabel} atualizou o acordo MGMV de ${nome}`;
      const restante = num(data.remaining_value);
      description =
        action === "UPDATE"
          ? describeChanges(changedFields(prev, row.new_data))
          : restante !== undefined
            ? `Saldo ${CURRENCY.format(restante)}`
            : undefined;
      break;
    }
    case "mgmv_installments": {
      const n = num(data.installment_number);
      const st = str(data.status);
      const virouPaga = str(prev.status) !== st && st === "Paga";
      title = virouPaga
        ? `${actorLabel} marcou a parcela ${n ?? "?"} como paga`
        : `${actorLabel} ${verb} a parcela ${n ?? "?"}`;
      const valor = num(data.paid_amount) ?? num(data.amount);
      description = valor !== undefined ? CURRENCY.format(valor) : undefined;
      severity = virouPaga ? "success" : severity;
      break;
    }
    case "import_history": {
      const arquivo = str(data.file) ?? "arquivo";
      const erros = num(data.errors) ?? 0;
      title = `${actorLabel} executou uma importação — ${arquivo}`;
      description = `${num(data.clients_created) ?? 0} clientes, ${num(data.products_added) ?? 0} produtos${erros > 0 ? `, ${erros} erro(s)` : ""}`;
      severity = erros > 0 ? "danger" : "success";
      break;
    }
    case "system_backups": {
      const st = str(data.status) ?? "";
      if (action === "UPDATE" && str(prev.status) === st) return null;
      const size = num(data.size_bytes);
      title =
        st === "concluido" || st === "concluído" || st === "done"
          ? `${actorLabel} concluiu um backup`
          : st === "erro" || st === "failed"
            ? `Backup falhou`
            : `${actorLabel} ${action === "INSERT" ? "iniciou" : "atualizou"} um backup`;
      description = [str(data.type), size ? `${(size / 1024 / 1024).toFixed(1)} MB` : null]
        .filter(Boolean)
        .join(" · ") || undefined;
      severity = st.startsWith("err") || st === "failed" ? "danger" : "info";
      break;
    }
    case "nf_invoices": {
      const total = num(data.total_cents);
      title = `${actorLabel} ${action === "INSERT" ? "gerou" : verb} uma nota fiscal`;
      description = total !== undefined ? CURRENCY.format(total / 100) : undefined;
      break;
    }
    case "team_tasks": {
      const t = str(data.title) ?? "tarefa";
      title = `${actorLabel} ${verb} a tarefa "${t}"`;
      description =
        action === "UPDATE"
          ? describeChanges(changedFields(prev, row.new_data))
          : str(data.status);
      break;
    }
    case "app_settings": {
      title = `${actorLabel} alterou as configurações do sistema`;
      description = describeChanges(changedFields(prev, row.new_data));
      break;
    }
    case "saved_filters": {
      title = `${actorLabel} ${verb} o filtro salvo "${str(data.name) ?? ""}"`;
      break;
    }
    case "user_roles": {
      const role = str(data.role) ?? "";
      title =
        action === "INSERT"
          ? `${actorLabel} concedeu o papel ${role} a um usuário`
          : action === "DELETE"
            ? `${actorLabel} removeu o papel ${str(prev.role) ?? role} de um usuário`
            : `${actorLabel} alterou papéis de um usuário`;
      severity = "warning";
      break;
    }
    case "role_permissions": {
      title = `${actorLabel} ${verb} permissões do papel ${str(data.role) ?? str(prev.role) ?? ""}`;
      severity = "warning";
      break;
    }
    case "ai_automations": {
      title = `${actorLabel} ${verb} a automação "${str(data.name) ?? ""}"`;
      break;
    }
    case "sandbox_state": {
      const ativo = data.active === true;
      title = ativo
        ? `${actorLabel} entrou no Modo Teste`
        : `${actorLabel} saiu do Modo Teste`;
      break;
    }
    default:
      break;
  }

  return {
    id: `audit:${row.id}`,
    category,
    severity,
    title,
    description,
    at: row.changed_at,
    actorId: row.user_id,
    actorLabel,
  };
}

const LOCAL_CATEGORY: Record<AppLocalEvent["category"], ActivityCategory> = {
  backup: "backup",
  sandbox: "sistema",
  local: "sistema",
  sistema: "sistema",
  importacao: "importacao",
};

const MAX_EVENTS = 200;
const PAGE_SIZE = 50;

export interface OnlineUser {
  userId: string;
  label: string;
  lastSeen: string;
}

export function useActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [meId, setMeId] = useState<string | null>(null);

  const namesRef = useRef<Map<string, string>>(new Map());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const bufferRef = useRef<ActivityEvent[]>([]);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameFor = useCallback((userId: string | null, email: string | null) => {
    if (!userId) return "Sistema";
    return namesRef.current.get(userId) ?? email ?? "Usuário";
  }, []);

  const pushEvents = useCallback((incoming: ActivityEvent[]) => {
    bufferRef.current = [...incoming, ...bufferRef.current];
    if (flushRef.current) return;
    flushRef.current = setTimeout(() => {
      flushRef.current = null;
      const batch = bufferRef.current;
      bufferRef.current = [];
      if (batch.length === 0) return;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const fresh = batch.filter((e) => !seen.has(e.id));
        if (fresh.length === 0) return prev;
        return [...fresh, ...prev]
          .sort((a, b) => +new Date(b.at) - +new Date(a.at))
          .slice(0, MAX_EVENTS);
      });
    }, 400);
  }, []);

  // Perfis + usuário atual
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: userData }, { data: profiles }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select("id, display_name"),
      ]);
      if (!alive) return;
      setMeId(userData.user?.id ?? null);
      const map = new Map<string, string>();
      for (const p of profiles ?? []) {
        if (p.display_name) map.set(p.id, p.display_name);
      }
      namesRef.current = map;
      setEvents((prev) =>
        prev.map((e) =>
          e.actorId && map.has(e.actorId)
            ? { ...e, actorLabel: map.get(e.actorId)! }
            : e,
        ),
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Carga inicial do histórico
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (!alive) return;
      const rows = (data ?? []) as unknown as AuditRow[];
      setEvents(
        rows
          .map((r) => mapAuditRow(r, nameFor(r.user_id, r.user_email)))
          .filter((e): e is ActivityEvent => e !== null),
      );
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [nameFor]);

  const loadMore = useCallback(async () => {
    const oldest = events[events.length - 1]?.at;
    const q = supabase
      .from("audit_log")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(PAGE_SIZE);
    const { data } = oldest ? await q.lt("changed_at", oldest) : await q;
    const rows = (data ?? []) as unknown as AuditRow[];
    const mapped = rows
      .map((r) => mapAuditRow(r, nameFor(r.user_id, r.user_email)))
      .filter((e): e is ActivityEvent => e !== null);
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      return [...prev, ...mapped.filter((e) => !seen.has(e.id))];
    });
    setHasMore(rows.length === PAGE_SIZE);
  }, [events, nameFor]);

  // Realtime do audit_log
  useEffect(() => {
    const channel = supabase
      .channel("activity-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_log" },
        (payload) => {
          if (pausedRef.current) return;
          const row = payload.new as unknown as AuditRow;
          const ev = mapAuditRow(row, nameFor(row.user_id, row.user_email));
          if (ev) pushEvents([ev]);
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
      if (flushRef.current) clearTimeout(flushRef.current);
      flushRef.current = null;
    };
  }, [nameFor, pushEvents]);

  // Presença: quem está com sessão ativa
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data } = await supabase
        .from("active_sessions")
        .select("user_id, last_seen")
        .gte("last_seen", cutoff)
        .order("last_seen", { ascending: false });
      if (!alive) return;
      const seen = new Set<string>();
      const list: OnlineUser[] = [];
      for (const s of data ?? []) {
        if (seen.has(s.user_id)) continue;
        seen.add(s.user_id);
        list.push({
          userId: s.user_id,
          label: namesRef.current.get(s.user_id) ?? "Usuário",
          lastSeen: s.last_seen,
        });
      }
      setOnline(list);
    };
    void load();
    const interval = setInterval(() => void load(), 30_000);
    const channel = supabase
      .channel("activity-presence")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_sessions" },
        () => void load(),
      )
      .subscribe();
    return () => {
      alive = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  // Eventos locais do app
  useEffect(() => {
    return onAppEvent((e) => {
      if (pausedRef.current) return;
      pushEvents([
        {
          id: e.id,
          category: LOCAL_CATEGORY[e.category] ?? "sistema",
          severity: e.severity ?? "info",
          title: e.title,
          description: e.description,
          at: e.at,
          actorId: meId,
          actorLabel: (meId && namesRef.current.get(meId)) || "Você",
          local: true,
        },
      ]);
    });
  }, [meId, pushEvents]);

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.actorId) map.set(e.actorId, e.actorLabel);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [events]);

  return {
    events,
    loading,
    live,
    paused,
    setPaused,
    hasMore,
    loadMore,
    online,
    meId,
    actors,
  };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - +new Date(iso);
  if (diff < 45_000) return "agora";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
