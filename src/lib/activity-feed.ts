import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { onAppEvent, type AppLocalEvent } from "./app-events";
import { useIdle } from "@/lib/use-idle";

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

export interface ActivityChange {
  /** Escopo (ex.: "Clientes", "Regras de negócio"). */
  scope?: string;
  label: string;
  from: string;
  to: string;
}

export interface ActivityEntity {
  table: string;
  tableLabel: string;
  rowId?: string | null;
  recordLabel?: string;
  action: "INSERT" | "UPDATE" | "DELETE";
}

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
  /** Lista completa de alterações campo a campo. */
  changes?: ActivityChange[];
  entity?: ActivityEntity;
  /** Cliente vinculado ao registro (produto, nota fiscal, parcela...). */
  clientId?: string | null;
  /** Nome do cliente resolvido — exibido na mesma linha do evento. */
  clientLabel?: string;
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

const TABLE_LABELS: Record<string, string> = {
  clients: "Cliente",
  products: "Produto",
  mgmv_agreements: "Acordo MGMV",
  mgmv_installments: "Parcela MGMV",
  import_history: "Importação",
  system_backups: "Backup",
  nf_invoices: "Nota fiscal",
  team_tasks: "Tarefa",
  app_settings: "Configurações",
  saved_filters: "Filtro salvo",
  user_roles: "Papel de usuário",
  role_permissions: "Permissões",
  ai_automations: "Automação",
  sandbox_state: "Modo Teste",
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

/** Formata qualquer valor de coluna para exibição. */
function formatCell(v: unknown): string {
  if (v === undefined || v === null) return "vazio";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return "vazio";
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
      const d = new Date(t);
      if (!Number.isNaN(+d)) return d.toLocaleString("pt-BR");
    }
    return t.length > 160 ? `${t.slice(0, 160)}…` : t;
  }
  if (Array.isArray(v)) return v.length === 0 ? "nenhum item" : `${v.length} item(ns)`;
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return "atualizado";
  }
}

/** Lista completa de alterações campo a campo de uma linha auditada. */
function rowChanges(
  action: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): ActivityChange[] {
  const skip = new Set(["updated_at", "created_at", "id", "env"]);
  if (action === "UPDATE") {
    return changedFields(oldData, newData).map((f) => ({
      label: labelField(f),
      from: formatCell(oldData?.[f]),
      to: formatCell(newData?.[f]),
    }));
  }
  const data = (action === "DELETE" ? oldData : newData) ?? {};
  return Object.keys(data)
    .filter((k) => !skip.has(k) && data[k] !== null && data[k] !== undefined)
    .map((k) => ({
      label: labelField(k),
      from: action === "DELETE" ? formatCell(data[k]) : "—",
      to: action === "DELETE" ? "removido" : formatCell(data[k]),
    }));
}

// ---------------------------------------------------------------------------
// Configurações (app_settings) — descrição detalhada do que mudou
// ---------------------------------------------------------------------------

interface SettingChange {
  section: string;
  path: string;
  from: unknown;
  to: unknown;
}

/** Chaves cujo valor é ruído técnico e não ajuda no acompanhamento. */
const SETTINGS_IGNORED = new Set([
  "__migratedFromLocalStorage_v1",
  "mgmv.lastUpdatedIds",
  // Termos digitados em campos de busca/pesquisa não são alterações de
  // configuração relevantes para o acompanhamento — geram ruído.
  "search",
  "searchTerm",
  "query",
  "globalSearch",
]);

const SECTION_LABELS: Record<string, string> = {
  preferences: "Preferências",
  rules: "Regras de negócio",
  security: "Segurança",
  ui_state: "Visualização",
};

/** Prefixos de ui_state → área do sistema. */
const AREA_LABELS: Record<string, string> = {
  clientes: "Clientes",
  mgmv: "MGMV",
  collection: "Cobrança",
  import: "Importação",
  notifications: "Notificações",
  navbar: "Barra de navegação",
  finance: "Finanças",
  equipe: "Equipe",
};

