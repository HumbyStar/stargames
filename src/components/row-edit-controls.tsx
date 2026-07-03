import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ícone-lápis para iniciar a edição de uma linha da tabela operacional.
 * Não altera valores; apenas abre o modo edição via `onStart`.
 */
export function RowEditPencil({
  onStart,
  className,
  label = "Editar linha",
  disabled = false,
}: {
  onStart: () => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn("h-8 w-8", className)}
      title={label}
      aria-label={label}
      onClick={onStart}
      disabled={disabled}
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}

/**
 * Botões Confirmar / Fechar do modo edição de linha. Só o Confirmar salva;
 * Fechar descarta as alterações. Clique fora nunca dispara nenhum dos dois.
 */
export function RowEditActions({
  onConfirm,
  onClose,
  confirmLabel = "Confirmar",
  closeLabel = "Fechar",
  saving = false,
  className,
}: {
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel?: string;
  closeLabel?: string;
  saving?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Button
        type="button"
        size="sm"
        onClick={onConfirm}
        disabled={saving}
        className="gap-1"
      >
        <Check className="h-4 w-4" /> {confirmLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onClose}
        disabled={saving}
        className="gap-1"
      >
        <X className="h-4 w-4" /> {closeLabel}
      </Button>
    </div>
  );
}