import { Outlet } from "@tanstack/react-router";
import {
  Search,
  Menu,
  Sun,
  Moon,
  User,
  Package,
  Upload,
  Settings,
  Bell,
  LayoutDashboard,
  Users,
  Sparkles,
  Wallet,
  CircleDollarSign,
  KanbanSquare,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, lazy, memo, Suspense, type ReactNode } from "react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import {
  useStore,
  isOpenSituation,
  isOverdue,
  isResolvedSituation,
  getMGMVDisplay,
  formatBRL,
  type Client,
  type Product,
} from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { setUiValue } from "@/lib/db-sync";
import { HydrationSplash, useHydrationUserName } from "@/components/hydration-splash";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfiguracoesSection } from "@/sections/configuracoes-section";
import { NotificationsPanel } from "@/components/notifications-panel";
import { useNotifications } from "@/lib/notifications";
import { HelpCenter } from "@/components/help-center";
import { TutorialRunner } from "@/components/tutorial-runner";
import { ConciergeModal } from "@/components/concierge-modal";
import { FloatingConcierge } from "@/components/floating-concierge";
import { FinanceDashboard } from "@/components/finance-dashboard";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";
import { useNavbarConfig, getIconMeta, type NavbarIconId } from "@/lib/navbar-config";
import { scrollToSection } from "@/lib/scroll-to-section";

const ImportSection = lazy(() =>
  import("@/sections/import-section").then((m) => ({ default: m.ImportSection })),
);
const EquipeSection = lazy(() =>
  import("@/sections/equipe-section").then((m) => ({ default: m.EquipeSection })),
);

const navItems: ReadonlyArray<{
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "mgmv", label: "MGMV", icon: Sparkles },
  { id: "collection", label: "Collection", icon: Wallet },
];

// Status geral do cliente para a busca global. Mesmas regras da tabela de
// Clientes (`generalStatus`), replicadas aqui para não acoplar app-layout ao
// arquivo pesado da seção. Inclui variação "Reserva" (não vencida) → amarelo.
function clientSearchStatus(
  client: Client,
  products: Product[],
): "Em dia" | "Pendente" | "Reserva vencida" | "Reserva" | "Pago ag. envio" | "MGMV" | "Enviado" | "Sem produtos" {
  const ps = products.filter((p) => p.clientId === client.id);
  if (
    ps.some(
      (p) => p.financialStatus === "Reserva" && isOpenSituation(p) && isOverdue(p.dueDate),
    )
  )
    return "Reserva vencida";
  if (ps.some((p) => p.financialStatus === "Pendente" && isOpenSituation(p)))
    return "Pendente";
  if (client.mgmv && client.mgmv.installments.some((i) => !i.paid)) return "MGMV";
  if (ps.some((p) => p.financialStatus === "Pago" && isOpenSituation(p)))
    return "Pago ag. envio";
  if (ps.some((p) => p.financialStatus === "Reserva" && isOpenSituation(p)))
    return "Reserva";
  if (ps.some((p) => isResolvedSituation(p) && p.financialStatus !== "MGMV"))
    return "Enviado";
  if (ps.length === 0) return "Sem produtos";
  return "Em dia";
}

function statusBorderClass(label: string): string {
  switch (label) {
    case "Em dia":
      return "border-l-blue-500";
    case "Pendente":
      return "border-l-red-500";
    case "Reserva":
    case "Reserva vencida":
      return "border-l-yellow-500";
    case "Pago ag. envio":
      return "border-l-green-500";
    default:
      return "border-l-transparent";
  }
}

