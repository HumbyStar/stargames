import { Outlet, useNavigate } from "@tanstack/react-router";
import {
  Search,
  HelpCircle,
  Menu,
  X,
  Sun,
  Moon,
  User,
  Package,
  LogOut,
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportSection } from "@/sections/import-section";
import { ConfiguracoesSection } from "@/sections/configuracoes-section";
import { NotificationsPanel } from "@/components/notifications-panel";
import { useNotifications } from "@/lib/notifications";
import { HelpCenter } from "@/components/help-center";
import { TutorialRunner } from "@/components/tutorial-runner";
import { ConciergeModal } from "@/components/concierge-modal";
import { FloatingConcierge } from "@/components/floating-concierge";
import { FinanceDashboard } from "@/components/finance-dashboard";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";

const navItems: ReadonlyArray<{
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "equipe", label: "Equipe", icon: KanbanSquare },
  { id: "mgmv", label: "MGMV", icon: Sparkles },
  { id: "collection", label: "Collection", icon: Wallet },
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  // sempre rola a seção alvo para o topo do próprio container interno
  el.scrollTo({ top: 0, behavior: "auto" });
  el.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Array<
      | { type: "client"; id: string; title: string; subtitle: string }
      | { type: "product"; id: string; clientId: string; title: string; subtitle: string }
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
      }));
    const productMatches = products
      .filter((p) => p.name.toLowerCase().includes(q) || p.platform.toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => {
        const owner = clients.find((c) => c.id === p.clientId);
        return {
          type: "product" as const,
          id: p.id,
          clientId: p.clientId,
          title: p.name,
          subtitle: `${p.platform} · ${owner?.name ?? "Cliente"}`,
        };
      });
    return [...clientMatches, ...productMatches];
  }, [query, clients, products]);

  useEffect(() => {
    setActive(0);
  }, [query]);

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
        placeholder="Buscar cliente, telefone ou produto..."
        className="h-9 w-full rounded-full border border-border bg-background/60 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary/40 focus:bg-background"
      />
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-80 overflow-auto rounded-2xl border border-border bg-popover/95 p-1 shadow-xl backdrop-blur">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado
            </div>
          ) : (
            results.map((item, idx) => (
              <button
                key={`${item.type}-${item.id}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => handleSelect(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                  idx === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  {item.type === "client" ? <User className="size-4" /> : <Package className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {item.type === "client" ? "Cliente" : "Produto"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NavLink({
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
        "flex items-center gap-2 rounded-full text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 active:scale-95",
        compact ? "size-10 justify-center px-0 py-0" : "px-4 py-2",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "transition-all duration-[700ms] ease-[cubic-bezier(0.32,0.72,0,1)] shrink-0",
          compact ? "size-5" : "size-4 opacity-90",
        )}
      />
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap transition-all duration-[700ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
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

function FloatingNavbar() {
  const [openMobile, setOpenMobile] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("dashboard");
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [navHover, setNavHover] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [navSize, setNavSize] = useState({ width: 0, height: 0 });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const navBorderPath = useMemo(() => {
    const width = Math.max(navSize.width - 1.5, 0);
    const height = Math.max(navSize.height - 1.5, 0);
    const radius = Math.max(height / 2, 0);
    if (!width || !height) return "";
    return [
      `M ${radius + 0.75} 0.75`,
      `H ${width - radius + 0.75}`,
      `A ${radius} ${radius} 0 0 1 ${width + 0.75} ${radius + 0.75}`,
      `V ${height - radius + 0.75}`,
      `A ${radius} ${radius} 0 0 1 ${width - radius + 0.75} ${height + 0.75}`,
      `H ${radius + 0.75}`,
      `A ${radius} ${radius} 0 0 1 0.75 ${height - radius + 0.75}`,
      `V ${radius + 0.75}`,
      `A ${radius} ${radius} 0 0 1 ${radius + 0.75} 0.75`,
      "Z",
    ].join(" ");
  }, [navSize.height, navSize.width]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const { width, height } = nav.getBoundingClientRect();
      setNavSize({ width, height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [searchOpen]);

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

  const navigate = useNavigate();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/auth", replace: true });
  };

  const openImport = useUiStore((s) => s.openImport);
  const openSettings = useUiStore((s) => s.openSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const openNotifications = useUiStore((s) => s.openNotifications);
  const openConcierge = useUiStore((s) => s.openConcierge);
  const openFinance = useUiStore((s) => s.openFinance);
  const { unreadCount } = useNotifications();

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".page-container");
    if (!container) return;
    const onScroll = () => {
      const probe = container.scrollTop + 200;
      let current = navItems[0].id as string;
      for (const item of navItems) {
        const el = document.getElementById(item.id);
        if (el && el.offsetTop <= probe) current = item.id;
      }
      setActiveSection(current);
      // Glass mode com histerese: ativa após 32px, desativa abaixo de 8px.
      setScrolled((prev) => {
        const top = container.scrollTop;
        if (!prev && top > 32) return true;
        if (prev && top < 8) return false;
        return prev;
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Navbar is always compact on desktop; hovering triggers a looping conic glow.
  const isCompact = true;

  return (
    <TooltipProvider delayDuration={150}>
    <nav
      ref={navRef}
      data-tour="navbar"
      data-mode={isCompact ? "compact" : "full"}
      data-progress={navHover ? "loop" : "false"}
      data-scrolled={scrolled ? "true" : "false"}
      onMouseEnter={() => setNavHover(true)}
      onMouseLeave={() => setNavHover(false)}
      className={cn(
        "floating-navbar flex items-center gap-3 px-3 py-2 md:px-4",
        isCompact && "md:gap-2 md:py-2 md:px-3",
      )}
    >
      {/* Looping border highlight on the navbar container border itself */}
      {navBorderPath && (
        <svg
          aria-hidden
          className="nav-progress-ring pointer-events-none absolute overflow-visible"
          viewBox={`0 0 ${navSize.width} ${navSize.height}`}
          preserveAspectRatio="none"
        >
          <path d={navBorderPath} pathLength={100} />
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-tour="global-search"
              onClick={() => {
                setSearchOpen((v) => {
                  const next = !v;
                  if (next) requestAnimationFrame(() => searchInputRef.current?.focus());
                  return next;
                });
              }}
              aria-label="Buscar"
              className="hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
            >
              <Search className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Buscar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openFinance}
              aria-label="Finanças"
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-success/15 hover:text-success active:scale-90"
            >
              <CircleDollarSign className="size-5 transition-transform duration-300 group-hover:scale-110" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Finanças</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openImport}
              data-tour="upload-button"
              aria-label="Importar dados"
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary"
            >
              <Upload className="size-5 transition-transform group-hover:-translate-y-0.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Importar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openSettings}
              data-tour="settings-button"
              aria-label="Configurações"
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
            >
              <Settings className="size-5 transition-transform duration-300 group-hover:rotate-90" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Configurações</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openNotifications}
              aria-label="Notificações"
              className="group relative hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
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
          </TooltipTrigger>
          <TooltipContent side="bottom">Notificações</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openHelp}
              data-tour="help-button"
              aria-label="Tutorial"
              className="group hidden md:grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
            >
              <HelpCircle className="size-5 transition-transform duration-300 group-hover:scale-125 group-hover:animate-pulse" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Tutorial</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleTheme}
              aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
              className="group grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
            >
              <span key={isDark ? "sun" : "moon"} className="inline-flex animate-in fade-in zoom-in-75 duration-300 group-hover:rotate-12 transition-transform">
                {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{isDark ? "Modo claro" : "Modo escuro"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleSignOut}
              aria-label="Sair"
              className="group grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-destructive/10 hover:text-destructive active:scale-90"
            >
              <LogOut className="size-5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Sair</TooltipContent>
        </Tooltip>
        <button
          className="group md:hidden grid size-10 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 active:scale-90"
          onClick={() => setOpenMobile((v) => !v)}
          aria-label="Menu"
        >
          <span key={openMobile ? "x" : "menu"} className="inline-flex animate-in fade-in zoom-in-75 duration-200">
            {openMobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </span>
        </button>
      </div>

      {searchOpen && (
        <div className="absolute right-3 top-[calc(100%+8px)] z-50 w-[min(92vw,420px)] animate-in fade-in slide-in-from-top-2 duration-200 hidden md:block">
          <div className="rounded-2xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur">
            <SearchBox inputRef={searchInputRef} />
          </div>
        </div>
      )}

      {openMobile && (
        <div className="absolute left-2 right-2 top-[calc(100%+8px)] flex flex-col gap-1 rounded-2xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur md:hidden">
          {navItems.map((i) => (
            <a
              key={i.id}
              href={`#${i.id}`}
              onClick={(e) => {
                e.preventDefault();
                setOpenMobile(false);
                scrollToSection(i.id);
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              {i.label}
            </a>
          ))}
          <SearchBox className="mt-1 w-full" />
          <div className="mt-1 grid grid-cols-3 gap-1">
            <button onClick={() => { setOpenMobile(false); openImport(); }} className="flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs hover:bg-accent">
              <Upload className="size-3.5" /> Importar
            </button>
            <button onClick={() => { setOpenMobile(false); openHelp(); }} className="flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs hover:bg-accent">
              <HelpCircle className="size-3.5" /> Ajuda
            </button>
            <button onClick={() => { setOpenMobile(false); openSettings(); }} className="flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs hover:bg-accent">
              <Settings className="size-3.5" /> Config.
            </button>
          </div>
        </div>
      )}
    </nav>
    </TooltipProvider>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">Carregando dados…</p>
        </div>
      </div>
    );
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
  const importOpen = useUiStore((s) => s.importOpen);
  const closeImport = useUiStore((s) => s.closeImport);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const closeHelp = useUiStore((s) => s.closeHelp);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  const closeNotifications = useUiStore((s) => s.closeNotifications);
  const financeOpen = useUiStore((s) => s.financeOpen);
  const closeFinance = useUiStore((s) => s.closeFinance);

  // onScrollTo dentro dos modais: fecha o modal e rola até a seção alvo.
  const handleScrollTo = (id: string) => {
    closeImport();
    closeSettings();
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  return (
    <>
      <Dialog open={importOpen} onOpenChange={(o) => (o ? null : closeImport())}>
        <DialogContent data-tour="import-modal" className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Importação</DialogTitle>
            <DialogDescription>Importe clientes e produtos em massa.</DialogDescription>
          </DialogHeader>
          <ImportSection onScrollTo={handleScrollTo} />
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={(o) => (o ? null : closeSettings())}>
        <DialogContent data-tour="settings-modal" className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Configurações</DialogTitle>
            <DialogDescription>Preferências, regras e zona de perigo.</DialogDescription>
          </DialogHeader>
          <ConfiguracoesSection />
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={(o) => (o ? null : closeHelp())}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Central de Ajuda</DialogTitle>
            <DialogDescription>Tutoriais guiados visuais.</DialogDescription>
          </DialogHeader>
          <HelpCenter />
        </DialogContent>
      </Dialog>

      <Dialog open={notificationsOpen} onOpenChange={(o) => (o ? null : closeNotifications())}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Notificações</DialogTitle>
            <DialogDescription>Alertas e avisos recentes da operação.</DialogDescription>
          </DialogHeader>
          <NotificationsPanel onOpenClient={() => closeNotifications()} />
        </DialogContent>
      </Dialog>

      <Dialog open={financeOpen} onOpenChange={(o) => (o ? null : closeFinance())}>
        <DialogContent className="max-w-[95vw] xl:max-w-7xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Finanças</DialogTitle>
            <DialogDescription>Dashboard financeiro consolidado.</DialogDescription>
          </DialogHeader>
          <FinanceDashboard />
        </DialogContent>
      </Dialog>

      <TutorialRunner />
      <ConciergeModal />
    </>
  );
}