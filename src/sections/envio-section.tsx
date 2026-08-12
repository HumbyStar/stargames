import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Truck } from "lucide-react";
import { Card, MetricCard, PageHeader, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePersistedState } from "@/lib/use-persisted-state";
import { cn } from "@/lib/utils";
import {
  formatBRL,
  formatDateBR,
  useStore,
  type Client,
  type Product,
} from "@/lib/store";

const ShipmentWizardModal = lazy(() =>
  import("@/components/shipment-wizard-modal").then((m) => ({
    default: m.ShipmentWizardModal,
  })),
);

/** Data de referência para "tempo em estoque": última atualização do produto. */
function stockSince(p: Product): number {
  const raw = p.updatedAt ?? p.registerDate;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function daysInStock(p: Product): number {
  return Math.max(0, Math.floor((Date.now() - stockSince(p)) / 86_400_000));
}

interface Group {
  client: Client;
  products: Product[];
  total: number;
  oldestDays: number;
}

/**
 * Envio / SuperFrete — clientes com produtos pagos aguardando envio.
 *
 * Lista apenas produtos com status financeiro "Pago" e situação "Em Aberto",
 * agrupados por cliente, com filtros por quantidade de itens e tempo em
 * estoque. As cotações do assistente de envio são fictícias (front-end).
 */
export function EnvioSection({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const openClient = useStore((s) => s.openClient);

  const [search, setSearch] = usePersistedState<string>("envio.search", "");
  const [minItems, setMinItems] = usePersistedState<string>("envio.minItems", "1");
  const [minDays, setMinDays] = usePersistedState<string>("envio.minDays", "0");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [wizardClientId, setWizardClientId] = useState<string | null>(null);

  const allGroups = useMemo<Group[]>(() => {
    const byClient = new Map<string, Product[]>();
    for (const p of products) {
      if (p.financialStatus !== "Pago" || p.situation !== "Em Aberto") continue;
      const list = byClient.get(p.clientId);
      if (list) list.push(p);
      else byClient.set(p.clientId, [p]);
    }
    const out: Group[] = [];
    for (const [clientId, list] of byClient) {
      const client = clients.find((c) => c.id === clientId);
      if (!client) continue;
      out.push({
        client,
        products: list.sort((a, b) => stockSince(a) - stockSince(b)),
        total: list.reduce((acc, p) => acc + p.totalValue, 0),
        oldestDays: Math.max(...list.map(daysInStock)),
      });
    }
    return out.sort((a, b) => b.oldestDays - a.oldestDays);
  }, [clients, products]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = Math.max(1, Number(minItems) || 1);
    const days = Math.max(0, Number(minDays) || 0);
    return allGroups.filter((g) => {
      if (g.products.length < min) return false;
      if (g.oldestDays < days) return false;
      if (!q) return true;
      return (
        g.client.name.toLowerCase().includes(q) ||
        (g.client.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
        g.products.some((p) => p.name.toLowerCase().includes(q))
      );
    });
  }, [allGroups, search, minItems, minDays]);

  const totalItems = allGroups.reduce((acc, g) => acc + g.products.length, 0);
  const totalValue = allGroups.reduce((acc, g) => acc + g.total, 0);
  const aging = allGroups.filter((g) => g.oldestDays >= 15).length;

  const wizardGroup = groups.find((g) => g.client.id === wizardClientId) ?? null;

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Envio / SuperFrete"
        description="Clientes com produtos pagos aguardando envio. Cotações simuladas, sem integração com a API."
        actions={
          <Button variant="outline" size="sm" onClick={() => onScrollTo("clientes")}>
            Ir para Clientes
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Clientes aguardando" value={allGroups.length} status="primary" />
        <MetricCard label="Itens a enviar" value={totalItems} />
        <MetricCard label="Valor em estoque" value={formatBRL(totalValue)} status="success" />
        <MetricCard
          label="Parados 15+ dias"
          value={aging}
          status={aging > 0 ? "warning" : "default"}
        />
      </div>

      <Card title="Filtros" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Buscar cliente ou produto</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome, telefone ou produto"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Mínimo de produtos</Label>
            <Input
              inputMode="numeric"
              value={minItems}
              onChange={(e) => setMinItems(e.target.value)}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Tempo mínimo em estoque (dias)</Label>
            <Input
              inputMode="numeric"
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              className="h-9"
            />
          </div>
        </div>
      </Card>

      <Card title={`Clientes para envio (${groups.length})`}>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum cliente com produtos pagos aguardando envio nos filtros atuais.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="w-8 py-2" />
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Itens</th>
                  <th className="py-2 pr-3">Valor</th>
                  <th className="py-2 pr-3">Em estoque</th>
                  <th className="py-2 pr-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const open = expanded.has(g.client.id);
                  return (
                    <>
                      <tr key={g.client.id} className="border-b border-border/60">
                        <td className="py-2">
                          <button
                            type="button"
                            aria-label={open ? "Ocultar produtos" : "Ver detalhes"}
                            onClick={() => toggle(g.client.id)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            {open ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 pr-3">
                          <span className="block font-medium">{g.client.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {g.client.phone}
                          </span>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{g.products.length}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatBRL(g.total)}</td>
                        <td className="py-2 pr-3">
                          <Tag
                            variant={
                              g.oldestDays >= 30
                                ? "danger"
                                : g.oldestDays >= 15
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {g.oldestDays} dia(s)
                          </Tag>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => setWizardClientId(g.client.id)}
                              className="gap-1"
                            >
                              <Truck className="size-4" /> Enviar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggle(g.client.id)}
                            >
                              Ver detalhes
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1"
                              onClick={() => {
                                openClient(g.client.id);
                                onScrollTo("clientes");
                              }}
                            >
                              <ExternalLink className="size-4" /> Ficha
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${g.client.id}-details`} className="bg-muted/30">
                          <td />
                          <td colSpan={5} className="py-2 pr-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left uppercase text-muted-foreground">
                                  <th className="py-1 pr-3">Produto</th>
                                  <th className="py-1 pr-3">Plataforma</th>
                                  <th className="py-1 pr-3">Valor</th>
                                  <th className="py-1 pr-3">Desde</th>
                                  <th className="py-1 pr-3">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.products.map((p) => (
                                  <tr key={p.id} className="border-t border-border/40">
                                    <td className="py-1 pr-3">{p.name}</td>
                                    <td className="py-1 pr-3">{p.platform || "—"}</td>
                                    <td className="py-1 pr-3 tabular-nums">
                                      {formatBRL(p.totalValue)}
                                    </td>
                                    <td
                                      className={cn(
                                        "py-1 pr-3",
                                        daysInStock(p) >= 30 && "text-destructive",
                                      )}
                                    >
                                      {formatDateBR(
                                        new Date(stockSince(p)).toISOString(),
                                      )}{" "}
                                      ({daysInStock(p)}d)
                                    </td>
                                    <td className="py-1 pr-3">
                                      <Tag variant="success">Pago · Em Aberto</Tag>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {wizardGroup && (
        <Suspense fallback={null}>
          <ShipmentWizardModal
            open
            client={wizardGroup.client}
            products={wizardGroup.products}
            onClose={() => setWizardClientId(null)}
          />
        </Suspense>
      )}
    </section>
  );
}