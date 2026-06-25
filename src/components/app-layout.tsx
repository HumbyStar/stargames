import { Outlet, useNavigate } from "@tanstack/react-router";
import { Search, Bell, HelpCircle, Menu, X, Sun, Moon, User, Package, LogOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clientes", label: "Clientes" },
  { id: "collection", label: "Collection" },
  { id: "import", label: "Import" },
  { id: "configuracoes", label: "Configurações" },
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
        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      {label}
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
    <nav className={cn("floating-navbar flex items-center gap-3 px-3 py-2 md:px-4", hidden && "navbar-hidden")}>
      <a
        href="#dashboard"
        onClick={(e) => { e.preventDefault(); scrollToSection("dashboard"); }}
        className="flex items-center gap-2 pl-2 pr-1"
      >
        <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.65_0.22_280)] text-primary-foreground font-bold shadow-md">
          S
        </div>
        <div className="hidden lg:block leading-tight">
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

      <div className="ml-auto flex items-center gap-2">
        <SearchBox className="hidden md:block w-56 lg:w-72" />
        <button className="hidden md:grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
          <HelpCircle className="size-4" />
        </button>
        <button className="hidden md:grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
          <Bell className="size-4" />
        </button>
        <button
          onClick={toggleTheme}
          aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
          className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button
          onClick={handleSignOut}
          aria-label="Sair"
          className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="size-4" />
        </button>
        <button
          className="md:hidden grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10"
          onClick={() => setOpenMobile((v) => !v)}
          aria-label="Menu"
        >
          {openMobile ? <X className="size-4" /> : <Menu className="size-4" />}
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
        </div>
      )}
    </nav>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-screen bg-background bg-gradient-to-b from-background via-background to-accent/30">
      <FloatingNavbar />
      <main className="page-container">{children ?? <Outlet />}</main>
    </div>
  );
}