## Ajuste

Reverter os 5 botões da linha da tabela principal de Clientes e mover a interação para dentro do **modal do cliente**, com **seleção múltipla** de produtos.

## Mudanças

### 1. `src/sections/clientes-section.tsx` — linha do cliente (tabela principal)

Remover o bloco `{(() => { const openProducts = ... })()}` que adicionei (Pago/Enviado/Retirar/Removido em lote). A célula de ações volta ao estado anterior: `[lápis] [Abrir] [+ Produto] [Cobrança?]`.

### 2. `src/sections/clientes-section.tsx` — `ClientDrawer` (modal do cliente)

Na tabela de produtos individuais do cliente:

- **Nova coluna de checkbox** (primeira coluna) em cada linha (`individualProducts`), com estado local `selectedIds: Set<string>` no `ClientDrawer`.
- **Checkbox no header** funciona como "selecionar todos" / "desmarcar todos" (indeterminate quando parcial).
- **Barra de ações em lote** acima da tabela (só aparece quando `selectedIds.size > 0`), com contador "N selecionado(s)" e 4 botões:
  - **Pago** → para cada selecionado com `financialStatus !== "Pago"` → `updateProduct(id, { paidValue: totalValue, financialStatus: "Pago" })`. Após: `setSelectedIds(new Set())`, toast "N produto(s) marcados como pagos".
  - **Enviado** → `window.confirm(...)` → `setProductSituation(id, "Enviado")` em cada selecionado (aplica em todos, independente da situação atual — permite corrigir engano).
  - **Retirar** → `window.confirm(...)` → `setProductSituation(id, "Retirar")` em cada selecionado.
  - **Removido** → `window.confirm(...)` → `setProductSituation(id, "Removido")` em cada selecionado.
- **Remover os botões por linha** que adicionei antes (Pago / Enviado / Retirar / Removido). A coluna Ações da linha mantém apenas o **lápis** (`RowEditPencil`) para edição inline dos campos do produto (nome/plataforma/valores), que continua sendo por linha por natureza.
- IDs que somem da lista após a ação (produto vira Removido/Retirado e sai de `individualProducts`) são removidos do `selectedIds` via efeito de sincronização baseado nos ids atuais.

### Handlers

Reaproveitam os já disponíveis via props do drawer: `onMarkPaid` (para Pago), `onChangeSituation` (para Enviado/Retirar/Removido). Não altera store nem tipos.

## Verificação

1. Tabela principal de Clientes: linha volta a ter só [lápis] [Abrir] [+ Produto].
2. Abrir modal do cliente: cada produto tem checkbox; header seleciona todos.
3. Selecionar 3 produtos → barra "3 selecionado(s)" aparece com 4 botões.
4. Clicar "Pago" → 3 viram Pago, seleção limpa, toast confirma.
5. Selecionar 2 → "Removido" com confirm → 2 saem da tabela ativa e vão para "Histórico de produtos retirados"; seleção limpa.
6. Nenhum selecionado → barra de ações escondida; só o lápis por linha para edição inline.

## Arquivos afetados

- `src/sections/clientes-section.tsx` — apenas.
