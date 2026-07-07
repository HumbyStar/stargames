## Bug: MGMV — pagamento parcial deve marcar a parcela como "Paga Parcialmente" e redistribuir o saldo apenas nas demais parcelas

### Comportamento atual
`registerMGMVPartialPayment` (em `src/lib/store.ts`) absorve o valor pago no rateio geral, zera o `paidAmount` da parcela alvo e recalcula `value` de **todas** as pendentes (inclusive a própria alvo). A parcela alvo continua com o mesmo status "Pendente"/"Vencida" e não há distinção visual de "paga parcialmente".

### Comportamento esperado
1. A parcela onde o pagamento parcial foi registrado exibe status **"Paga Parcialmente"**, preserva seu `paidAmount` acumulado e seu `value` original.
2. O saldo que sobrou (total do acordo − parcelas totalmente pagas − parciais acumulados) é redistribuído **apenas entre as outras parcelas pendentes** — a alvo fica congelada com o valor original e o parcial registrado.
3. Se o parcial atingir o valor da parcela (via novo parcial que soma ao anterior), ela vira "Pago" pela regra atual do else de `amount >= target.value`.

### Mudanças

**1. `src/lib/store.ts` — `registerMGMVPartialPayment`** (bloco `else` do `amount < target.value`)
- Manter na parcela alvo:
  - `value`: inalterado (valor original da parcela).
  - `paidAmount`: `prevPaid + amount` (acumula).
  - `paidAt`: `nowIso`.
  - `paid`: `false`.
- Redistribuir `remaining` entre as **outras** parcelas pendentes (`!i.paid && i.number !== installmentNumber`), preservando `paidAmount` prévio dessas (para não perder parciais anteriores) mas recalculando `value` uniformemente em centavos (com sobra na última).
- Se não houver outras pendentes, deixar apenas o `paidAmount` da alvo atualizado (sem rateio).
- Se `paidAmount` acumulado na alvo ≥ `value`, promover para `paid=true` (mesma regra do ramo `amount >= target.value`) — cobre caso de novo parcial que fecha a parcela.

**2. UI — rótulo "Paga Parcialmente"**
- `src/sections/clientes-section.tsx` (linhas ~1350): quando `!i.paid && (i.paidAmount ?? 0) > 0`, exibir `Tag variant="primary"` com texto "Paga Parcialmente" no lugar de "Pendente"/"Vencido". Manter `overdue` só quando não há parcial.
- `src/sections/mgmv-section.tsx` (linhas ~895): mesma alteração no `<Tag>`.
- Manter o subtítulo `(parcial R$ X,XX)` que já existe.

**3. Testes (`src/lib/store.test.ts`)**
- Novo caso: acordo 10×100 (R$1.000). Pagar R$50 parcial na parcela 2 → parcela 2 fica com `value=100`, `paidAmount=50`, `paid=false`; demais 8 pendentes (3..10) recebem `(1000-0-50)/8 = 118.75` cada. Parcela 1 se paga integralmente antes segue paga com valor 100.

### Detalhes técnicos
- Sem mudança de schema/DB. Continua espelhando via `dbSyncAgreementForClient`.
- `getMGMVDisplay` já soma parciais em `remainingBalance`; comportamento fica correto após o novo rateio.
- Regra de arredondamento em centavos idêntica à existente (base + resto na última).

### Arquivos afetados
- `src/lib/store.ts`
- `src/sections/clientes-section.tsx`
- `src/sections/mgmv-section.tsx`
- `src/lib/store.test.ts`