import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui-bits";
import { useStore } from "@/lib/store";
import { useUiStore } from "@/lib/ui-store";
import { usePriorityAlert, conciergePrefs } from "@/lib/concierge-priority";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";
import {
  AlertTriangle,
  Clock,
  CreditCard,
  Package,
  Search,
  Sparkles,
  Truck,
  User,
  UserPlus,
} from "lucide-react";
import {
  DashboardDrilldownModal,
  type DashboardCardId,
} from "@/components/dashboard-drilldown-modal";

type ConciergeAction = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  cardId?: DashboardCardId;
  custom?: "new-client" | "add-product";
  tone: "primary" | "danger" | "warning" | "success" | "neutral";
};

const ACTIONS: ConciergeAction[] = [
  {
    id: "view-pending",
    label: "Ver pendentes",
    description: "Pendências em aberto (sem MGMV).",
    icon: AlertTriangle,
    cardId: "pending",
    tone: "warning",
  },
  {
    id: "view-overdue",
    label: "Vencidos / remarcados",
    description: "Reservas e pendências vencidas.",
    icon: Clock,
    cardId: "overdue-reservations",
    tone: "danger",
  },
  {
    id: "charge",
    label: "Cobrar cliente",
    description: "Cobranças comuns elegíveis.",
    icon: CreditCard,
    cardId: "pending",
    tone: "primary",
  },
  {
    id: "paid-awaiting",
    label: "Pagos aguardando envio",
    description: "Produtos pagos prontos para envio.",
    icon: Truck,
    cardId: "paid-awaiting-shipment",
    tone: "success",
  },
  {
    id: "mgmv-quick",
    label: "MGMV rápido",
    description: "Acordos MGMV ativos e vencidos.",
    icon: Sparkles,
    cardId: "mgmv-overdue",
    tone: "primary",
  },
  {
    id: "new-client",
    label: "Cadastrar cliente",
    description: "Abrir formulário de novo cliente.",
    icon: UserPlus,
    custom: "new-client",
    tone: "neutral",
  },
  {
    id: "add-product",
    label: "Adicionar produto",
    description: "Buscar cliente para vincular produto.",
    icon: Package,
    custom: "add-product",
    tone: "neutral",
  },
];

const TONE_CLASS: Record<ConciergeAction["tone"], string> = {
  primary: "border-primary/30 hover:bg-primary/10 text-primary",
  danger: "border-destructive/30 hover:bg-destructive/10 text-destructive",
  warning: "border-amber-500/30 hover:bg-amber-500/10 text-amber-600",
  success: "border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-600",
  neutral: "border-border hover:bg-accent text-foreground",
};

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollTo({ top: 0, behavior: "auto" });
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ConciergeModal() {
  const open = useUiStore((s) => s.conciergeOpen);
  const close = useUiStore((s) => s.closeConcierge);
  const openCx = useUiStore((s) => s.openConcierge);
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);

  const [query, setQuery] = useState("");
  const [activeCard, setActiveCard] = useState<DashboardCardId | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const alert = usePriorityAlert();

  // Foca campo de busca ao abrir
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Array<{
      id: string;
      clientId: string;
      title: string;
      subtitle: string;
      tag: string;
    }>;
    const digits = q.replace(/\D/g, "");
    const list: Array<{ id: string; clientId: string; title: string; subtitle: string; tag: string }> = [];
    for (const c of clients) {
      const inName = c.name.toLowerCase().includes(q);
      const inPhone = digits && c.phone.replace(/\D/g, "").includes(digits);
      if (inName || inPhone) {
        list.push({
          id: `c-${c.id}`,
          clientId: c.id,
          title: c.name,
          subtitle: c.phone || "—",
          tag: c.mgmv ? "MGMV" : "Comum",
        });
      }
    }
    for (const p of products) {
      if (p.name.toLowerCase().includes(q)) {
        const owner = clients.find((c) => c.id === p.clientId);
        list.push({
          id: `p-${p.id}`,
          clientId: p.clientId,
          title: p.name,
          subtitle: `${p.platform} · ${owner?.name ?? "Cliente"}`,
          tag: "Produto",
        });
      }
    }
    return list.slice(0, 20);
  }, [query, clients, products]);

  const handleAction = (a: ConciergeAction) => {
    if (a.cardId) {
      setActiveCard(a.cardId);
      close();
      return;
    }
    if (a.custom === "new-client") {
      close();
      setTimeout(() => {
        scrollToSection("clientes");
        // Disparar evento global para abrir formulário de novo cliente
        window.dispatchEvent(new CustomEvent("concierge:new-client"));
      }, 80);
      return;
    }
    if (a.custom === "add-product") {
      // Foca campo de busca para localizar cliente
      const input = document.querySelector<HTMLInputElement>(
        'input[type="search"]',
      );
      input?.focus();
    }
  };

  const openSelected = (clientId: string) => {
    openClient(clientId);
    close();
    setTimeout(() => scrollToSection("clientes"), 60);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="max-w-2xl animate-in fade-in zoom-in-95 duration-200">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="shrink-0 grid size-12 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/30 overflow-hidden">
                <img src={mascotAsset.url} alt="" className="size-10 object-cover" draggable={false} />
              </div>
              <div className="min-w-0">
                <DialogTitle>O que vamos fazer agora?</DialogTitle>
                <DialogDescription>
                  Filtro operacional central. Escolha uma ação ou busque cliente, telefone ou produto.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {alert.count > 0 && alert.cardId && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm flex items-center justify-between gap-3">
              <p className="text-foreground">{alert.message}</p>
              <Button
                size="sm"
                onClick={() => {
                  setActiveCard(alert.cardId);
                  close();
                }}
              >
                Abrir agora
              </Button>
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, telefone ou produto..."
              className="h-10 pl-9"
            />
          </div>

          {query.trim() ? (
            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              {results.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhum resultado.
                </div>
              ) : (
                results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openSelected(r.clientId)}
                    className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left transition hover:bg-accent last:border-0"
                  >
                    <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                      <User className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                    </div>
                    <Tag variant="neutral">{r.tag}</Tag>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    onClick={() => handleAction(a)}
                    className={`flex items-start gap-3 rounded-xl border bg-background/40 px-3 py-3 text-left transition hover:-translate-y-0.5 ${TONE_CLASS[a.tone]}`}
                  >
                    <div className="grid size-9 place-items-center rounded-lg bg-foreground/5">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{a.label}</p>
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  conciergePrefs.dismissToday();
                  close();
                }}
                className="rounded-full border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent transition"
              >
                Não mostrar automaticamente hoje
              </button>
              <button
                type="button"
                onClick={() => {
                  conciergePrefs.disableForever();
                  close();
                }}
                className="rounded-full border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent transition"
              >
                Não mostrar automaticamente novamente
              </button>
            </div>
            <Button variant="outline" onClick={close}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DashboardDrilldownModal
        cardId={activeCard}
        onClose={() => setActiveCard(null)}
        onScrollTo={(id) => scrollToSection(id)}
        origin="Concierge Operacional"
        onBackToConcierge={() => {
          setActiveCard(null);
          setTimeout(() => openCx(), 50);
        }}
      />
    </>
  );
}