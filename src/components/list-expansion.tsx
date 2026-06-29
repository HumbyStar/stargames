import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListExpansion, type ListSection } from "@/lib/list-expansion";

/**
 * Botão compacto para expandir/minimizar a lista de uma seção.
 * A preferência é persistida por seção; o estado se mantém ao trocar
 * de seção e voltar.
 */
export function ListExpansionToggle({
  section,
  className,
}: {
  section: ListSection;
  className?: string;
}) {
  const { expanded, toggle } = useListExpansion(section);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={toggle}
      className={cn("gap-1.5", className)}
      title={expanded ? "Minimizar lista" : "Expandir lista"}
      aria-pressed={expanded}
    >
      {expanded ? (
        <Minimize2 className="h-4 w-4" />
      ) : (
        <Maximize2 className="h-4 w-4" />
      )}
      {expanded ? "Minimizar lista" : "Expandir lista"}
    </Button>
  );
}

/**
 * Cartão exibido quando a lista da seção está minimizada.
 * Mostra um resumo leve e um botão para expandir, evitando renderizar
 * tabelas grandes quando o usuário não está focado nesta lista.
 */
export function MinimizedListCard({
  section,
  title,
  lines,
}: {
  section: ListSection;
  title: string;
  lines: React.ReactNode[];
}) {
  const { expand } = useListExpansion(section);
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-card/60 p-6 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="mt-3 space-y-1">
        {lines.map((l, i) => (
          <li key={i} className="text-sm text-muted-foreground">
            {l}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          size="sm"
          variant="secondary"
          onClick={expand}
          className="gap-1.5"
        >
          <Maximize2 className="h-4 w-4" /> Expandir lista
        </Button>
      </div>
    </div>
  );
}