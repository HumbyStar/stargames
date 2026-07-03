import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBRL, displaySituation, type Client, type Product } from "@/lib/store";

interface RetiradoConfirmModalProps {
  open: boolean;
  client: Client | null;
  product: Product | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Popup central obrigatório para a ação "Retirado".
 *
 * Regras (não negociáveis):
 * - clicar fora NÃO confirma;
 * - pressionar Esc NÃO confirma;
 * - só o botão "Confirmar como retirado" executa a ação;
 * - o X do modal e o botão Cancelar fecham SEM alterar nada.
 */
export function RetiradoConfirmModal({
  open,
  client,
  product,
  onCancel,
  onConfirm,
}: RetiradoConfirmModalProps) {
  if (!open || !client || !product) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Fechar apenas via botão X do header (dispara onOpenChange(false)) ou
        // via botões internos. onPointerDownOutside / onEscapeKeyDown estão
        // travados abaixo — este callback só é acionado pelo X ou pelos
        // botões de ação, ambos tratados como "cancelar".
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Confirmar produto retirado?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Confirme apenas se o produto já foi fisicamente retirado da reserva
            deste cliente. Após confirmar, ele sairá da lista ativa do cliente
            e voltará para o estoque central da loja, ficando disponível para
            novo anúncio/venda.
          </p>
          <dl className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Cliente
              </dt>
              <dd className="font-medium">{client.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Produto
              </dt>
              <dd className="font-medium">{product.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Plataforma
              </dt>
              <dd>{product.platform || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Valor
              </dt>
              <dd className="tabular-nums">{formatBRL(product.totalValue)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Situação atual
              </dt>
              <dd>{displaySituation(product.situation)}</dd>
            </div>
          </dl>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Ao confirmar, o produto volta para o estoque central da loja como
            disponível para novo anúncio/venda.
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={onConfirm}>Confirmar como retirado</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}