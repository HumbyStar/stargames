import { ChevronDown } from "lucide-react";

/**
 * Botão "Carregar mais" centralizado com efeito glow moderno.
 * Compartilhado entre Clientes e Collection para manter visual consistente.
 */
export function LoadMoreButton({
  count,
  onClick,
  label = "Carregar mais",
}: {
  count: number;
  onClick: () => void;
  label?: string;
}) {
  return (
    <div className="flex w-full justify-center py-2">
      <button
        type="button"
        onClick={onClick}
        className="group relative inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all duration-300 hover:scale-[1.03] hover:shadow-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-primary opacity-40 blur-xl transition-opacity duration-300 group-hover:opacity-80"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-primary/0 via-primary to-primary/0 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-70"
        />
        {label} +{count}
        <ChevronDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
      </button>
    </div>
  );
}