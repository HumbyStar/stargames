## Objetivo

No card "Histórico de Produtos" (drawer do cliente), exibir um **badge "NF emitida"** em cada produto que já apareceu em alguma nota fiscal salva no histórico daquele cliente.

## Como funciona

1. Ao abrir o drawer do cliente, buscar o histórico de NFs via `listNfInvoices({ clientId })` (já existente em `src/lib/nf-history.functions.ts`).
2. Construir um `Set<string>` com todos os `productIds` de todas as notas retornadas → indica quais produtos já foram faturados.
3. Renderizar um badge discreto ao lado do nome do produto na coluna **Produto** da tabela (em `src/sections/clientes-section.tsx` e também no `mgmv-section.tsx` para os produtos individuais lá listados).
4. Badge com tooltip mostrando a quantidade de NFs em que o produto aparece e a data da mais recente.
5. Atualizar automaticamente após confirmar uma nova nota no `NfFormatModal` (invalidar/refetch da lista de invoices ao fechar).

## Detalhes técnicos

- Novo hook local no drawer: `useClientNfInvoices(clientId)` usando `useQuery` com `queryKey: ["nf-invoices", clientId]`.
- Derivar `nfProductMap: Map<productId, { count: number; lastAt: string }>`.
- Componente `<NfEmittedBadge info={...} />` (Badge shadcn variante `secondary`, ícone `FileText`, texto "NF" — tooltip com "N nota(s) · última em dd/mm/aaaa").
- Ao `saveNfInvoice` bem-sucedido em `nf-format-modal.tsx`, propagar callback `onSaved` para o pai invalidar `["nf-invoices", clientId]` (já existe fluxo similar; adicionar `queryClient.invalidateQueries`).
- Sem mudança de schema — a tabela `nf_invoices.product_ids` já guarda o vínculo.
- Sem alteração em regras de negócio; apenas leitura + UI.

## Arquivos afetados

- `src/sections/clientes-section.tsx` — fetch dos invoices, badge na coluna Produto.
- `src/sections/mgmv-section.tsx` — mesmo badge, se a tabela de produtos individuais estiver visível.
- `src/components/nf-format-modal.tsx` — invalidar cache após "Confirmar Nota".
- Novo: `src/components/nf-emitted-badge.tsx` (componente pequeno reutilizável).
