## Objetivo

Na importação por lista colada (inclusive com revisão por IA), quando um telefone da lista já existir em um cliente cadastrado **com nome diferente** (ex.: `2tt` no banco vs `2tt@` na lista), mostrar uma etapa de confirmação perguntando se é o mesmo cliente e se o nome deve ser **atualizado** ou **mantido**.

## Comportamento

1. Ao clicar em importar, antes de gravar, o sistema compara cada linha com o cliente existente pelo telefone (só dígitos).
2. Se o nome for diferente (ignorando maiúsculas, acentos, espaços e símbolos como `@`, `.`, `-`), a linha entra numa lista de "mesmo número, nome diferente".
3. Abre um modal **"Clientes com o mesmo número"** listando, para cada caso:
   - telefone
   - nome atual no sistema
   - nome que veio na lista
   - escolha por linha: **Manter nome atual** (padrão) ou **Atualizar para o nome novo**
   - atalhos no topo: "Manter todos" / "Atualizar todos"
4. Ao confirmar, a importação segue: produtos vão para o cliente existente e, nos casos marcados como "atualizar", o nome do cliente é renomeado no banco.
5. Se não houver conflito de nome, nada muda no fluxo atual.
6. Esse modal aparece antes do modal de duplicidade de produtos já existente (primeiro identidade do cliente, depois duplicidade de produto), sem alterar aquele comportamento.

## Detalhes técnicos

- `src/components/list-import-modal.tsx`
  - Novo estado `nameConflicts` (telefone, clientId, nome atual, nome novo, decisão) calculado dentro de `persist()` via `findClientByPhone`, antes da checagem de duplicidade de produto.
  - Novo modal de conciliação; ao confirmar, guarda um `Map<phone, "keep" | "update">` e chama a checagem de duplicidade / `runPersist`.
  - Em `runPersist`, quando a decisão for `update`, chamar `updateClient(clientId, { name: r.clientName })` (já existe na store) uma única vez por telefone; quando for `keep`, apenas reutilizar o cliente como hoje.
  - Normalizador de nome dedicado (remove acentos, pontuação e espaços extras) para não acusar conflito por diferença irrelevante de caixa/espaço.
- Sem migração de banco: `updateClient` já persiste via sync existente.