function SearchBox({
  className,
  inputRef,
  onFocusChange,
}: {
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onFocusChange?: (focused: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);
  const listboxId = "global-search-listbox";
  const optionId = (idx: number) => `${listboxId}-opt-${idx}`;

  // A busca da navbar é global: espelhamos o termo em TODAS as chaves de
  // busca das seções (clientes / MGMV / cobranças) para que, ao rolar até
  // qualquer uma delas, a lista já apareça filtrada pelo mesmo termo — em
  // vez de manter uma busca isolada por seção.
  useEffect(() => {
    setUiValue("clientes.search", query);
    setUiValue("mgmv.search", query);
    setUiValue("collection.search", query);
  }, [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounce do termo de busca para evitar reprocessar a cada tecla em listas
  // grandes. Limpa o timer no unmount para não vazar callbacks.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => window.clearTimeout(id);
  }, [query]);

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q)
      return [] as Array<
        | { type: "client"; id: string; title: string; subtitle: string; statusLabel: string }
        | {
            type: "agreement";
            id: string;
            clientId: string;
            title: string;
            subtitle: string;
            statusLabel: string;
          }
      >;
    const digits = q.replace(/\D/g, "");
    const clientMatches = clients
      .filter((c) => {
        const inName = c.name.toLowerCase().includes(q);
        const inPhone = digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits);
        return inName || inPhone;
      })
      .slice(0, 6)
      .map((c) => ({
        type: "client" as const,
        id: c.id,
        title: c.name,
        subtitle: c.phone,
        statusLabel: clientSearchStatus(c, products),
      }));
    const agreementMatches = clients
      .filter((c) => {
        if (!c.mgmv) return false;
        const inName = c.name.toLowerCase().includes(q);
        const inPhone = digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits);
        return inName || inPhone;
      })
      .slice(0, 6)
      .map((c) => {
        const display = getMGMVDisplay(c);
        const subtitle = display
          ? `${display.installmentsPaid}/${display.installmentsTotal} parcelas · ${formatBRL(display.remainingBalance)} restante`
          : "Acordo MGMV";
        return {
          type: "agreement" as const,
          id: c.id,
          clientId: c.id,
          title: `Acordo MGMV — ${c.name}`,
          subtitle,
          statusLabel: clientSearchStatus(c, products),
        };
      });
    return [...clientMatches, ...agreementMatches];
  }, [debouncedQuery, clients, products]);

  useEffect(() => {
    setActive(0);
  }, [debouncedQuery]);

  const handleSelect = (item: (typeof results)[number]) => {
    const clientId = item.type === "client" ? item.id : item.clientId;
    openClient(clientId);
    scrollToSection("clientes");
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        ref={inputRef}
        value={query}
        role="combobox"
        aria-expanded={open && !!query.trim()}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results.length > 0 ? optionId(active) : undefined
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          onFocusChange?.(true);
          if (query) setOpen(true);
        }}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            handleSelect(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Buscar cliente ou acordo..."
        className="h-9 w-full rounded-full border border-border bg-background/60 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary/40 focus:bg-background"
      />
      {open && query.trim() && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Resultados da busca"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-80 overflow-auto rounded-2xl border border-border bg-popover/95 p-1 shadow-xl backdrop-blur"
        >
          {debouncedQuery !== query.trim() && results.length === 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground"
            >
              <Search className="size-4 animate-pulse" />
              <span>Buscando...</span>
            </div>
          ) : results.length === 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center"
            >
              <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <Search className="size-5" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Nenhum resultado para “{query.trim()}”
              </p>
              <p className="text-xs text-muted-foreground">
                Tente outro nome, telefone ou acordo.
              </p>
            </div>
          ) : (
            results.map((item, idx) => (
              <button
                key={`${item.type}-${item.id}`}
                id={optionId(idx)}
                role="option"
                aria-selected={idx === active}
                onMouseEnter={() => setActive(idx)}
                onClick={() => handleSelect(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border-l-4 px-3 py-2 text-left transition-colors",
                  statusBorderClass(item.statusLabel),
                  idx === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  {item.type === "client" ? (
                    <User className="size-4" />
                  ) : (
                    <Package className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {item.statusLabel}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NotificationsDropdown({
  children,
  className,
  align = "end",
  open,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  open: boolean;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const wrap = wrapRef.current;
      // Existem duas instâncias deste dropdown na árvore (desktop e
      // mobile), mas só uma está realmente visível conforme o
      // breakpoint. A instância oculta (display:none via md:hidden)
      // não deve reagir ao clique — caso contrário ela fecha o painel
      // visível assim que o usuário toca em qualquer botão dentro dele.
      if (!wrap || wrap.getClientRects().length === 0) return;
      const target = e.target as Node | null;
      if (wrap.contains(target)) return;
      // Cliques na barra de rolagem nativa disparam mousedown com target
      // no <html>/<body> — nesse caso, checar as coordenadas contra o
      // retângulo do painel para não fechar ao arrastar a scrollbar.
      const panel = panelRef.current;
      if (panel) {
        const r = panel.getBoundingClientRect();
        // Inclui a área da scrollbar (até ~16px à direita do conteúdo).
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right + 16 &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          return;
        }
      }
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      {children}
      {open && (
        <div
          ref={panelRef}
          className={cn(
            "absolute top-[calc(100%+8px)] z-50 max-h-[min(70vh,420px)] w-[380px] max-w-[calc(100vw-32px)] overflow-auto rounded-2xl border border-border bg-popover/95 p-3 shadow-xl backdrop-blur",
            align === "end" && "right-0",
            align === "start" && "left-0",
            align === "center" && "left-1/2 -translate-x-1/2",
          )}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <NotificationsPanel onOpenClient={onClose} />
        </div>
      )}
    </div>
  );
}

function NavLinkImpl({
  id,
  label,
  active,
  onClick,
  compact,
  Icon,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
  compact: boolean;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  const anchor = (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      aria-label={label}
      title={compact ? label : undefined}
      className={cn(
        // Anima apenas propriedades baratas (transform/colors/shadow) para
        // evitar reflow durante o scroll. `will-change-transform` deixa o
        // compositor reservar uma camada, eliminando travadas no hover.
        "flex items-center gap-2 rounded-full text-sm font-medium will-change-transform transition-[transform,background-color,color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:scale-95",
        compact ? "size-10 justify-center px-0 py-0" : "px-4 py-2",
        active
          ? "bg-primary text-primary-foreground shadow-sm scale-[1.08] hover:-translate-y-0"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shrink-0",
          compact ? "size-5" : "size-4 opacity-90",
        )}
      />
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out",
          compact ? "max-w-0 opacity-0" : "max-w-[140px] opacity-100",
        )}
      >
        {label}
      </span>
    </a>
  );
  if (!compact) return anchor;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{anchor}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
const NavLink = memo(NavLinkImpl);

function FloatingNavbar() {
  // placeholder for ordering — actual definition below
  return _FloatingNavbarImpl();
}

function InlineSearch({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        // delegate to parent — parent owns the open state
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div
      ref={wrapRef}
      data-tour="global-search"
      className={cn(
        "hidden md:flex items-center h-10 rounded-full transition-[width,background-color,box-shadow] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
        open
          ? "w-[260px] bg-background border border-border shadow-sm overflow-visible"
          : "w-10 bg-transparent border border-transparent overflow-hidden",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? "Fechar busca" : "Buscar"}
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors",
          !open && "hover:bg-foreground/10 hover:text-foreground",
          open && "text-foreground",
        )}
      >
        <Search className="size-5" />
      </button>
      <div
        className={cn(
          "min-w-0 flex-1 transition-opacity duration-300",
          open ? "opacity-100 delay-150" : "opacity-0 pointer-events-none",
        )}
      >
        {open && (
          <SearchBox
            inputRef={inputRef}
            className="[&_input]:h-10 [&_input]:border-0 [&_input]:bg-transparent [&_input]:pl-1 [&_input]:pr-3 [&_input]:rounded-none [&_input]:focus:bg-transparent [&>svg]:hidden"
          />
        )}
      </div>
    </div>
  );
}

interface RightNavIconProps {
  id: NavbarIconId;
  isDark: boolean;
  unreadCount: number;
  searchOpen: boolean;
  onSearch: () => void;
  onFinance: () => void;
  onEquipe: () => void;
  onImport: () => void;
  onSettings: () => void;
  onToggleTheme: () => void;
}

function RightNavIconImpl({
  id,
  isDark,
  unreadCount,
  searchOpen,
  onSearch,
  onFinance,
  onEquipe,
  onImport,
  onSettings,
  onToggleTheme,
}: RightNavIconProps) {
  const baseBtn =
    "group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90";
  const openNotifications = useUiStore((s) => s.openNotifications);
  const closeNotifications = useUiStore((s) => s.closeNotifications);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  switch (id) {
    case "search":
      return <InlineSearch open={searchOpen} onToggle={onSearch} />;
    case "finance":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onFinance}
              aria-label="Finanças"
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-success/15 hover:text-success active:scale-90"
            >
              <CircleDollarSign className="size-5 transition-transform duration-300 group-hover:scale-110" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Finanças</TooltipContent>
        </Tooltip>
      );
    case "equipe":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onEquipe}
              aria-label="Equipe"
              className={baseBtn}
            >
              <KanbanSquare className="size-5 transition-transform duration-300 group-hover:scale-110" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Equipe</TooltipContent>
        </Tooltip>
      );
    case "import":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onImport}
              data-tour="upload-button"
              aria-label="Importar dados"
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary"
            >
              <Upload className="size-5 transition-transform group-hover:-translate-y-0.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Importar</TooltipContent>
        </Tooltip>
      );
    case "settings":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onSettings}
              data-tour="settings-button"
              aria-label="Configurações"
              className={baseBtn}
            >
              <Settings className="size-5 transition-transform duration-300 group-hover:rotate-90" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Configurações</TooltipContent>
        </Tooltip>
      );
    case "notifications":
      return (
        <NotificationsDropdown
          open={notificationsOpen}
          onClose={closeNotifications}
          align="end"
          className="hidden md:block"
        >
          <button
            type="button"
            onClick={openNotifications}
            aria-label="Notificações"
            className={cn(baseBtn, "relative")}
          >
            <Bell className="size-5 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
            {unreadCount > 0 && (
              <>
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary animate-pulse" />
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] h-4 px-1 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-sm animate-in zoom-in-75 duration-200">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              </>
            )}
          </button>
        </NotificationsDropdown>
      );
    case "theme":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleTheme}
              aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
            >
              <span
                key={isDark ? "sun" : "moon"}
                className="inline-flex animate-in fade-in zoom-in-75 duration-300 group-hover:rotate-12 transition-transform"
              >
                {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{isDark ? "Modo claro" : "Modo escuro"}</TooltipContent>
        </Tooltip>
      );
  }
}
const RightNavIcon = memo(RightNavIconImpl);