const SETTING_KEY_LABELS: Record<string, string> = {
  chip: "filtro rápido",
  search: "busca",
  folder: "pasta",
  period: "período",
  platform: "plataforma",
  financial: "status financeiro",
  situation: "situação",
  filter: "filtro",
  pageSize: "itens por página",
  customFrom: "data inicial",
  customTo: "data final",
  savedFilters: "filtros salvos",
  activeSavedId: "filtro salvo ativo",
  resetVersion: "reset de importação",
  prefs: "preferências de alerta",
  readIds: "notificações lidas",
  config: "layout dos botões",
  reservaDaysDefault: "dias padrão de reserva",
  blockReserveOnActiveMGMV: "bloquear reserva com MGMV ativo",
  autoCalculateReservaDueDate: "cálculo automático da data de reserva",
  hideAbandonosFromCollection: "ocultar abandonos da cobrança",
  hideDesistenciasFromCollection: "ocultar desistências da cobrança",
  treatOverduePendenteAsDelinquent: "tratar pendente vencido como inadimplente",
  enableAuditLog: "registro de auditoria",
  requireConfirmBeforeDelete: "confirmação antes de excluir",
  blockMassDeleteWithoutPassword: "bloquear exclusão em massa sem senha",
  theme: "tema",
  density: "densidade",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compara dois objetos de configuração e devolve as diferenças reais. */
function diffSettings(
  prev: unknown,
  next: unknown,
  section: string,
  path: string[] = [],
  out: SettingChange[] = [],
  depth = 0,
): SettingChange[] {
  if (isPlainObject(prev) && isPlainObject(next) && depth < 3) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
      if (SETTINGS_IGNORED.has(key) || SETTINGS_IGNORED.has([...path, key].join("."))) continue;
      diffSettings(prev[key], next[key], section, [...path, key], out, depth + 1);
    }
    return out;
  }
  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    out.push({ section, path: path.join("."), from: prev, to: next });
  }
  return out;
}

function formatSettingValue(v: unknown): string {
  if (v === undefined || v === null) return "vazio";
  if (typeof v === "boolean") return v ? "ativado" : "desativado";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim() === "" ? "vazio" : `“${v}”`;
  if (Array.isArray(v)) return v.length === 0 ? "nenhum item" : `${v.length} item(ns)`;
  return "atualizado";
}

/** "clientes.chip" → { area: "Clientes", label: "filtro rápido" } */
function describeSettingPath(section: string, path: string): { area?: string; label: string } {
  const parts = path.split(".").filter(Boolean);
  let area: string | undefined;
  if (section === "ui_state" && parts.length > 1 && AREA_LABELS[parts[0]]) {
    area = AREA_LABELS[parts[0]];
    parts.shift();
  }
  // Ignora IDs (ex.: navbar.config.<uuid>.animation.ringMs)
  const readable = parts.filter(
    (p) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(p) && !/^\d+$/.test(p),
  );
  const label = readable
    .map((p) => SETTING_KEY_LABELS[p] ?? p.replace(/([A-Z])/g, " $1").toLowerCase())
    .join(" › ");
  return { area, label: label || (SECTION_LABELS[section] ?? section).toLowerCase() };
}

