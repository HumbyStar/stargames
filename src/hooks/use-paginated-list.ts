import { useEffect, useState } from "react";
import { useUiStore } from "@/lib/ui-store";

/**
 * Paginação client-side em passos fixos (padrão 10).
 *
 * - Começa mostrando `step` itens.
 * - `loadMore()` soma +step até esgotar `items`.
 * - Reseta automaticamente quando o tamanho de `items` muda
 *   (ex.: aplicação de filtros/busca) ou quando o usuário sai da
 *   seção informada em `sectionId` — ao voltar para a seção a lista
 *   reaparece com apenas `step` itens, garantindo carregamento leve.
 */
export function usePaginatedList<T>(
  items: T[],
  opts: { step?: number; sectionId?: string } = {},
) {
  const step = opts.step ?? 10;
  const sectionId = opts.sectionId;
  const activeSection = useUiStore((s) => s.activeSection);
  const [count, setCount] = useState(step);

  // Reset quando o conteúdo/tamanho da lista muda.
  useEffect(() => {
    setCount(step);
  }, [items.length, step]);

  // Reset ao sair da seção — ao voltar, volta ao passo inicial.
  useEffect(() => {
    if (sectionId && activeSection !== sectionId) {
      setCount(step);
    }
  }, [activeSection, sectionId, step]);

  const total = items.length;
  const visible = count >= total ? items : items.slice(0, count);
  const hasMore = count < total;
  const remaining = Math.max(0, total - count);
  const nextChunk = Math.min(step, remaining);
  const loadMore = () => setCount((c) => Math.min(c + step, total));
  const reset = () => setCount(step);

  return { visible, hasMore, remaining, nextChunk, loadMore, reset, total };
}