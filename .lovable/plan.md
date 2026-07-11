## Objetivo

Ao registrar um pagamento parcial (valor menor que o da parcela) em uma parcela MGMV, **não alterar o `value` original da parcela alvo**. Apenas as demais parcelas pendentes devem ter seus valores recalculados. A parcela alvo mantém o valor original exibido e passa a mostrar apenas o "pago parcial" (`paidAmount`) — evitando a confusão de ver o valor da parcela mudar bem embaixo da ação que o usuário acabou de tomar.

O comportamento do pagamento total/excedente (parcela quitada) já está correto e não muda.

## Mudança em `src/lib/store.ts` (branch `else`, ~linhas 682–733)

Regra nova para o pagamento parcial (`amount < target.value`):

- `target.value` permanece **inalterado** (valor original).
- `target.paidAmount = paidPartialTargetNew` (acumula o parcial pago).
- `target.manualPartial = true`, `target.paidAt = nowIso`.
- Saldo remanescente do acordo continua sendo `newRemainingCents` (o que a UI já usa para calcular "restante do acordo").
- A contribuição da alvo para esse saldo passa a ser `target.value - paidPartialTargetNew` (a "falta" da própria alvo, que ela ainda deve).
- O restante — `distributeAcrossOthersCents = newRemainingCents − (target.value − paidPartialTargetNew)*100` — é rateado igualmente entre as **outras** parcelas pendentes (mesma lógica de `base`/`rest` já usada), preservando arredondamento por centavos.
- Se não houver outras pendentes, apenas grava o `paidAmount` na alvo (sem mexer no `value`).

## Efeitos colaterais / verificações

- `installmentPaidAmount`, `productCollectionStatus`, `mgmvSummary` e o popover de prévia continuam corretos: eles já somam `paidAmount` das pendentes ao calcular restante; como o novo `value` da alvo agora é o original, `value - paidAmount` reflete corretamente o que ainda falta na alvo.
- A prévia no `mgmv-partial-payment-popover.tsx` (`nextPerInstallment = nextRemaining / pendingCount`) fica **aproximada** (média incluindo a alvo). Ajuste opcional para bater com a realidade: mostrar rateio apenas entre as `othersCount = pendingCount - 1` pendentes restantes, exibindo a alvo separadamente ("parcela atual mantém {valor original}, restante em N× ..."). Incluído no plano.
- Sem mudanças em migrações, testes existentes de `store.test.ts` (não cobrem esta branch) e sem mudanças em UI de listagem — a tabela de parcelas já lê `value`/`paidAmount` de cada linha.

## Fora do escopo

- Comportamento quando `amount >= target.value` (parcela quitada + excedente redistribuído) fica como está.
- Nenhuma alteração de schema, RLS ou server functions.
