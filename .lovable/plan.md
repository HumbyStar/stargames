## Objetivo

Corrigir o pagamento parcial MGMV quando o valor recebido é MENOR que o valor da parcela: em vez de redistribuir o saldo total do acordo (que causa desconto nas demais em sequências de parciais), o "que sobrou da parcela" (`value − amount`) deve ser SOMADO às outras pendentes, e a parcela alvo passa a ser marcada como PAGA com quitação curta (`paidAmount = amount`, `value` original preservado como histórico).

O comportamento para pagamento IGUAL ou MAIOR ao valor da parcela permanece igual.

## Regras novas para parcial < value

1. Parcela alvo:
   - `paid = true`
   - `paidAt = agora`
   - `paidAmount = amount` (o efetivamente recebido; menor que `value`)
   - `value` original é preservado (para histórico/exibição)
   - marcar `manualPartial = true` e um novo flag `shortPaid = true` para a UI mostrar "Paga (parcial curto)"

2. Outras parcelas pendentes:
   - shortfall = `target.value − amount`
   - `addPerOther = shortfall / N` (N = outras pendentes)
   - `newValue = other.value + addPerOther` (SEMPRE cresce; nunca discount)
   - piso `paidAmount` já existente é preservado
   - marcar `recalculatedAt = agora` quando `value` muda
   - centavos: distribuir resto na última pendente

3. Se não houver outras pendentes:
   - alvo vira `paid=true` com `paidAmount = amount` e o acordo é quitado curto — sem redistribuição.

4. Validações mantidas: `amount` numérico > 0 e ≤ saldo do acordo; parcela existe e não está paga; sem valores negativos.

## Preview no popover

Ajustar o texto para pagamento parcial < value:

> "Pagamento parcial de R$ X registrado. Parcela #N marcada como paga (quitação curta de R$ X sobre R$ V). O restante R$ (V−X) é somado às outras Y parcelas pendentes, ficando Y× R$ Z."

Para pagamento ≥ value o texto atual continua.

## UI — indicadores

- Nas tabelas de parcelas (`clientes-section.tsx`, `mgmv-section.tsx`): quando `shortPaid=true`, mostrar tag "Paga (parcial curto)" ao lado do número da parcela, com tooltip explicando que foi quitada com valor inferior e o restante foi redistribuído.
- Manter a tag "Recalculada" nas pendentes com `recalculatedAt`.

## Testes (store.test.ts)

Ajustar/adicionar em `describe("applyMGMVPartialPayment")`:

1. Substituir o teste "pagamento parcial MENOR" atual: agora deve esperar
   - target `paid=true`, `paidAmount=40`, `value=100` preservado, `shortPaid=true`
   - outras 3 pendentes: `value=100 + 60/3 = 120` (aumentaram)
   - `recalculatedAt` em todas as outras

2. Novo teste — sequência de parciais inferiores nunca gera desconto:
   - Parcelas [100,100,100,100], saldo 400
   - Pagar 40 na #2 → #1,#3,#4 = 120 cada; #2 paid curto
   - Pagar 30 na #3 (value=120) → shortfall=90, outras pendentes #1,#4: 120+45 = 165 cada; #3 paid curto
   - Validar que nenhum `value` das outras diminuiu em relação ao estado anterior
   - Validar `becameQuitado=false` até que todas paguem

3. Novo teste — piso do paidAmount preexistente continua respeitado (não usa mais o cenário antigo de saldo negativo com o mesmo formato; adaptar para o novo modelo).

4. Manter testes de "IGUAL" e "MAIOR" (comportamento não muda).

5. Manter testes de validação (NaN, 0, negativo, excede saldo, parcela inexistente/paga).

## Arquivos

- `src/lib/store.ts` — reescrever branch `!targetFullyPaid` de `applyMGMVPartialPayment`; adicionar campo `shortPaid?: boolean` em `MGMVInstallment`.
- `src/lib/store.test.ts` — atualizar/adicionar testes acima.
- `src/components/mgmv-partial-payment-popover.tsx` — atualizar mensagem de preview do caso parcial < value.
- `src/sections/clientes-section.tsx` e `src/sections/mgmv-section.tsx` — renderizar tag "Paga (parcial curto)" quando `shortPaid`.

## Validação

Rodar `bunx vitest run src/lib/store.test.ts` e revisar visualmente o popover + tabelas na preview.
