import { Copy, Sparkles, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Barra de ações em lote dos produtos de um cliente. Compartilhada entre o
 * histórico de produtos individuais (ficha do cliente) e a lista de produtos
 * incluídos no acordo MGMV, para que as ações funcionem igual nos dois lugares.
 *
 * Handlers opcionais simplesmente escondem o botão correspondente.
 */
export function ProductBulkActionsBar({
  selectedCount,
  duplicateCount,
  deleting,
  onCopy,
  onMarkPaid,
  markPaidDisabled,
  markPaidTitle,
  onAddToMgmv,
  addToMgmvDisabled,
  addToMgmvTitle,
  onEnviado,
  onShip,
  shipDisabled,
  shipTitle,
  onRetirar,
  onRemovido,
  onClear,
  onDelete,
  onGerarNf,
}: {
  selectedCount: number;
  duplicateCount: number;
  deleting?: boolean;
  onCopy: () => void;
  onMarkPaid?: () => void;
  markPaidDisabled?: boolean;
  markPaidTitle?: string;
  onAddToMgmv?: () => void;
  addToMgmvDisabled?: boolean;
  addToMgmvTitle?: string;
  onEnviado: () => void;
  onShip?: () => void;
  shipDisabled?: boolean;
  shipTitle?: string;
  onRetirar: () => void;
  onRemovido: () => void;
  onClear: () => void;
  onDelete: () => void;
  onGerarNf: () => void;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{selectedCount} selecionado(s)</span>
      {duplicateCount > 0 && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {duplicateCount} já {duplicateCount > 1 ? "têm" : "tem"} NF
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={onCopy}
          title="Copiar produto - plataforma - total"
        >
          <Copy className="mr-1 h-3.5 w-3.5" />
          Copiar
        </Button>
        {onMarkPaid && (
          <Button
            size="sm"
            variant="outline"
            onClick={onMarkPaid}
            disabled={markPaidDisabled}
            title={markPaidTitle}
          >
            Pago
          </Button>
        )}
        {onAddToMgmv && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAddToMgmv}
            disabled={addToMgmvDisabled}
            title={addToMgmvTitle}
          >
            Adicionar ao acordo
          </Button>
        )}
        {onShip && (
          <Button
            size="sm"
            onClick={onShip}
            disabled={shipDisabled}
            title={shipTitle ?? "Abrir assistente de envio para os produtos selecionados"}
          >
            <Truck className="mr-1 h-3.5 w-3.5" />
            Enviar
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEnviado}>
          Enviado
        </Button>
        <Button size="sm" variant="outline" onClick={onRetirar}>
          Retirar
        </Button>
        <Button size="sm" variant="outline" onClick={onRemovido}>
          Removido
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Limpar
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={deleting}
          onClick={onDelete}
          title="Excluir definitivamente os produtos selecionados (ex.: item duplicado importado por engano)"
        >
          {deleting ? "Excluindo..." : "Excluir"}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={onGerarNf}
          title="Classifica NCM via IA e gera texto pronto para o contador"
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          Gerar Formato NF
        </Button>
      </div>
    </div>
  );
}