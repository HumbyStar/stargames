## Objetivo

Ajustar pagamento parcial MGMV para:

1. Esconder os botões "Marcar como paga" e "Pagamento parcial" quando a parcela já estiver com status **Parcial** (no modal do cliente, alinhando com a seção MGMV que já faz isso).
2. Redistribuir corretamente o valor "faltante" da parcela alvo entre as demais parcelas pendentes, marcando a parcela alvo com valor = valor pago (aparece como Parcial, mas "fechada").

## Alterações

### 1) `src/sections/clientes-section.tsx` (linhas ~1409–1432)

Trocar a condição de renderização das ações:

```text
antes: {!i.paid && ( ...botões... {!isPartial && <Popover/>} )}
depois: {!i.paid && !isPartial && ( ...botões... <Popover/> )}
```

Assim, quando `isPartial = true`, nenhum dos dois botões aparece.

### 2) `src/lib/store.ts` — `registerMGMVPartialPayment` (linhas ~664–716, ramo "pagamento parcial inferior ao valor da parcela")

Mudar a semântica da parcela alvo e a redistribuição:

- Parcela alvo: `value = paidAmount` (o valor pago); `paidAmount = amount acumulado`; `paid = false`; `manualPartial = true`; `paidAt = now`. Visualmente aparece como Parcial com valor R$ 100.
- Redistribuir o restante do saldo do acordo (`newRemainingCents`) entre as OUTRAS parcelas pendentes, uniformemente e ajustando centavos no último item (mesmo esquema base/rest já usado).
- Preservar a regra: soma total (pagas + parcelas pendentes recalculadas + valor da alvo) = `totalDebt` exato em centavos, e soma das pendentes = saldo restante.
- Se não houver outras pendentes: manter a parcela alvo como Parcial sem redistribuir (comportamento atual).

Exemplo com 10 × R$ 200 (saldo 2.000), pagamento parcial R$ 100 na parcela #1:

```text
Antes: #1 permanece 200 (paid 100), #2..#10 = 200 cada. Saldo 1.900. ✅ mat., mas confuso visualmente.
Depois: #1 vira 100 (Parcial, "fechada"). #2..#10 = 211,11 cada (com centavo ajustado no último). Saldo 1.900. ✅
```

### 3) Regra de fluxo — `Marcar como paga` em parcela Parcial

Como o botão fica escondido quando `isPartial`, o usuário não consegue mais quitar a parcela em uma segunda etapa por esta UI. Isso é intencional segundo a resposta da pergunta 2 (esconder ambos). O reprocessamento total continua disponível via edição do acordo / MGMV.

## Validação

- Ajustar `src/lib/store.test.ts` (se houver casos cobrindo o ramo parcial) para refletir o novo shape: `value` da alvo == amount pago, e soma das outras pendentes == `saldoAnterior - amount`.
- Rodar `bunx vitest run` focado em `store.test.ts` e `mgmv-schedule.test.ts`.
- Checagem manual: cliente com 10 × 200, pagar R$ 100 em #1 → #1 aparece R$ 100 Parcial, #2..#10 R$ 211,11 (com ajuste de centavo), saldo restante R$ 1.900,00.

## Fora de escopo

- Regra de pagamento ≥ valor da parcela (ramo `targetFullyPaid`) permanece inalterada.
- Componente `MgmvPartialPaymentPopover` e sua prévia continuam corretos, pois já mostram `nextRemaining / pendingCount` como valor por parcela.
- Nenhuma alteração em finanças, importação ou reprocessamento MGMV.