/** Frase objetiva do que foi alterado nas configurações. */
/** "a, b e c" — sem cortes tipo "+1", que confundem. */
function joinList(items: string[]): string {
  const list = items.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

function describeSettingsChange(
  actorLabel: string,
  prev: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): { title: string; description?: string; changes: ActivityChange[] } {
  // `ui_state` guarda apenas estado de tela (busca, chips, paginação,
  // rascunhos, layout). Isso é navegação, não configuração — fica de fora.
  const sections = ["preferences", "rules", "security"];
  const changes: SettingChange[] = [];
  for (const s of sections) {
    diffSettings(prev?.[s], next?.[s], s, [], changes);
  }

  if (changes.length === 0) {
    return { title: `${actorLabel} salvou as configurações do sistema`, changes: [] };
  }

  const detailed: ActivityChange[] = changes.map((c) => {
    const { area, label } = describeSettingPath(c.section, c.path);
    return {
      scope: area ?? SECTION_LABELS[c.section] ?? c.section,
      label,
      from: formatSettingValue(c.from),
      to: formatSettingValue(c.to),
    };
  });

  const sectionsTouched = Array.from(new Set(changes.map((c) => c.section)));
  const areasTouched = Array.from(
    new Set(
      changes
        .map((c) => describeSettingPath(c.section, c.path).area)
        .filter((a): a is string => Boolean(a)),
    ),
  );

  const escopo =
    areasTouched.length > 0 && sectionsTouched.every((s) => s === "ui_state")
      ? joinList(areasTouched)
      : joinList(sectionsTouched.map((s) => SECTION_LABELS[s] ?? s));

  // O que exatamente mudou (nomes dos ajustes), para o título ficar autoexplicativo.
  const ajustes = Array.from(new Set(detailed.map((d) => d.label))).filter(Boolean);
  const oQue = ajustes.length === 0 ? "as configurações" : joinList(ajustes);

  const title = `${actorLabel} alterou ${oQue} em ${escopo}`;

  const detalhes = changes.slice(0, 4).map((c) => {
    const { area, label } = describeSettingPath(c.section, c.path);
    const nome = area ? `${area} · ${label}` : label;
    return `${nome}: ${formatSettingValue(c.from)} → ${formatSettingValue(c.to)}`;
  });
  if (changes.length > 4) detalhes.push(`e mais ${changes.length - 4} ajuste(s)`);

  return { title, description: detalhes.join(" · "), changes: detailed };
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
  let changes: ActivityChange[] = rowChanges(action, row.old_data, row.new_data);
  let recordLabel: string | undefined;
  let clientId: string | null = null;

  switch (row.table_name) {
    case "clients": {
      const nome = str(data.name) ?? "cliente";
      recordLabel = nome;
      title = `${actorLabel} ${verb} o cliente ${nome}`;
      description = action === "UPDATE"
        ? describeChanges(changedFields(prev, row.new_data))
        : str(data.phone);
      break;
    }
    case "products": {
      const nome = str(data.name) ?? "produto";
      recordLabel = nome;
      clientId = str(data.client_id) ?? str(prev.client_id) ?? null;
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
      recordLabel = nome;
      clientId = str(data.client_id) ?? str(prev.client_id) ?? null;
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
      recordLabel = `Parcela ${n ?? "?"}`;
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
      recordLabel = arquivo;
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
      clientId = str(data.client_id) ?? str(prev.client_id) ?? null;
      title = `${actorLabel} ${action === "INSERT" ? "gerou" : verb} uma nota fiscal`;
      description = total !== undefined ? CURRENCY.format(total / 100) : undefined;
      break;
    }
    case "team_tasks": {
      const t = str(data.title) ?? "tarefa";
      recordLabel = t;
      title = `${actorLabel} ${verb} a tarefa "${t}"`;
      description =
        action === "UPDATE"
          ? describeChanges(changedFields(prev, row.new_data))
          : str(data.status);
      break;
    }
    case "app_settings": {
      const detalhado = describeSettingsChange(
        actorLabel,
        row.old_data,
        row.new_data ?? row.old_data,
      );
      title = detalhado.title;
      description = detalhado.description;
      changes = detalhado.changes;
      recordLabel = "Configurações do sistema";
      // Se sobrou apenas ruído (ex.: digitação em campos de busca), não notifica.
      if (action === "UPDATE" && detalhado.changes.length === 0) return null;
      break;
    }
    case "saved_filters": {
      recordLabel = str(data.name);
      title = `${actorLabel} ${verb} o filtro salvo "${recordLabel ?? ""}"`;
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
    changes,
    clientId,
    clientLabel: str(data.client_name) ?? undefined,
    entity: {
      table: row.table_name,
      tableLabel: TABLE_LABELS[row.table_name] ?? row.table_name,
      rowId: row.row_id,
      recordLabel,
      action: (action as ActivityEntity["action"]) ?? "UPDATE",
    },
  };
}

const LOCAL_CATEGORY: Record<AppLocalEvent["category"], ActivityCategory> = {
  backup: "backup",
  sandbox: "sistema",
  local: "sistema",
  sistema: "sistema",
  importacao: "importacao",
  github: "sistema",
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
  const clientNamesRef = useRef<Map<string, string>>(new Map());
  const clientTriedRef = useRef<Set<string>>(new Set());
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

  // Realtime do audit_log desativado (MVP): a atividade é carregada sob
  // demanda com o botão de atualizar, reduzindo consultas ao banco.
  useEffect(() => {
    setLive(false);
    return () => {
      if (flushRef.current) clearTimeout(flushRef.current);
      flushRef.current = null;
    };
  }, []);

  // Presença: quem está com sessão ativa.
  // A leitura passa pela função `list_online_users` (já restrita a usuários
  // internos) em vez da tabela: `active_sessions` não é mais lida em massa
  // nem transmitida em tempo real para todo mundo.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.rpc("list_online_users", {
        _window_seconds: 300,
      });
      if (!alive) return;
      const seen = new Set<string>();
      const list: OnlineUser[] = [];
      for (const s of data ?? []) {
        if (seen.has(s.user_id)) continue;
        seen.add(s.user_id);
        list.push({
          userId: s.user_id,
          label:
            s.display_name?.trim() ||
            namesRef.current.get(s.user_id) ||
            "Usuário",
          lastSeen: s.last_seen,
        });
      }
      setOnline(list);
    };
    void load();
    const interval = setInterval(() => void load(), 120_000);
    return () => {
      alive = false;
      clearInterval(interval);
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

  // Resolve o nome do cliente vinculado (produto, nota fiscal, acordo) para
  // que ele apareça na mesma linha do evento.
  useEffect(() => {
    const pending = Array.from(
      new Set(
        events
          .filter((e) => e.clientId && !e.clientLabel)
          .map((e) => e.clientId as string)
          .filter((id) => !clientTriedRef.current.has(id)),
      ),
    );
    if (pending.length === 0) return;
    pending.forEach((id) => clientTriedRef.current.add(id));
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, phone")
        .in("id", pending.slice(0, 200));
      if (!alive) return;
      for (const c of data ?? []) {
        clientNamesRef.current.set(
          c.id,
          c.phone ? `${c.name} (${c.phone})` : c.name,
        );
      }
      setEvents((prev) =>
        prev.map((e) =>
          e.clientId && !e.clientLabel && clientNamesRef.current.has(e.clientId)
            ? { ...e, clientLabel: clientNamesRef.current.get(e.clientId)! }
            : e,
        ),
      );
    })();
    return () => {
      alive = false;
    };
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

// ---------------------------------------------------------------------------
// Agrupamento em lote (importações e ações em massa)
// ---------------------------------------------------------------------------

export interface ActivityBatch {
  kind: "batch";
  id: string;
  at: string;
  actorId?: string | null;
  actorLabel: string;
  category: ActivityCategory;
  table: string;
  tableLabel: string;
  action: ActivityEntity["action"];
  title: string;
  events: ActivityEvent[];
}

export type ActivityGroup =
  | { kind: "single"; id: string; at: string; event: ActivityEvent }
  | ActivityBatch;

const PLURAL: Record<string, string> = {
  Cliente: "clientes",
  Produto: "produtos",
  "Acordo MGMV": "acordos MGMV",
  "Parcela MGMV": "parcelas MGMV",
  "Nota fiscal": "notas fiscais",
  Tarefa: "tarefas",
  "Filtro salvo": "filtros salvos",
  Backup: "backups",
  Importação: "importações",
};

const BATCH_VERB: Record<ActivityEntity["action"], string> = {
  INSERT: "adicionou",
  UPDATE: "atualizou",
  DELETE: "removeu",
};

/**
 * Junta ações consecutivas da mesma pessoa, na mesma tabela e com a mesma
 * operação dentro de uma janela curta — típico de importações e edições em
 * massa — em um único card expansível.
 */
export function groupActivityEvents(
  events: ActivityEvent[],
  opts: { enabled?: boolean; windowMs?: number; minSize?: number } = {},
): ActivityGroup[] {
  const { enabled = true, windowMs = 120_000, minSize = 3 } = opts;
  const single = (e: ActivityEvent): ActivityGroup => ({
    kind: "single",
    id: e.id,
    at: e.at,
    event: e,
  });
  if (!enabled) return events.map(single);

  const out: ActivityGroup[] = [];
  let run: ActivityEvent[] = [];

  const key = (e: ActivityEvent) =>
    e.entity ? `${e.actorId ?? "?"}|${e.entity.table}|${e.entity.action}` : null;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length < minSize || !run[0].entity) {
      run.forEach((e) => out.push(single(e)));
      run = [];
      return;
    }
    const first = run[0];
    const entity = first.entity!;
    const label = PLURAL[entity.tableLabel] ?? `${entity.tableLabel.toLowerCase()}s`;
    const clientes = new Set(
      run.map((e) => e.clientLabel).filter((c): c is string => Boolean(c)),
    );
    const sufixo =
      clientes.size === 1
        ? ` do cliente ${[...clientes][0]}`
        : clientes.size > 1
          ? ` de ${clientes.size} clientes`
          : "";
    out.push({
      kind: "batch",
      id: `batch:${first.id}:${run.length}`,
      at: first.at,
      actorId: first.actorId,
      actorLabel: first.actorLabel,
      category: first.category,
      table: entity.table,
      tableLabel: entity.tableLabel,
      action: entity.action,
      title: `${first.actorLabel} ${BATCH_VERB[entity.action]} ${run.length} ${label}${sufixo}`,
      events: [...run],
    });
    run = [];
  };

  for (const e of events) {
    const k = key(e);
    if (!k) {
      flush();
      out.push(single(e));
      continue;
    }
    const last = run[run.length - 1];
    if (
      last &&
      key(last) === k &&
      Math.abs(+new Date(last.at) - +new Date(e.at)) <= windowMs
    ) {
      run.push(e);
    } else {
      flush();
      run = [e];
    }
  }
  flush();
  return out;
}
