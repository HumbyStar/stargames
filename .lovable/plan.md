## Problema

Nas seções da one-page (Clientes, MGMV, Cobranças), o filtro "Todos" mostra só 10 registros porque cada lista usa `usePaginatedList(..., { step: 10 })` com botão "Carregar mais". Com 490 clientes, o usuário vê 10 e precisa clicar várias vezes — ele considera isso bug e quer que todos os registros apareçam.

## Correção

Remover a paginação client-side em passos de 10 nas três seções e renderizar a lista filtrada inteira de uma vez. As seções já são montadas de forma lazy (`LazySection`) e a expansão da lista já é controlada por `useListExpansionStore`, então não há regressão de performance no carregamento inicial da página.

### Arquivos alterados

1. **`src/sections/clientes-section.tsx`**
   - Remover `usePaginatedList` e `LoadMoreButton` do fluxo de renderização.
   - Iterar direto sobre `rows` (lista filtrada completa) no `<TableBody>`.
   - Remover o bloco `{hasMore && <LoadMoreButton ... />}`.

2. **`src/sections/mgmv-section.tsx`**
   - Mesma mudança: usar `filtered` diretamente em vez de `visible`; remover `LoadMoreButton` e destructuring de `usePaginatedList`.

3. **`src/sections/collection-section.tsx`**
   - Idem: usar `filtered` diretamente; remover `LoadMoreButton` e `usePaginatedList`.

Imports não usados (`usePaginatedList`, `LoadMoreButton`) removidos em cada arquivo.

### Fora do escopo

- `HistoryModal` mantém paginação (é um modal secundário, não a one-page principal).
- Nenhuma mudança em lógica de negócio, filtros, ordenação ou store.
- Nenhuma mudança no backend/queries.

### Verificação

Após a mudança, com filtro "Todos" na seção Clientes os 490 registros devem renderizar todos; idem para MGMV e Cobranças.