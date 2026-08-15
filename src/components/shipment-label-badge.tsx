import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShipmentLabelInfo {
  /** Status interno do envio mais recente do produto. */
  status: string;
  /** true quando a etiqueta ainda não foi paga/liberada. */
  pending: boolean;
  createdAt?: string;
}

/**
 * Selo de etiqueta SuperFrete no produto — âmbar quando a etiqueta existe mas
 * ainda não foi paga/liberada, e verde quando já está liberada/postada.
 */
export function ShipmentLabelBadge({ info }: { info: ShipmentLabelInfo }) {
  const date = info.createdAt ? new Date(info.createdAt) : null;
  const dateLabel =
    date && !isNaN(date.getTime()) ? date.toLocaleDateString("pt-BR") : null;
  const title = `Etiqueta ${info.pending ? "gerada e AGUARDANDO PAGAMENTO" : "liberada"} · ${info.status}${
    dateLabel ? ` · ${dateLabel}` : ""
  }`;
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
    </span>
  );
}
