## Problema

Quando o usuário digita um valor **maior que a parcela** (mas ≤ saldo), o store já quita a parcela e redistribui o excedente entre TODAS as parcelas pendentes restantes (não apenas a próxima) — a lógica em `src/lib/store.ts` linhas 656-680 usa `otherPending` (todas menos a alvo) e rateia `newRemainingCents` uniformemente com ajuste de centavo no último.

O que está errado é apenas a **mensagem de prévia** no popover, que ainda diz:

> "Parcela marcada como paga · excedente R$ 18,76 abatido da próxima parcela."

Isso contradiz o comportamento real e o padrão já usado no ramo parcial (`< valor da parcela`), que mostra a redistribuição em N× R$ Y.

## Alteração

### `src/components/mgmv-partial-payment-popover.tsx` — bloco `preview` (kind `"full"`)

Alinhar a mensagem ao ramo `"partial"`, calculando:

- `nextRemaining = max(0, agreementRemaining - parsed)`
- `othersCount = max(0, pendingCount - 1)` (exclui a parcela alvo, que ficará paga)
- `nextPerOther = othersCount > 0 ? nextRemaining / othersCount : 0`

Mensagens:

- `othersCount === 0` (era a última pendente) → `"Parcela marcada como paga · acordo quitado."`
- `othersCount > 0` e `surplus === 0` (pagamento exato) → `"Parcela marcada como paga · restante do acordo ${nextRemaining} em ${othersCount}× ${nextPerOther}."`
- `othersCount > 0` e `surplus > 0` → `"Parcela marcada como paga · excedente ${surplus} redistribuído · restante do acordo ${nextRemaining} em ${othersCount}× ${nextPerOther}."`

Nenhuma mudança em `src/lib/store.ts` (comportamento já correto) nem no `clientes-section.tsx`/`mgmv-section.tsx`.

## Validação

- Cenário do print (parcela R$ 181,24, pago R$ 200, 15 pendentes, saldo ~R$ 3.199,90):
  - surplus = R$ 18,76
  - nextRemaining = R$ 2.999,90
  - othersCount = 14 → nextPerOther ≈ R$ 214,28
  - Prévia: "Parcela marcada como paga · excedente R$ 18,76 redistribuído · restante do acordo R$ 2.999,90 em 14× R$ 214,28."
- `bunx tsgo --noEmit` deve continuar passando.

## Fora de escopo

- Lógica de redistribuição em `store.ts` (já correta).
- Ramo parcial (`< valor da parcela`), botões Marcar/Parcial e demais telas.
