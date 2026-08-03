import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const items = [
  {
    label: "Pago",
    tone: "bg-[color:var(--success)]/10 border-[color:var(--success)]/30",
    dot: "bg-[color:var(--success)]",
    description:
      "Produto quitado: valor pago é igual ao total. Elegível para emissão de nota fiscal.",
  },
  {
    label: "Reserva",
    tone: "bg-[color:var(--warning)]/10 border-[color:var(--warning)]/30",
    dot: "bg-[color:var(--warning)]",
    description:
      "Item reservado com pagamento parcial ou aguardando confirmação. Data limite de 1 mês após o cadastro.",
  },
  {
    label: "Pendente",
    tone: "bg-destructive/10 border-destructive/30",
    dot: "bg-destructive",
    description:
      "Sem pagamento registrado. Entra na régua de cobrança e vence 30 dias após o cadastro.",
  },
];

export function StatusLegend({ className }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium text-foreground">Legenda:</span>
      {items.map((it) => (
        <Tooltip key={it.label}>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex cursor-help items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
                it.tone,
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", it.dot)} />
              {it.label}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-xs">
            {it.description}
          </TooltipContent>
        </Tooltip>
      ))}
      <span className="basis-full text-[11px] text-muted-foreground/80">
        As cores destacam apenas itens em aberto — enviados, removidos e retirados
        ficam sem cor.
      </span>
    </div>
    </TooltipProvider>
  );
}
