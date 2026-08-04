import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { formatBRL, type MGMVAgreement, type Product } from "@/lib/store";

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

/**
 * Faixa de aviso exibida quando todas as parcelas do acordo estão pagas e a
 * quitação ainda não foi confirmada.
 */
export function MgmvFullyPaidBanner({
  onReview,
  onComplete,
}: {
  onReview: () => void;
  onComplete: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">
      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      <div className="flex-1 min-w-[200px]">
        <div className="font-semibold text-emerald-700 dark:text-emerald-400">
          Todas as parcelas foram pagas
        </div>
        <div className="text-muted-foreground">
          Deseja incluir os produtos do MGMV como pagos em aberto e encerrar o
          acordo? Se alguma parcela foi marcada por engano, revise antes.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onReview}>
          Revisar parcelas
        </Button>
        <Button size="sm" onClick={onComplete}>
          Concluir MGMV
        </Button>
      </div>
    </div>
  );
}

interface CompleteModalProps {
  open: boolean;
  clientName: string;
  agreement: MGMVAgreement;
  /** Produtos atualmente incluídos no acordo (financialStatus === "MGMV"). */
  products: Product[];
  onClose: () => void;
  /** Abre o editor de parcelas para revisão. */
  onReview: () => void;
  onConfirm: () => void;
  /** Classe extra do conteúdo (usada para elevar o z-index sobre a ficha). */
  contentClassName?: string;
}

/**
 * Janela de confirmação de quitação do acordo MGMV. Resume o acordo, lista os
 * produtos que virarão individuais (Pago / Em Aberto) e oferece a opção de
 * revisar as parcelas antes de concluir.
 */
export function MgmvCompleteModal({
  open,
  clientName,
  agreement,
  products,
  onClose,
  onReview,
  onConfirm,
  contentClassName,
}: CompleteModalProps) {
  const paidCount = agreement.installments.filter((i) => i.paid).length;
  const paidValue = agreement.installments
    .filter((i) => i.paid)
    .reduce((s, i) => s + (i.paidAmount ?? i.value ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={`max-w-lg ${contentClassName ?? ""}`}
        overlayClassName="z-[95]"
        hideClose
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Concluir MGMV — {clientName}
          </DialogTitle>
          <DialogDescription>
            Todas as parcelas deste acordo estão marcadas como pagas. Confirme
            para encerrar o programa MGMV deste cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">Total do acordo</div>
            <div className="tabular-nums font-semibold">
              {formatBRL(agreement.totalDebt)}
            </div>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">Parcelas pagas</div>
            <div className="tabular-nums font-semibold">
              {paidCount}/{agreement.installments.length}
            </div>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <div className="text-muted-foreground">Valor pago</div>
            <div className="tabular-nums font-semibold">{formatBRL(paidValue)}</div>
          </div>
        </div>

        <div className="mt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
            Parcelas ({agreement.installments.length})
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {[...agreement.installments]
              .sort((a, b) => a.number - b.number)
              .map((i) => (
                <div
                  key={i.number}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1 text-xs"
                >
                  <span className="w-12 shrink-0 font-medium tabular-nums">
                    {i.number}/{agreement.installments.length}
                  </span>
                  <span className="flex-1 text-muted-foreground">
                    venc. {formatDate(i.dueDate)}
                    {i.paid ? ` · pago em ${formatDate(i.paidAt ?? i.dueDate)}` : ""}
                  </span>
                  <span className="w-20 text-right tabular-nums">
                    {formatBRL(i.paidAmount ?? i.value ?? 0)}
                  </span>
                  <span
                    className={
                      i.paid
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }
                  >
                    {i.paid ? "Pago" : "Pendente"}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="mt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
            Produtos inclusos ({products.length})
          </div>
          {products.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-xs text-muted-foreground">
              Nenhum produto vinculado ao acordo.
            </div>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {products.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1 text-xs"
                >
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.platform}</span>
                  <span className="text-muted-foreground">MGMV → Pago / Em Aberto</span>
                  <span className="w-20 text-right tabular-nums">
                    {formatBRL(p.totalValue)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Ao confirmar, os produtos acima passam a ser individuais com status{" "}
            <strong>Pago</strong> e situação <strong>Em Aberto</strong> (itens já
            enviados, retirados ou removidos mantêm a situação atual). O cliente
            sai do programa MGMV e o acordo fica arquivado como quitado.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onReview}>
            Revisar parcelas
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onConfirm}>Confirmar quitação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}