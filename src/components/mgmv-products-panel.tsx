import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  formatBRL,
  useStore,
  type Client,
  type Product,
  type Situation,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { Tag } from "@/components/ui-bits";
import { productStatusTone } from "@/lib/status-tone";
import { NfEmittedBadge } from "@/components/nf-emitted-badge";
import { ProductBulkActionsBar } from "@/components/product-bulk-actions";
import { RetiradoConfirmModal } from "@/components/retirado-confirm-modal";
import { NfFormatModal } from "@/components/nf-format-modal";
import {
  NfDuplicateWarningModal,
  type DuplicateNfProduct,
} from "@/components/nf-duplicate-warning-modal";

/**
 * Lista de produtos incluídos no acordo MGMV com as MESMAS ações dos produtos
 * individuais: seleção múltipla, Enviado, Retirar/Retirado (com popup
 * obrigatório), Removido, exclusão definitiva e geração de NF (com aviso de
 * duplicidade).
 *
 * A ação "Pago" não é oferecida aqui: o status financeiro de um produto MGMV
 * só muda ao concluir o acordo.
 */
export function MgmvProductsPanel({
  client,
  products,
  nfProductMap,
  onNfSaved,
}: {
  client: Client;
  products: Product[];
  nfProductMap: Map<string, { count: number; lastAt: string }>;
  onNfSaved?: () => void;
}) {
  const setProductSituation = useStore((s) => s.setProductSituation);
  const deleteProducts = useStore((s) => s.deleteProducts);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [retiradoQueue, setRetiradoQueue] = useState<Product[]>([]);
  const [nfModalOpen, setNfModalOpen] = useState(false);
  const [nfProducts, setNfProducts] = useState<Product[]>([]);
  const [nfWarnOpen, setNfWarnOpen] = useState(false);
  const [nfPendingSelection, setNfPendingSelection] = useState<Product[]>([]);

  const selectedCount = selectedIds.size;
  const allSelected = products.length > 0 && selectedCount === products.length;
  const selectedProducts = () => products.filter((p) => selectedIds.has(p.id));
  const clearSelection = () => setSelectedIds(new Set());
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(products.map((p) => p.id)));

  const selectedDuplicates = useMemo<DuplicateNfProduct[]>(
    () =>
      products
        .filter((p) => selectedIds.has(p.id) && nfProductMap.has(p.id))
        .map((p) => {
          const info = nfProductMap.get(p.id)!;
          return { id: p.id, name: p.name, count: info.count, lastAt: info.lastAt };
        }),
    [products, selectedIds, nfProductMap],
  );

  const openNfModalWith = (list: Product[]) => {
    setNfProducts(list);
    setNfModalOpen(true);
  };

  const handleGerarNf = () => {
    const sel = selectedProducts();
    if (sel.length === 0) {
      toast.info("Selecione ao menos 1 produto");
      return;
    }
    if (selectedDuplicates.length === 0) {
      openNfModalWith(sel);
      return;
    }
    setNfPendingSelection(sel);
    setNfWarnOpen(true);
  };

  const bulkChangeSituation = (situation: Situation, confirmMsg: string) => {
    const targets = selectedProducts();
    if (targets.length === 0) return;
    if (!window.confirm(confirmMsg)) return;
    targets.forEach((p) => setProductSituation(p.id, situation));
    toast.success(`${targets.length} produto(s) atualizados`);
    clearSelection();
  };

  const bulkCopy = async () => {
    const targets = selectedProducts();
    if (targets.length === 0) return;
    const text = targets
      .map((p) => `${p.name} - ${p.platform} - ${formatBRL(p.totalValue)}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${targets.length} produto(s) copiado(s)`);
    } catch {
      toast.error("Não foi possível copiar para a área de transferência");
    }
  };

  const bulkDelete = async () => {
    const targets = selectedProducts();
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `Excluir definitivamente ${targets.length} produto(s) selecionado(s)?\n\n` +
          targets.map((p) => `• ${p.name} — ${formatBRL(p.totalValue)}`).join("\n") +
          "\n\nEsta ação não pode ser desfeita.",
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteProducts(targets.map((p) => p.id));
      toast.success(`${targets.length} produto(s) excluído(s)`);
      clearSelection();
    } catch {
      toast.error("Não foi possível excluir os produtos");
    } finally {
      setDeleting(false);
    }
  };

  const retiradoCurrent = retiradoQueue[0] ?? null;

  return (
    <div>
      <ProductBulkActionsBar
        selectedCount={selectedCount}
        duplicateCount={selectedDuplicates.length}
        deleting={deleting}
        onCopy={() => void bulkCopy()}
        onEnviado={() =>
          bulkChangeSituation(
            "Enviado",
            `Marcar ${selectedCount} produto(s) selecionado(s) como Enviado?`,
          )
        }
        onRetirar={() =>
          bulkChangeSituation(
            "Retirar",
            `Marcar ${selectedCount} produto(s) selecionado(s) para retirada?\n\nEles continuam vinculados ao cliente, mas ficam pendentes de retirada.`,
          )
        }
        onRemovido={() =>
          bulkChangeSituation(
            "Removido",
            `Marcar ${selectedCount} produto(s) selecionado(s) como Removido?\n\nEles saem da lista ativa do cliente.`,
          )
        }
        onClear={clearSelection}
        onDelete={() => void bulkDelete()}
        onGerarNf={handleGerarNf}
      />

      {products.length > 0 && (
        <label className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Selecionar todos os produtos do MGMV"
            className="h-3.5 w-3.5 cursor-pointer"
            checked={allSelected}
            onChange={toggleAll}
          />
          Selecionar todos
        </label>
      )}

      <div className="space-y-1 text-xs">
        {products.length === 0 && (
          <p className="text-muted-foreground">Nenhum produto vinculado.</p>
        )}
        {products.map((p) => {
          const info = nfProductMap.get(p.id);
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-2 rounded-md border border-border/60 px-2 py-1",
                productStatusTone(p) || "bg-card",
              )}
            >
              <input
                type="checkbox"
                aria-label={`Selecionar ${p.name}`}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                checked={selectedIds.has(p.id)}
                onChange={() => toggleOne(p.id)}
              />
              <span className="inline-flex min-w-0 flex-1 items-center truncate font-medium">
                {p.name}
                {info && <NfEmittedBadge count={info.count} lastAt={info.lastAt} />}
              </span>
              <span className="text-muted-foreground">{p.platform}</span>
              <span>{formatBRL(p.totalValue)}</span>
              <Tag variant="neutral">{p.situation}</Tag>
              <Tag variant="primary">Incluído no MGMV</Tag>
              <button
                type="button"
                className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60"
                onClick={() => setRetiradoQueue([p])}
              >
                Retirado
              </button>
            </div>
          );
        })}
      </div>

      <RetiradoConfirmModal
        open={!!retiradoCurrent}
        client={client}
        product={retiradoCurrent}
        onCancel={() => setRetiradoQueue([])}
        onConfirm={() => {
          if (retiradoCurrent) {
            setProductSituation(retiradoCurrent.id, "Retirado");
            toast.success("Produto retirado — enviado ao estoque central da loja.");
          }
          setRetiradoQueue([]);
        }}
      />

      <NfDuplicateWarningModal
        open={nfWarnOpen}
        duplicates={selectedDuplicates}
        freshCount={nfPendingSelection.filter((p) => !nfProductMap.has(p.id)).length}
        onClose={() => setNfWarnOpen(false)}
        onContinueWithoutDuplicates={() => {
          setNfWarnOpen(false);
          openNfModalWith(nfPendingSelection.filter((p) => !nfProductMap.has(p.id)));
        }}
        onForceAll={() => {
          setNfWarnOpen(false);
          openNfModalWith(nfPendingSelection);
        }}
      />
      <NfFormatModal
        open={nfModalOpen}
        onClose={() => setNfModalOpen(false)}
        onSaved={() => onNfSaved?.()}
        client={client}
        products={nfProducts.map((p) => ({
          id: p.id,
          name: p.name,
          platform: p.platform ?? "",
          totalValue: p.totalValue,
        }))}
      />
    </div>
  );
}