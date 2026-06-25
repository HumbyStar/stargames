import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Wallet,
  Upload,
  Settings,
  Search,
  Bell,
  HelpCircle,
} from "lucide-react";
import type { ReactNode } from "react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/collection", label: "Collection", icon: Wallet, exact: false },
  { to: "/import", label: "Import", icon: Upload, exact: true },
] as const;

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");
  return (
    <Link
      to={to}
      className={
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
        (active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")
      }
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </Link>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="hidden w-64 flex-col border-r border-border bg-sidebar md:flex">
        <div className="px-5 py-6">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground font-bold">
              S
            </div>
            <div>
              <p className="text-base font-semibold leading-tight">Star Games</p>
              <p className="text-xs text-muted-foreground">Gestão Operacional</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((i) => (
            <NavLink key={i.to} {...i} />
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <NavLink to="/settings" label="Configurações" icon={Settings} exact />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Buscar cliente, telefone ou produto..."
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>
          <button className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <HelpCircle className="size-4" />
          </button>
          <button className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Bell className="size-4" />
          </button>
          <div className="size-9 rounded-full bg-gradient-to-br from-primary to-primary/60" />
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}