import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Card, Tag } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCents } from "@/lib/shipping-quotes";
import { listShipments, type ShipmentRow } from "@/lib/shipments.functions";
import { checkoutSuperfreteOrders } from "@/lib/superfrete.functions";
import { useSuperfreteBalance } from "@/lib/use-superfrete-balance";

const PAID = /liberad|paga|postad|entregue|delivered|released|posted/i;

/** Etiqueta criada porém ainda não paga na carteira SuperFrete. */
function isUnpaid(s: ShipmentRow): boolean {
  if (!s.superfreteOrderId) return false;
  return !PAID.test(`${s.status} ${s.superfreteStatus ?? ""}`);
}

/** Carteira SuperFrete: saldo e pagamento das etiquetas pendentes. */
export function SuperfreteWalletPanel() {
  const fetchShipments = useServerFn(listShipments);
  const payMany = useServerFn(checkoutSuperfreteOrders);
  const { balance, loading: balanceLoading, refresh } = useSuperfreteBalance(true);
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchShipments({ data: { limit: 100 } });
      setRows(list.filter(isUnpaid));
    } catch {
      /* lista informativa */
    } finally {
      setLoading(false);
    }
  }, [fetchShipments]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSelected = useMemo(
    () => rows.filter((r) => selected.has(r.id)).reduce((a, r) => a + r.priceCents, 0),
    [rows, selected],
  );
  const missing =
    balance?.balanceCents != null ? Math.max(0, totalSelected - balance.balanceCents) : 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pay = async () => {
    if (paying || selected.size === 0) return;
    setPaying(true);
    try {
      const res = await payMany({ data: { shipmentIds: [...selected] } });
      toast.success(
        `${res.paid.length} etiqueta(s) paga(s)${
          res.pending.length ? ` · ${res.pending.length} pendente(s)` : ""
        }${res.failed.length ? ` · ${res.failed.length} com erro` : ""}.`,
      );
      setSelected(new Set());
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível pagar as etiquetas.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <Card
      title="Carteira SuperFrete"
      className="mb-4"
      action={
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wallet className="size-4" />
          Saldo:{" "}
          <strong className="tabular-nums">
            {balanceLoading && !balance
              ? "…"
              : balance?.balanceCents != null
                ? formatCents(balance.balanceCents)
                : "indisponível"}
          </strong>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => {
              void refresh();
              void load();
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </span>
      }
    >
      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Carregando etiquetas…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma etiqueta aguardando pagamento no momento.
        </p>
      ) : (
        <>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {rows.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                />
                <span className="min-w-0 flex-1 truncate">{r.clientName}</span>
                <Tag>{r.selectedServiceName ?? r.service}</Tag>
                <span className="tabular-nums font-medium">{formatCents(r.priceCents)}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {selected.size} selecionada(s) · total {formatCents(totalSelected)}
              {missing > 0 ? ` · faltam ${formatCents(missing)} de saldo` : ""}
            </span>
            <Button size="sm" onClick={pay} disabled={paying || selected.size === 0 || missing > 0}>
              {paying ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Pagar com saldo
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
