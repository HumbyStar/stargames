import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Estado vazio das listas da one-page enquanto nenhum filtro está aplicado.
 * Evita ler/renderizar a base inteira sem necessidade (menos consulta ao
 * banco) e deixa explícito o próximo passo para o usuário.
 */
export function FilterEmptyState({
  className,
  hint = "Escolha um filtro acima ou busque por nome, telefone ou produto.",
}: {
  className?: string;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 grid place-items-center rounded-md bg-background/55 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Filter className="size-5" />
        </span>
        <p className="text-sm font-medium text-foreground">
          Aplique o filtro desejado a consulta.
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
