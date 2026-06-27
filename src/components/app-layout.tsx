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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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

const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clientes", label: "Clientes" },
  { id: "collection", label: "Collection" },
] as const;

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SearchBox({ className }: { className?: string }) {
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
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query && setOpen(true)}
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
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 active:scale-95",
        active
          ? "bg-primary text-primary-foreground shadow-sm scale-105"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <span className="inline-block transition-transform">{label}</span>
    </a>
  );
}

function FloatingNavbar() {
  const [hidden, setHidden] = useState(false);
  const [openMobile, setOpenMobile] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("dashboard");
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const { unreadCount } = useNotifications();

  useEffect(() => {
    const onScroll = () => {
      setHidden(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setHidden(false), 350);
      const probe = window.scrollY + 200;
      let current = navItems[0].id as string;
      for (const item of navItems) {
        const el = document.getElementById(item.id);
        if (el && el.offsetTop <= probe) current = item.id;
      }
      setActiveSection(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <nav data-tour="navbar" className={cn("floating-navbar flex items-center gap-3 px-3 py-2 md:px-4", hidden && "navbar-hidden")}>
      <a
        href="#dashboard"
        onClick={(e) => { e.preventDefault(); scrollToSection("dashboard"); }}
        className="group flex items-center gap-2 pl-2 pr-1 transition-transform duration-200 hover:-translate-y-0.5 active:scale-95"
      >
        <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.65_0.22_280)] text-primary-foreground font-bold shadow-md transition-all duration-300 group-hover:shadow-lg group-hover:rotate-6 group-hover:scale-110">
          S
        </div>
        <div className="hidden lg:block leading-tight transition-all duration-200 group-hover:translate-x-0.5">
          <p className="text-sm font-semibold">Star Games</p>
          <p className="text-[10px] text-muted-foreground">Gestão Operacional</p>
        </div>
      </a>

      <div className="hidden md:flex items-center gap-1 rounded-full bg-foreground/5 p-1">
        {navItems.map((i) => (
          <NavLink
            key={i.id}
            id={i.id}
            label={i.label}
            active={activeSection === i.id}
            onClick={() => scrollToSection(i.id)}
          />
        ))}
      </div>

      <div data-tour="global-search" className="hidden md:block ml-3 flex-1 max-w-md">
        <SearchBox className="transition-all duration-300 focus-within:scale-[1.02]" />
      </div>

      <div className="ml-auto flex items-center gap-1.5 md:gap-2 md:pl-2">
        <button
          onClick={openImport}
          data-tour="upload-button"
          aria-label="Importar dados"
          title="Importar dados"
          className="group hidden md:grid size-9 place-items-center rounded-full text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary"
        >
          <Upload className="size-4 transition-transform group-hover:-translate-y-0.5" />
        </button>
        <button
          onClick={openSettings}
          data-tour="settings-button"
          aria-label="Configurações"
          title="Configurações"
          className="group hidden md:grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
        >
          <Settings className="size-4 transition-transform duration-300 group-hover:rotate-90" />
        </button>
        <button
          onClick={openNotifications}
          aria-label="Notificações"
          title="Notificações"
          className="group relative hidden md:grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
        >
          <Bell className="size-4 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
          {unreadCount > 0 && (
            <>
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary animate-pulse" />
              <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] h-4 px-1 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-sm animate-in zoom-in-75 duration-200">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            </>
          )}
        </button>
        <button
          onClick={openHelp}
          data-tour="help-button"
          aria-label="Tutorial"
          title="Tutorial"
          className="group hidden md:grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
        >
          <HelpCircle className="size-4 transition-transform duration-300 group-hover:scale-125 group-hover:animate-pulse" />
        </button>
        <button
          onClick={toggleTheme}
          aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
          title={isDark ? "Modo claro" : "Modo escuro"}
          className="group grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 hover:text-foreground active:scale-90"
        >
          <span key={isDark ? "sun" : "moon"} className="inline-flex animate-in fade-in zoom-in-75 duration-300 group-hover:rotate-12 transition-transform">
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </span>
        </button>
        <button
          onClick={handleSignOut}
          aria-label="Sair"
          title="Sair"
          className="group grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-destructive/10 hover:text-destructive active:scale-90"
        >
          <LogOut className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
        <button
          className="group md:hidden grid size-9 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-foreground/10 active:scale-90"
          onClick={() => setOpenMobile((v) => !v)}
          aria-label="Menu"
        >
          <span key={openMobile ? "x" : "menu"} className="inline-flex animate-in fade-in zoom-in-75 duration-200">
            {openMobile ? <X className="size-4" /> : <Menu className="size-4" />}
          </span>
        </button>
      </div>

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
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Importação</DialogTitle>
            <DialogDescription>Importe clientes e produtos em massa.</DialogDescription>
          </DialogHeader>
          <ImportSection onScrollTo={handleScrollTo} />
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={(o) => (o ? null : closeSettings())}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Configurações</DialogTitle>
            <DialogDescription>Preferências, regras e zona de perigo.</DialogDescription>
          </DialogHeader>
          <ConfiguracoesSection />
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={(o) => (o ? null : closeHelp())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tutorial</DialogTitle>
            <DialogDescription>
              Em breve: tutorial guiado da operação.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. Como importar clientes</li>
            <li>2. Como revisar cobranças</li>
            <li>3. Como abrir cliente</li>
            <li>4. Como copiar mensagem de cobrança</li>
            <li>5. Como usar configurações</li>
          </ol>
        </DialogContent>
      </Dialog>

      <Dialog open={notificationsOpen} onOpenChange={(o) => (o ? null : closeNotifications())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Notificações</DialogTitle>
            <DialogDescription>Alertas e avisos recentes da operação.</DialogDescription>
          </DialogHeader>
          <NotificationsPanel onOpenClient={() => closeNotifications()} />
        </DialogContent>
      </Dialog>
    </>
  );
}