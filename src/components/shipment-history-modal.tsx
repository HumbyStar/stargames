import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { listShipments, type ShipmentRow } from "@/lib/shipments.functions";
import { downloadShipmentLabelPdf } from "@/lib/shipping-label-pdf";
import { formatBRL } from "@/lib/store";
import { ChevronDown, ChevronUp, Download, Loader2, Package, Truck } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR");
}

function ShipmentCard({ shipment }: { shipment: ShipmentRow }) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const r = shipment.recipient;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadShipmentLabelPdf(shipment);
    } catch {
      toast.error("Não foi possível gerar o PDF do envio");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <Truck className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {shipment.carrier}
            {shipment.service ? ` · ${shipment.service}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(shipment.createdAt)} · {shipment.items.length} item(ns) ·{" "}
            {shipment.totalWeightKg.toFixed(2).replace(".", ",")} kg
            {shipment.etaDays != null ? ` · ${shipment.etaDays} dia(s)` : ""}
          </div>
        </div>
        <div className="text-sm font-semibold">{formatBRL(shipment.priceCents / 100)}</div>
        <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span className="ml-1">Detalhes</span>
        </Button>
        <Button size="sm" onClick={download} disabled={downloading}>
          {downloading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 h-3.5 w-3.5" />
          )}
          PDF
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
              Destinatário
            </div>
            {r ? (
              <div className="space-y-0.5 text-sm">
                <div className="font-medium">{r.fullName || shipment.clientName}</div>
                <div className="text-muted-foreground">
                  {[r.street, r.number].filter(Boolean).join(", ")}
                  {r.complement ? ` - ${r.complement}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {[r.neighborhood, [r.city, r.state].filter(Boolean).join("/")]
                    .filter(Boolean)
                    .join(" - ")}
                  {r.cep ? ` · CEP ${r.cep}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {[r.cpfCnpj ? `CPF/CNPJ ${r.cpfCnpj}` : "", r.phone ? `Tel ${r.phone}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Destinatário não informado.</div>
            )}
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
              Itens
            </div>
            <div className="space-y-1.5">
              {shipment.items.map((it) => (
                <div
                  key={it.productId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md bg-muted/40 px-2.5 py-1.5"
                >
                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.platform && (
                    <span className="text-xs text-muted-foreground">{it.platform}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {it.lengthCm}x{it.widthCm}x{it.heightCm} cm ·{" "}
                    {it.weightKg.toFixed(2).replace(".", ",")} kg
                  </span>
                  <span className="text-xs font-medium">{formatBRL(it.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {shipment.notes && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                Observações
              </div>
              <div className="whitespace-pre-wrap text-muted-foreground">{shipment.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ShipmentHistoryModal({ open, onClose, clientId, clientName }: Props) {
  const fetchShipments = useServerFn(listShipments);
  const [rows, setRows] = useState<ShipmentRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchShipments({ data: { clientId, limit: 200 } });
      setRows(data);
    } catch {
      toast.error("Não foi possível carregar o histórico de envios");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fetchShipments, clientId]);

  useEffect(() => {
    if (open) void load();
    else setRows(null);
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Envios de {clientName}</DialogTitle>
          <DialogDescription>
            Histórico completo de envios com detalhes e etiqueta em PDF para impressão.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando envios…
            </div>
          )}
          {!loading && rows && rows.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhum envio registrado para este cliente.
              <div className="mt-1 text-xs">
                Selecione produtos pagos aguardando envio e use o botão “Enviar”.
              </div>
            </div>
          )}
          {!loading &&
            rows?.map((s) => <ShipmentCard key={s.id} shipment={s} />)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
