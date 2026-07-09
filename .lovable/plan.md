## Problema

Na Revisão IA do exemplo (16× R$ 215,62 e total declarado R$ 3.450), a IA sugere corretamente **Saldo R$ 3.200** (= 3.450 − 250 pago). Porém:

- O validador matemático do modal reclama porque 16 × 215,62 = **3.449,92 ≠ 3.450** (diferença de 8 centavos — apenas arredondamento).
- Ao aplicar a sugestão, o card do cliente recalcula o Saldo Restante somando as parcelas pendentes: 15 × 215,62 − 0 = **3.199,92** — divergência visual do valor **R$ 3.200** que a IA mostrou na terceira coluna.
- Além disso, o usuário quer poder editar **todos** os campos manualmente (linha da tabela MGMV, modal do acordo, produtos comuns) para corrigir divergências à mão.

## Correção

### 1. IA devolve números coerentes (arredondamento consciente)

`src/lib/mgmv-ai-review.functions.ts` — atualizar `SYSTEM_PROMPT`:

- Reconciliação obrigatória antes de retornar: se `installmentsCount × installmentValue` diferir do total declarado no texto por até `installmentsCount` centavos (mero arredondamento em 2 casas), **manter o total declarado** e considerá-lo verdade.
- `remainingValue = totalAgreementValue − paidValue` sempre coerente com o total escolhido acima (no exemplo: 3.450 − 250 = **3.200**, não 3.199,92).
- `paidValue = paidInstallments × installmentValue + (partialPaidAmount || 0) + (nextInstallmentDiscount || 0)`; se `nextInstallmentDiscount` existir, considerar que a parcela `discountAppliedToInstallment` terá valor efetivo `installmentValue − discount`.
- Nenhum `warning` sobre "3450 diverge de 3449.92" quando o gap for ≤ N centavos — a IA deve tratar isso como arredondamento normal e explicar apenas quando o gap for real.

### 2. Validador matemático do modal tolera arredondamento de centavos

`src/components/mgmv-ai-review-modal.tsx` (`validateMath`):

- Trocar `eps = 0.01` fixo por `eps = Math.max(0.01, N × 0.01)` nas comparações que envolvem `N × V vs T` e `T − PV vs R`.
- Efeito: um gap de 8 centavos em 16 parcelas não abre mais o bloco "A sugestão da IA possui divergência matemática". Divergências reais (ex.: 30 reais) continuam sinalizadas normalmente.

### 3. Aplicar a sugestão preservando exatamente os números do card da IA

`src/lib/mgmv-ai-apply.ts` (`applySuggestionToAgreement`):

- Depois de construir as `installments`, calcular `sumInstallments = soma(value)` incluindo o `effectiveValue` da parcela com desconto.
- Se `|sumInstallments − totalAgreementValue| > 0` e ≤ `N × 0.01`, aplicar o delta na ÚLTIMA parcela pendente (ajuste em centavos) para que a soma bata exatamente com o `totalAgreementValue`.
- Consequência: `buildRow` do card do cliente, que soma `installments.value − paidAmount` das pendentes, passa a devolver **R$ 3.200** — idêntico ao card "Sugestão da IA".
- Guardar `agreement.aiReviewRawResult = suggestion` (já existe hoje) para auditoria; o cálculo do card continua vindo das parcelas (fonte da verdade).

### 4. Edição manual completa de todos os campos (linha + modais)

O usuário quer controle total pós-revisão. Ampliar o que hoje é editável.

**Linha da tabela MGMV** (`src/sections/mgmv-section.tsx`):

- Expandir `mgmvEdit` de `{ totalDebt, installmentValue }` para incluir também: `installmentsCount`, `paidInstallments`, `paidValue`, `remainingValue`, `nextDue`, `status`, `reviewStatus`.
- Ao confirmar, aplicar mudanças através de um helper que rebalanceia parcelas via `rebalanceAgreement` (para N/valor/total) e marca/desmarca `paid` conforme `paidInstallments` novo. `remainingValue` e `paidValue` editados sobrescrevem o `totalDebt` correspondente quando fizer sentido.
- Renderizar cada célula da linha como `Input` durante o modo edição (padrão já usado para `totalDebt`), com o `RowEditPencil`/`RowEditActions` já existentes.

**Modal do acordo MGMV** (`src/components/mgmv-agreement-editor.tsx`):

- Permitir edição das parcelas **pagas** também (hoje são read-only): valor, data (`paidAt`), toggle "Paga/Não paga", `paidAmount` (parcial).
- Adicionar campos editáveis para `Valor pago` e `Saldo restante` no bloco de resumo — ao editar um, distribuir a diferença nas parcelas pendentes automaticamente (mesma mecânica do `rebalanceAgreement`).
- Botão "Salvar" continua marcando `reviewStatus = manually_reviewed` quando o usuário ajusta manualmente após uma divergência.

**Produtos comuns (linha + modal)** (`src/sections/clientes-section.tsx`):

- `productEdit` e `clientEdit`: incluir todos os campos hoje só-leitura na linha (nome, plataforma, valor total, valor pago, valor restante, status financeiro, data, observações). Confirmar via `updateProduct`/`updateClient`.
- No modal de detalhes do cliente (mesmo arquivo), transformar os campos exibidos em `Input`s controlados ao entrar em modo edição, e persistir tudo no store ao clicar em Salvar.

## Detalhes técnicos

- Nada muda no parser por regra nem em outras seções (importação, cobrança, dashboard).
- Nenhuma migração de banco.
- `applySuggestionToAgreement` continua pura e testável — o ajuste de centavos vira o último passo antes do `return`.
- O helper de rebalanceamento das linhas MGMV editadas reaproveita `rebalanceAgreement` já existente em `src/lib/mgmv-schedule.ts`.
- `RowEditPencil` / `RowEditActions` / `useRowEdit` já suportam objetos com N campos — só precisamos passar mais chaves.

## Fora do escopo

- Não mexer no parser por regra, no botão de pagamento parcial, na importação, nem no dashboard de cobrança.
- Não alterar schema do banco.
- Não alterar seções de equipe, notificações, integridade ou concierge.
