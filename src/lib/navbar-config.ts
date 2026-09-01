import { useCallback, useMemo } from "react";
import {
  CircleDollarSign,
  Upload,
  Settings,
  Bell,
  Search,
  Sun,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { usePersistedState } from "./use-persisted-state";
import { usePermissions } from "./use-permissions";
import type { AppPermission } from "./permissions.functions";

/**
 * Catálogo dos ícones do lado direito da navbar.
 * Apenas estes podem ser reordenados/ocultados — os links de seção
 * (Dashboard, Clientes, Equipe, MGMV, Collection) ficam fixos.
 */
export type NavbarIconId =
  | "search"
  | "finance"
  | "import"
  | "settings"
  | "notifications"
  | "theme";

export interface NavbarIconMeta {
  id: NavbarIconId;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Permissão exigida; se ausente, o ícone fica visível para todos. */
  permission?: AppPermission;
  /** Ícones críticos que o usuário NÃO pode ocultar. */
  locked?: boolean;
}

export const NAVBAR_ICON_CATALOG: NavbarIconMeta[] = [
  { id: "search", label: "Buscar", description: "Busca global por cliente, telefone ou produto.", icon: Search },
  { id: "finance", label: "Finanças", description: "Abre o dashboard financeiro.", icon: CircleDollarSign, permission: "finance.view" },
  { id: "import", label: "Importar", description: "Abre o painel de importação.", icon: Upload, permission: "import.use" },
  { id: "settings", label: "Configurações", description: "Preferências, regras e zona de perigo.", icon: Settings, permission: "settings.view" },
  { id: "notifications", label: "Notificações", description: "Alertas e avisos da operação.", icon: Bell },
  { id: "theme", label: "Tema", description: "Alterna entre modo claro e escuro.", icon: Sun, locked: true },
];

export const DEFAULT_NAVBAR_ORDER: NavbarIconId[] = NAVBAR_ICON_CATALOG.map(
  (i) => i.id,
);

export interface NavbarAnimationConfig {
  /** Duração da transição compact↔full (ms). */
  hoverMs: number;
  /** Duração do pulse-out de saída (ms). */
  leaveMs: number;
  /** Período do runner do anel de progresso (ms). */
  ringMs: number;
  /** Desativa todas as animações da navbar. */
  disabled: boolean;
}

export const DEFAULT_NAVBAR_ANIMATION: NavbarAnimationConfig = {
  hoverMs: 700,
  leaveMs: 3000,
  ringMs: 2400,
  disabled: false,
};

export interface NavbarConfig {
  order: NavbarIconId[];
  hidden: NavbarIconId[];
  animation: NavbarAnimationConfig;
}

const DEFAULT_CONFIG: NavbarConfig = {
  order: DEFAULT_NAVBAR_ORDER,
  hidden: [],
  animation: DEFAULT_NAVBAR_ANIMATION,
};

function sanitize(cfg: NavbarConfig | undefined | null): NavbarConfig {
  const safe = cfg ?? DEFAULT_CONFIG;
  const known = new Set<NavbarIconId>(DEFAULT_NAVBAR_ORDER);
  const seen = new Set<NavbarIconId>();
  const order: NavbarIconId[] = [];
  for (const id of safe.order ?? []) {
    if (known.has(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of DEFAULT_NAVBAR_ORDER) {
    if (!seen.has(id)) order.push(id);
  }
  const lockedIds = new Set(
    NAVBAR_ICON_CATALOG.filter((i) => i.locked).map((i) => i.id),
  );
  const hidden = (safe.hidden ?? []).filter(
    (id) => known.has(id) && !lockedIds.has(id),
  );
  const anim = safe.animation ?? DEFAULT_NAVBAR_ANIMATION;
  const animation: NavbarAnimationConfig = {
    hoverMs: clamp(anim.hoverMs ?? 700, 100, 2000),
    leaveMs: clamp(anim.leaveMs ?? 3000, 200, 6000),
    ringMs: clamp(anim.ringMs ?? 2400, 600, 6000),
    disabled: Boolean(anim.disabled),
  };
  return { order, hidden, animation };
}

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Hook de configuração da navbar — persistida em `app_settings.ui_state`
 * namespaceada por user id (efetivamente por usuário).
 */
export function useNavbarConfig() {
  const { access, hasPermission } = usePermissions();
  const key = `navbar.config.${access?.userId ?? "anon"}`;
  const [raw, setRaw] = usePersistedState<NavbarConfig>(key, DEFAULT_CONFIG);
  const config = useMemo(() => sanitize(raw), [raw]);

  const setOrder = useCallback(
    (next: NavbarIconId[]) => setRaw((c) => sanitize({ ...sanitize(c), order: next })),
    [setRaw],
  );
  const toggleHidden = useCallback(
    (id: NavbarIconId) =>
      setRaw((c) => {
        const cur = sanitize(c);
        const has = cur.hidden.includes(id);
        return sanitize({
          ...cur,
          hidden: has ? cur.hidden.filter((x) => x !== id) : [...cur.hidden, id],
        });
      }),
    [setRaw],
  );
  const setAnimation = useCallback(
    (patch: Partial<NavbarAnimationConfig>) =>
      setRaw((c) => {
        const cur = sanitize(c);
        return sanitize({ ...cur, animation: { ...cur.animation, ...patch } });
      }),
    [setRaw],
  );
  const reset = useCallback(() => setRaw(DEFAULT_CONFIG), [setRaw]);

  /** Itens efetivamente visíveis (ordem do usuário, sem ocultos, sem sem-permissão). */
  const visibleIds = useMemo(() => {
    const hidden = new Set(config.hidden);
    return config.order.filter((id) => {
      if (hidden.has(id)) return false;
      const meta = NAVBAR_ICON_CATALOG.find((m) => m.id === id);
      if (!meta) return false;
      if (meta.permission && !hasPermission(meta.permission)) return false;
      return true;
    });
  }, [config, hasPermission]);

  /** Lista completa para a UI de configuração (inclui sem-permissão para filtrar). */
  const allowedCatalog = useMemo(
    () =>
      NAVBAR_ICON_CATALOG.filter(
        (m) => !m.permission || hasPermission(m.permission),
      ),
    [hasPermission],
  );

  return {
    config,
    visibleIds,
    allowedCatalog,
    setOrder,
    toggleHidden,
    setAnimation,
    reset,
  };
}

export function getIconMeta(id: NavbarIconId): NavbarIconMeta | undefined {
  return NAVBAR_ICON_CATALOG.find((m) => m.id === id);
}