function _FloatingNavbarImpl() {
  const [openMobile, setOpenMobile] = useState(false);
  const activeSection = useUiStore((s) => s.activeSection);
  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [navHover, setNavHover] = useState(false);
  const [navProgress, setNavProgress] = useState<"false" | "loop" | "leaving">("false");
  const [navDimmed, setNavDimmed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [navSize, setNavSize] = useState({ width: 0, height: 0 });
  const [navBottom, setNavBottom] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const navExitTimerRef = useRef<number | null>(null);
  const navBorderPath = useMemo(() => {
    // Desenha o path exatamente sobre a borda do pill da navbar.
    // Inset = metade da stroke-width (2px), então 1px de cada lado.
    const inset = 1;
    const width = Math.max(navSize.width - inset * 2, 0);
    const height = Math.max(navSize.height - inset * 2, 0);
    const radius = Math.max(height / 2, 0);
    if (!width || !height) return "";
    return [
      `M ${inset + radius} ${inset}`,
      `H ${inset + width - radius}`,
      `A ${radius} ${radius} 0 0 1 ${inset + width} ${inset + radius}`,
      `V ${inset + height - radius}`,
      `A ${radius} ${radius} 0 0 1 ${inset + width - radius} ${inset + height}`,
      `H ${inset + radius}`,
      `A ${radius} ${radius} 0 0 1 ${inset} ${inset + height - radius}`,
      `V ${inset + radius}`,
      `A ${radius} ${radius} 0 0 1 ${inset + radius} ${inset}`,
      "Z",
    ].join(" ");
  }, [navSize.height, navSize.width]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const rect = nav.getBoundingClientRect();
      const { width, height } = rect;
      setNavSize({ width, height });
      setNavBottom(rect.bottom);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [searchOpen]);

  // Close mobile menu on outside click / ESC / page scroll.
  useEffect(() => {
    if (!openMobile) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (navRef.current?.contains(t)) return;
      if (mobileMenuRef.current?.contains(t)) return;
      setOpenMobile(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMobile(false);
    };
    const container = document.querySelector<HTMLElement>(".page-container");
    const onScroll = () => setOpenMobile(false);
    const onResize = () => setOpenMobile(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    container?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [openMobile]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = stored ? stored === "dark" : prefersDark;
    document.documentElement.classList.toggle("dark", dark);
    setIsDark(dark);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setIsDark(next);
  };

  const openImport = useUiStore((s) => s.openImport);
  const openEquipe = useUiStore((s) => s.openEquipe);
  const openSettings = useUiStore((s) => s.openSettings);
  const openNotifications = useUiStore((s) => s.openNotifications);
  const closeNotifications = useUiStore((s) => s.closeNotifications);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  const openConcierge = useUiStore((s) => s.openConcierge);
  const openFinance = useUiStore((s) => s.openFinance);
  const { unreadCount } = useNotifications();
  const { visibleIds, config: navbarCfg } = useNavbarConfig();

  useEffect(() => {
    const clearNavExitTimer = () => {
      if (navExitTimerRef.current) {
        window.clearTimeout(navExitTimerRef.current);
        navExitTimerRef.current = null;
      }
    };

    if (navHover || openMobile) {
      clearNavExitTimer();
      setNavDimmed(false);
      setNavProgress("loop");
      return clearNavExitTimer;
    }

    if (!scrolled) {
      clearNavExitTimer();
      setNavDimmed(false);
      setNavProgress("false");
      return clearNavExitTimer;
    }

    setNavDimmed(false);
    setNavProgress("leaving");
    clearNavExitTimer();
    navExitTimerRef.current = window.setTimeout(() => {
      setNavProgress("false");
      setNavDimmed(true);
      navExitTimerRef.current = null;
    }, navbarCfg.animation.leaveMs);

    return clearNavExitTimer;
  }, [navHover, openMobile, scrolled, navbarCfg.animation.leaveMs]);

  useEffect(() => {
    return () => {
      if (navExitTimerRef.current) window.clearTimeout(navExitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".page-container");
    if (!container) return;

    // Debounce de troca de seção: evita "tremor" da navbar quando o
    // usuário rola muito rápido. A última seção dominante vence após o
    // pequeno intervalo abaixo.
    let pendingId: string | null = null;
    let debounceTimer: number | null = null;
    const flushActive = () => {
      if (pendingId) setActiveSection(pendingId);
      pendingId = null;
      debounceTimer = null;
    };
    const queueActive = (id: string) => {
      pendingId = id;
      if (debounceTimer != null) return;
      debounceTimer = window.setTimeout(flushActive, 90);
    };

    let sectionObserver: IntersectionObserver | null = null;
    const observed = new WeakSet<Element>();
    const observeAll = () => {
      if (!sectionObserver) return;
      for (const item of navItems) {
        const el = document.getElementById(item.id);
        if (el && !observed.has(el)) {
          observed.add(el);
          sectionObserver.observe(el);
        }
      }
    };
    const buildObserver = () => {
      if (sectionObserver) sectionObserver.disconnect();
      // Limpa o set para reobservar todas as seções com os novos limites.
      for (const item of navItems) {
        const el = document.getElementById(item.id);
        if (el) observed.delete(el);
      }
      sectionObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (visible?.target.id) queueActive(visible.target.id);
        },
        {
          root: container,
          rootMargin: "-45% 0px -45% 0px",
          threshold: [0, 1],
        },
      );
      observeAll();
    };
    buildObserver();

    let scheduled = false;
    const mo = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        observeAll();
      });
    });
    // Só nos importam mudanças diretas na lista de seções (wrappers de
    // seção são filhos diretos do container). subtree:false evita
    // recalcular a cada mutação interna de qualquer section (listas,
    // formulários, digitação em MGMV, etc.).
    mo.observe(container, { childList: true, subtree: false });

    // Resize / orientationchange: recalcula limites do observer (o
    // rootMargin é em % da altura da viewport, então mudou de tamanho).
    let resizeTimer: number | null = null;
    const onResize = () => {
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(buildObserver, 120);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText =
      "position:absolute;top:0;left:0;width:1px;height:32px;pointer-events:none;";
    container.prepend(sentinel);
    const scrollObserver = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { root: container, threshold: 0 },
    );
    scrollObserver.observe(sentinel);

    return () => {
      sectionObserver?.disconnect();
      scrollObserver.disconnect();
      mo.disconnect();
      sentinel.remove();
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // Navbar is always compact on desktop; hovering triggers a looping conic glow.
  const isCompact = true;

  // Restauração de scroll: salva a posição do .page-container em
  // sessionStorage e restaura no mount (sem saltos visíveis: usa "auto"
  // antes do paint via rAF).
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".page-container");
    if (!container) return;
    const KEY = "app:scrollY";
    const ACTIVE_KEY = "app:activeSection";
    // Restaurar antes do primeiro paint.
    const savedY = Number(sessionStorage.getItem(KEY) ?? "0");
    const savedActive = sessionStorage.getItem(ACTIVE_KEY);
    if (savedActive) setActiveSection(savedActive);
    if (savedY > 0) {
      requestAnimationFrame(() => {
        container.scrollTo({ top: savedY, behavior: "auto" });
      });
    }
    // Persistimos o scroll apenas em eventos discretos (troca de aba,
    // saída da página) em vez de a cada frame de rolagem.
    const persist = () => sessionStorage.setItem(KEY, String(container.scrollTop));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, []);

  // Persiste a seção ativa para restaurar entre reloads.
  useEffect(() => {
    if (activeSection) sessionStorage.setItem("app:activeSection", activeSection);
  }, [activeSection]);

  return (
    <TooltipProvider delayDuration={150}>
      <nav
        ref={navRef}
        data-tour="navbar"
        data-mode={isCompact ? "compact" : "full"}
        data-progress={navProgress}
        data-scrolled={scrolled ? "true" : "false"}
        data-dimmed={navDimmed ? "true" : "false"}
        data-anim={navbarCfg.animation.disabled ? "off" : "on"}
        data-search={searchOpen ? "open" : "closed"}
        style={{
          ["--nav-anim-hover" as string]: `${navbarCfg.animation.hoverMs}ms`,
          ["--nav-anim-leave" as string]: `${navbarCfg.animation.leaveMs}ms`,
          ["--nav-anim-ring" as string]: `${navbarCfg.animation.ringMs}ms`,
        }}
        onMouseEnter={() => setNavHover(true)}
        onMouseLeave={() => setNavHover(false)}
        onPointerEnter={() => setNavHover(true)}
        onPointerLeave={() => setNavHover(false)}
        className={cn(
          "floating-navbar flex items-center gap-3 px-3 py-2 md:px-4",
          "h-[60px] md:h-[60px]",
          isCompact && "md:gap-2 md:py-2 md:px-3",
        )}
      >
        {/* Looping border highlight on the navbar container border itself */}
        {navBorderPath && (
          <svg
            aria-hidden
            className="nav-progress-ring pointer-events-none absolute inset-0 block h-full w-full overflow-visible"
            viewBox={`0 0 ${navSize.width} ${navSize.height}`}
            preserveAspectRatio="none"
          >
            <path className="nav-progress-track" d={navBorderPath} pathLength={100} />
            <path className="nav-progress-runner" d={navBorderPath} pathLength={100} />
          </svg>
        )}
        <button
          type="button"
          onClick={openConcierge}
          aria-label="Abrir Concierge Operacional"
          title="Concierge Operacional"
          className="group relative flex items-center gap-2 pl-2 pr-1 transition-transform duration-300 hover:-translate-y-0.5 active:scale-95"
        >
          <span className="relative grid size-11 place-items-center shrink-0">
            {/* fade glow behind mascot */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-[-6px] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--color-primary)_45%,transparent)_0%,transparent_70%)] blur-md opacity-70 transition-opacity duration-[800ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:opacity-100"
            />
            <img
              src={mascotAsset.url}
              alt=""
              draggable={false}
              className="relative size-11 rounded-full object-cover ring-1 ring-primary/30 shadow-md transition-all duration-[800ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:shadow-lg group-hover:rotate-6 group-hover:scale-110"
            />
          </span>
          <div
            className={cn(
              "hidden lg:block leading-tight transition-all duration-[700ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 overflow-hidden",
              isCompact ? "max-w-0 opacity-0" : "max-w-[180px] opacity-100",
            )}
          >
            <p className="text-sm font-semibold">Star Games</p>
            <p className="text-[10px] text-muted-foreground">Gestão Operacional</p>
          </div>
        </button>

        <div
          className={cn(
            "hidden md:flex items-center gap-1 rounded-full bg-foreground/5 transition-all duration-[700ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
            isCompact ? "p-0.5" : "p-1",
          )}
        >
          {navItems.map((i) => (
            <NavLink
              key={i.id}
              id={i.id}
              label={i.label}
              Icon={i.icon}
              active={activeSection === i.id}
              onClick={() => scrollToSection(i.id)}
              compact={isCompact}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5 md:gap-2 md:pl-2">
          {visibleIds.map((iconId) => {
            const meta = getIconMeta(iconId);
            if (!meta) return null;
            return (
              <RightNavIcon
                key={iconId}
                id={iconId}
                isDark={isDark}
                unreadCount={unreadCount}
                searchOpen={searchOpen}
                onSearch={() => {
                  setSearchOpen((v) => !v);
                }}
                onFinance={openFinance}
                onEquipe={openEquipe}
                onImport={openImport}
                onSettings={openSettings}
                onToggleTheme={toggleTheme}
              />
            );
          })}
          {/* Mobile-only quick actions */}
          <NotificationsDropdown
            open={notificationsOpen}
            onClose={closeNotifications}
            align="end"
            className="md:hidden"
          >
            <button
              type="button"
              onClick={openNotifications}
              aria-label="Notificações"
              className="md:hidden relative grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
            >
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] h-4 px-1 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-sm">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </NotificationsDropdown>
          <button
            type="button"
            onClick={openEquipe}
            aria-label="Equipe"
            className="md:hidden grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
          >
            <Users className="size-5" />
          </button>
          <button
            className="group md:hidden grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 active:scale-90"
            onClick={() => setOpenMobile((v) => !v)}
            aria-label="Menu"
            aria-expanded={openMobile}
            aria-controls="mobile-nav-menu"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </nav>
      {openMobile && (
        <div
          id="mobile-nav-menu"
          role="menu"
          ref={mobileMenuRef}
          style={{ top: `${navBottom + 8}px` }}
          className="fixed right-4 z-[60] w-[260px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-popover/95 backdrop-blur-xl shadow-xl ring-1 ring-foreground/5 md:hidden p-1.5 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {navItems.map((i) => {
            const Icon = i.icon;
            const active = activeSection === i.id;
            return (
              <button
                key={i.id}
                role="menuitem"
                onClick={() => {
                  setOpenMobile(false);
                  scrollToSection(i.id);
                }}
                className={cn(
                  "flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-left transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground/90 hover:bg-accent",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "opacity-70")} />
                <span className="flex-1 truncate">{i.label}</span>
              </button>
            );
          })}
          <div className="my-1.5 h-px bg-border/70" />
          <button
            role="menuitem"
            onClick={() => {
              setOpenMobile(false);
              openImport();
            }}
            className="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-left text-foreground/90 hover:bg-accent"
          >
            <Upload className="size-4 opacity-70 shrink-0" /> Importar
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpenMobile(false);
              openEquipe();
            }}
            className="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-left text-foreground/90 hover:bg-accent"
          >
            <Users className="size-4 opacity-70 shrink-0" /> Equipe
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpenMobile(false);
              openNotifications();
            }}
            className="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-left text-foreground/90 hover:bg-accent"
          >
            <Bell className="size-4 opacity-70 shrink-0" />
            <span className="flex-1">Notificações</span>
            {unreadCount > 0 && (
              <span className="grid min-w-[18px] h-[18px] px-1 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpenMobile(false);
              openSettings();
            }}
            className="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-left text-foreground/90 hover:bg-accent"
          >
            <Settings className="size-4 opacity-70 shrink-0" /> Configurações
          </button>
          <div className="my-1.5 h-px bg-border/70" />
          <button
            role="menuitem"
            onClick={() => {
              setOpenMobile(false);
              toggleTheme();
            }}
            className="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-left text-foreground/90 hover:bg-accent"
          >
            {isDark ? (
              <Sun className="size-4 opacity-70 shrink-0" />
            ) : (
              <Moon className="size-4 opacity-70 shrink-0" />
            )}
            {isDark ? "Modo claro" : "Modo escuro"}
          </button>
        </div>
      )}
    </TooltipProvider>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  const userName = useHydrationUserName();
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  // Pré-aquece os chunks lazy das seções e modais em paralelo à
  // hidratação. O splash só desmonta quando `hydrated && warm`, então ao
  // chegar na one-page as seções montam instantaneamente (sem placeholder
  // de altura e sem "salto" ao rolar).
  useEffect(() => {
    let cancelled = false;
    const prefetches: Promise<unknown>[] = [
      import("@/sections/mgmv-section"),
      import("@/sections/collection-section"),
      import("@/components/dashboard-drilldown-modal"),
      import("@/sections/import-section"),
      import("@/sections/equipe-section"),
    ];
    // Fallback: se algum chunk demorar demais (rede ruim), não trava o
    // splash — libera após 4s mesmo assim.
    const timeout = window.setTimeout(() => {
      if (!cancelled) setWarm(true);
    }, 4000);
    Promise.allSettled(prefetches).then(() => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      setWarm(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  if (!hydrated || !warm) {
    return <HydrationSplash userName={userName} />;
  }

  return (
    <div className="min-h-screen bg-background bg-gradient-to-b from-background via-background to-accent/30">
      <FloatingNavbar />
      <main className="page-container">{children ?? <Outlet />}</main>
      <GlobalModals />
      <FloatingConcierge />
    </div>
  );
}

function GlobalModals() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const closeHelp = useUiStore((s) => s.closeHelp);
  const financeOpen = useUiStore((s) => s.financeOpen);
  const closeFinance = useUiStore((s) => s.closeFinance);
  const importOpen = useUiStore((s) => s.importOpen);
  const closeImport = useUiStore((s) => s.closeImport);
  const equipeOpen = useUiStore((s) => s.equipeOpen);
  const closeEquipe = useUiStore((s) => s.closeEquipe);

  return (
    <>
      <Dialog open={settingsOpen} onOpenChange={(o) => (o ? null : closeSettings())}>
 <DialogContent data-tour="settings-modal">
          <DialogHeader className="sr-only">
            <DialogTitle>Configurações</DialogTitle>
            <DialogDescription>Preferências, regras e zona de perigo.</DialogDescription>
          </DialogHeader>
          <ConfiguracoesSection />
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={(o) => (o ? null : closeHelp())}>
 <DialogContent>
          <DialogHeader className="sr-only">
            <DialogTitle>Central de Ajuda</DialogTitle>
            <DialogDescription>Tutoriais guiados visuais.</DialogDescription>
          </DialogHeader>
          <HelpCenter />
        </DialogContent>
      </Dialog>


      <Dialog open={financeOpen} onOpenChange={(o) => (o ? null : closeFinance())}>
 <DialogContent>
          <DialogHeader className="sr-only">
            <DialogTitle>Finanças</DialogTitle>
            <DialogDescription>Dashboard financeiro consolidado.</DialogDescription>
          </DialogHeader>
          <FinanceDashboard />
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(o) => (o ? null : closeImport())}>
        <DialogContent className="max-w-[min(1200px,95vw)] max-h-[90vh] overflow-y-auto" data-tour="import-modal">
          <DialogHeader className="sr-only">
            <DialogTitle>Importar</DialogTitle>
            <DialogDescription>Importe listas, planilhas e arquivos.</DialogDescription>
          </DialogHeader>
          {importOpen && (
            <Suspense fallback={null}>
              <ImportSection onScrollTo={(id) => scrollToSection(id)} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={equipeOpen} onOpenChange={(o) => (o ? null : closeEquipe())}>
        <DialogContent className="max-w-[min(1200px,95vw)] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Equipe</DialogTitle>
            <DialogDescription>Gestão de tarefas e membros da equipe.</DialogDescription>
          </DialogHeader>
          {equipeOpen && (
            <Suspense fallback={null}>
              <EquipeSection />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>

      <TutorialRunner />
      <ConciergeModal />
    </>
  );
}
