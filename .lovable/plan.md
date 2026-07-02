# Plano — Correção de 3 bugs reportados

## BUG-001 — Registrar pagamento parcial em parcela MGMV
**Arquivo:** `src/sections/mgmv-section.tsx`, `src/lib/store.ts`

Hoje só existe "Marcar paga". Falta um caminho manual para valor menor que a parcela.

- Adicionar botão **"Pagamento parcial"** ao lado de "Marcar paga" em cada parcela pendente.
- Ao clicar, abrir um popover pequeno (Input R$ + Confirmar) que chama uma nova ação `registerPartialPayment(clientId, installmentNumber, amount, date?)` no store.
- Regras da ação:
  - Se `amount >= installment.value`: comporta como `payMGMVInstallment` (marca paga integralmente) e o excedente vira `nextInstallmentDiscount` reduzindo `value` da próxima parcela pendente (reutiliza a lógica já existente em `mgmv-ai-apply`).
  - Se `0 < amount < installment.value`: grava `paidAmount = amount` na parcela (mantém `paid=false`), atualiza `paidAt` opcionalmente, e recalcula `remainingValue` do acordo (a soma parcial já é considerada em `mgmv-section` linhas 72-81).
  - Chama `recalcPendingDueDates` para deslocar vencimentos das próximas parcelas 30 dias após o último pagamento efetivo (parcial conta como marco temporal).
- Exibir na UI (célula da parcela) o texto `(parcial R$ X)` que já existe (linha 701-705) — apenas garantir que o cabeçalho do acordo mostre "Saldo restante" descontando o parcial.
- Persistir via `updateMGMVInstallment` no Supabase (campo `paid_amount` já existe conforme contexto anterior).

## BUG-002 — Criar acordo MGMV a partir do cliente/reserva
**Arquivos:** `src/sections/clientes-section.tsx` (ação por cliente), novo `src/components/mgmv-create-modal.tsx`, `src/lib/store.ts`.

Hoje só existe MGMV via importação. Adicionar criação manual.

- **Ponto de entrada:** botão **"Criar acordo MGMV"** no cabeçalho do card de cliente expandido em `clientes-section` (visível quando o cliente NÃO tem `mgmv.active`). Também botão no rodapé de itens em Reserva que abre o mesmo modal já com o produto pré-selecionado.
- **Modal `MgmvCreateModal`** com formulário:
  - Lista de produtos do cliente (checkbox multi-select) — mostra Total/Pago/Restante por linha.
  - Valor total do acordo (auto-calculado = soma dos restantes; editável).
  - Entrada opcional (R$).
  - Nº de parcelas (input numérico ≥ 2).
  - Dia de vencimento (1-31) + data da 1ª parcela.
  - Preview do cronograma gerado (parcela × valor × vencimento).
- **Store — nova ação `createMGMVAgreement(clientId, config)`**:
  - Marca `clientType = "mgmv"`.
  - Gera `installments[]` com `paid=false`, `value = (total - entrada)/n`.
  - Se houver entrada, cria uma parcela `#0` já paga OU aplica como `nextInstallmentDiscount` na 1ª — usar o padrão já existente em `mgmv-ai-apply` para consistência.
  - Vincula os produtos escolhidos ao acordo (marca `includedInMgmv=true` — usar mesmo flag já usado na exibição "Incluído no MGMV").
  - Persiste no Supabase via `upsertMGMV`/`persistConfirmedImport` existentes.
- Toast de sucesso + rolagem para a seção MGMV com o cliente já expandido.

## BUG-004 — Filtro por Situação no preview da importação
**Arquivo:** `src/sections/import-section.tsx` (função `PreviewVirtualTable`, linhas ~2700-2850).

Hoje há chips por status financeiro/categoria, mas não por **Situação** (Em Aberto / Enviado / Retirado / Retirar / Removido / Desistiu / Abandonou).

- Estender o tipo `PreviewFilter` com `sit_open | sit_enviado | sit_retirado | sit_retirar | sit_removido | sit_desistiu | sit_abandonou`.
- Adicionar novo grupo de chips **"Situação:"** abaixo dos chips atuais (mesma estética), utilizando os buckets oficiais do `situation-normalizer`.
- No `filteredRows`, comparar contra `r.situation`.
- Contador ao lado de cada chip (ex.: `Enviado (12)`) para dar o benefício operacional citado no relatório.
- Persistir a seleção no mesmo `usePersistedState("import.preview.filter", ...)` já existente.

## Notas técnicas
- Nada muda em `import-cards.tsx`, `list-import-modal.tsx`, ou nos parsers — apenas UI de preview.
- BUG-001 e BUG-002 reutilizam `recalcPendingDueDates` e `mgmv-ai-apply` para não duplicar regras de cronograma.
- Todas as ações novas passam pelas mesmas funções `updateClient`/`upsertMGMV` já persistidas via server functions, mantendo RLS.

## Verificação
- `bunx vitest run src/lib/store.test.ts` (extender com casos de partial payment e create agreement).
- Playwright: fluxo manual criar acordo, registrar parcial, filtrar Situação=Enviado no preview.
