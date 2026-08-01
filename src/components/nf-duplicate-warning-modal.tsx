import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DuplicateNfProduct {
  id: string;
  name: string;
  count: number;
  lastAt?: string;
}

interface Props {
  open: boolean;
  duplicates: DuplicateNfProduct[];
  freshCount: number;
  onClose: () => void;
  /** Segue apenas com os produtos que ainda não têm NF. */
  onContinueWithoutDuplicates: () => void;
  /** Força a geração incluindo os produtos já emitidos. */
  onForceAll: () => void;
}

function formatDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

export function NfDuplicateWarningModal({
  open,
  duplicates,
  freshCount,
  onClose,
  onContinueWithoutDuplicates,
  onForceAll,
}: Props) {
  const [confirmingForce, setConfirmingForce] = useState(false);

  useEffect(() => {
    if (!open) setConfirmingForce(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            {confirmingForce
              ? "Confirmar geração duplicada"
              : "Produtos com nota fiscal já emitida"}
          </DialogTitle>
          <DialogDescription>
            {confirmingForce
              ? "Isto vai criar uma segunda nota fiscal para produtos que já foram emitidos. Confirme apenas se tiver certeza."
              : "Os produtos abaixo já tiveram nota fiscal gerada para este cliente e não deveriam receber outra."}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-sm">
          {duplicates.map((p) => {
            const date = formatDate(p.lastAt);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.count} NF{p.count > 1 ? "s" : ""}
                  {date ? ` · última em ${date}` : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          {freshCount > 0
            ? `${freshCount} produto(s) da seleção ainda não têm nota fiscal.`
            : "Nenhum produto elegível sobrou na seleção — todos já têm nota fiscal."}
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {confirmingForce ? (
            <>
              <Button variant="outline" onClick={() => setConfirmingForce(false)}>
                Voltar
              </Button>
              <Button variant="destructive" onClick={onForceAll}>
                Confirmar e gerar duplicado
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                variant="default"
                disabled={freshCount === 0}
                onClick={onContinueWithoutDuplicates}
                title={
                  freshCount === 0
                    ? "Todos os produtos selecionados já têm nota fiscal"
                    : undefined
                }
              >
                Gerar só com os demais
              </Button>
              <Button variant="outline" onClick={() => setConfirmingForce(true)}>
                Gerar mesmo assim
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}