import { cn } from "@/lib/utils";

const items = [
  {
    label: "Pago",
    tone: "bg-[color:var(--success)]/10 border-[color:var(--success)]/30",
    dot: "bg-[color:var(--success)]",
  },
  {
    label: "Reserva",
    tone: "bg-[color:var(--warning)]/10 border-[color:var(--warning)]/30",
    dot: "bg-[color:var(--warning)]",
  },
  {
    label: "Pendente",
    tone: "bg-destructive/10 border-destructive/30",
    dot: "bg-destructive",
  },
];

export function StatusLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium text-foreground">Legenda:</span>
      {items.map((it) => (
        <span
          key={it.label}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
            it.tone,
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", it.dot)} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
