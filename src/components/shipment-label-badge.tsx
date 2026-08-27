import { Tag, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShipmentLabelInfo {
  /** Status interno do envio mais recente do produto. */
  status: string;
  /** true quando a etiqueta ainda não foi paga/liberada. */
  pending: boolean;
  createdAt?: string;
  /** Envio de origem — permite descartar etiquetas que não existem na SuperFrete. */
  shipmentId?: string;
}

/**
 * Selo de etiqueta SuperFrete no produto — âmbar quando a etiqueta existe mas
 * ainda não foi paga/liberada, e azul quando já está liberada/postada.
 * Etiquetas pendentes podem ser verificadas na SuperFrete ou descartadas.
 */
export function ShipmentLabelBadge({
  info,
  onDismiss,
  onVerify,
}: {
  info: ShipmentLabelInfo;
  onDismiss?: (shipmentId: string) => void;
  onVerify?: (shipmentId: string) => void;
}) {
  const date = info.createdAt ? new Date(info.createdAt) : null;
  const dateLabel =
    date && !isNaN(date.getTime()) ? date.toLocaleDateString("pt-BR") : null;
  const title = `Etiqueta ${info.pending ? "gerada e AGUARDANDO PAGAMENTO" : "liberada"} · ${info.status}${
    dateLabel ? ` · ${dateLabel}` : ""
  }`;
  const canDismiss = Boolean(info.pending && onDismiss && info.shipmentId);
  const canVerify = Boolean(info.pending && onVerify && info.shipmentId);
  return (
    <span
      title={title}
      className={cn(
        "ml-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        info.pending
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      )}
    >
      <Tag className="h-3 w-3" />
      {info.pending ? "Etiqueta não paga" : "Etiqueta"}
      {canVerify ? (
        <button
          type="button"
          title="Verificar esta etiqueta na SuperFrete"
          className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20"
          onClick={(e) => {
            e.stopPropagation();
            onVerify?.(info.shipmentId as string);
          }}
        >
          <RefreshCw className="h-2.5 w-2.5" />
        </button>
      ) : null}
      {canDismiss ? (
        <button
          type="button"
          title="Descartar selo — a etiqueta não existe na SuperFrete"
          className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss?.(info.shipmentId as string);
          }}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </span>
  );
}

