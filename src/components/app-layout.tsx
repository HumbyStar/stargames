import { Outlet } from "@tanstack/react-router";
import { Search, Bell, HelpCircle, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clientes", label: "Clientes" },
  { id: "collection", label: "Collection" },
  { id: "import", label: "Import" },
] as const;

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
          : "text-muted-foreground hover:bg-white/60 hover:text-foreground",
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      <div className="hidden md:flex items-center gap-1 rounded-full bg-white/40 p-1">
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
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Buscar cliente, telefone ou produto..."
            className="h-9 w-56 lg:w-72 rounded-full border border-white/60 bg-white/60 pl-9 pr-3 text-sm outline-none transition focus:border-primary/40 focus:bg-white"
          />
        </div>
        <button className="hidden md:grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground">
          <HelpCircle className="size-4" />
        </button>
        <button className="hidden md:grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground">
          <Bell className="size-4" />
        </button>
        <div className="size-9 rounded-full bg-gradient-to-br from-primary to-[oklch(0.65_0.22_280)] ring-2 ring-white/70" />
        <button
          className="md:hidden grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/70"
          onClick={() => setOpenMobile((v) => !v)}
          aria-label="Menu"
        >
          {openMobile ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>

      {openMobile && (
        <div className="absolute left-2 right-2 top-[calc(100%+8px)] flex flex-col gap-1 rounded-2xl border border-white/60 bg-white/90 p-2 shadow-xl backdrop-blur md:hidden">
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
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Buscar..."
              className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm outline-none"
            />
          </div>
        </div>
      )}
    </nav>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[oklch(0.985_0.005_260)] via-background to-[oklch(0.97_0.015_260)]">
      <FloatingNavbar />
      <main className="page-container">{children ?? <Outlet />}</main>
    </div>
  );
}