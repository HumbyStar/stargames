# Corrigir salto de sessão ao abrir/fechar modais

## Problema
Ao clicar em ações que abrem um modal (drawer do cliente, pagamento parcial, revisão IA, etc.) a partir das sessões **MGMV** e **Cobranças**, a página é rolada para a sessão **Clientes**. Ao fechar o modal, o usuário fica preso em Clientes — parecendo que o fechamento mudou de sessão.

## Causa
Nas sessões MGMV e Cobranças, os botões que abrem o drawer/modal do cliente chamam explicitamente `onScrollTo("clientes")` logo após `openClient(...)`. Como o drawer é um Radix Dialog renderizado via portal (nível `body`), ele já aparece sobre qualquer sessão — a rolagem para Clientes é desnecessária e causa o bug relatado.

Ocorrências encontradas:
- `src/sections/mgmv-section.tsx` — botão "Abrir" (linhas ~893-895).
- `src/sections/collection-section.tsx` — dois pontos (linhas ~832-833 e ~993-994).

## Alterações

1. **`src/sections/mgmv-section.tsx`**
   - Remover a chamada `onScrollTo("clientes")` dentro do `onClick` do botão "Abrir". Manter apenas `openClient(r.client.id)`.

2. **`src/sections/collection-section.tsx`**
   - Remover as duas chamadas `onScrollTo("clientes")` que acompanham `openClient(...)` nas ações de abrir o drawer do cliente.

3. **Auditoria rápida das demais sessões**
   - Verificar `clientes-section.tsx` (o botão que vai para `collection` — linha 888 — permanece, pois é um "ver na cobrança" explícito, não um modal).
   - Verificar `dashboard-drilldown-modal.tsx` (`openClientAt` já rola para clientes, mas isso é intencional: é um card do dashboard, não um modal aberto de dentro de uma sessão). Não alterar.
   - Manter `onScrollTo` na assinatura das seções — outras ações legítimas (ex.: "Ver na cobrança") continuam usando.

## Fora de escopo
- Não alterar `scroll-to-section.ts`, o store, nem o comportamento de foco do Radix Dialog.
- Não mexer em lógica de negócio, filtros, paginação ou dados.
- Não alterar o modal de drilldown do dashboard.

## Verificação
- Abrir cada modal a partir de MGMV e Cobranças; confirmar que a sessão ativa permanece a mesma antes/depois de fechar.
- Confirmar que o drawer do cliente ainda abre e fecha normalmente (o portal do Dialog independe da sessão visível).
- `tsgo --noEmit` deve continuar limpo (nenhuma remoção de tipo/prop).