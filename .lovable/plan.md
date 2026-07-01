## Diagnóstico do erro exibido

A observação do cliente é ambígua e o parser por regra em `extractMGMVAgreementFromNotes` (src/sections/import-section.tsx) fez três leituras erradas:

1. **Reconheceu `3x de 200` como acordo** (regex `dividido em`), quando a linha seguinte (`1/4 Parcela paga (50 reais)`) mostra que o acordo real é 4x de R$150.
2. **`(\d+)\s*[ºª]?\s*Parcela`** capturou o "4" de "1/4 Parcela paga" como se fosse "parcela número 4 paga".
3. **`(\d+)\s*parcelas?\s*pagas?`** casou com "4 Parcela paga" e definiu bulkPaidCount=4, clampado para 3. Como só a parcela "4" estava no mapa e 4 > 3, o algoritmo preencheu 1 e 2 sequencialmente → resultado visível: **2/3 pagas, saldo R$200**.
4. **Não existe suporte a pagamento parcial** no tipo `MGMVInstallment` (só `paid: boolean`), então "R$50 dos R$150" não pode ser representado sem mudança no modelo.

Verdade confirmada pelo usuário: **4× R$150, 1 parcela com pagamento parcial de R$50 em 19/Jun** (saldo R$550).

## O que vou implementar

### 1. Blindar o parser de regra contra falsos positivos (src/sections/import-section.tsx)
- Trocar `(\d+)\s*[ºª]?\s*Parcela` por regex que exige separador de palavra e recusa dígito precedido por `/` ou `,` (evita casar "1/**4** Parcela").
- Trocar `(\d+)\s*parcelas?\s*pagas?` por versão que exige a palavra "parcelas" no plural OU número seguido de espaço + "parcela" no singular só quando não há barra imediatamente antes ("1/4 Parcela paga" deixa de virar bulk=4).
- Se o parser detectar padrões conflitantes (menção a "X/Y" com Y ≠ count, ou valor entre parênteses menor que `value` da parcela), marcar `reviewStatus: "review_required"` no acordo retornado.

### 2. Suportar parcela parcialmente paga (src/lib/store.ts)
Estender `MGMVInstallment`:
```ts
paidAmount?: number; // quanto já entrou nesta parcela (default = value quando paid=true)
```
Regras derivadas:
- `paid = true` quando `paidAmount >= value`.
- Saldo = `totalDebt - Σ paidAmount`.
- Parcelas pagas exibidas = `Σ paidAmount / value` arredondado para baixo, com sufixo "+ parcial" quando houver resto.

### 3. Propagar em Card MGMV (src/sections/mgmv-section.tsx e onde `installmentsPaid` é calculado em store.ts)
- Exibir "1/4 (+ R$50 parcial)" quando houver parcialidade.
- "Saldo restante" e "Próximo vencimento" recalculados a partir da soma real, não do count binário.

### 4. IA de revisão já cobre esse cenário
`mgmv-ai-review.functions.ts` recebe as observações originais. Vou:
- Estender `MgmvAiReviewSuggestion` com `partialPaidAmount?: number | null` e `partialPaidInstallment?: number | null`.
- Ajustar `applySuggestionToAgreement` (src/lib/mgmv-ai-apply.ts) para gravar `paidAmount` na parcela parcial.
- Ajustar `isMgmvAgreementSuspect` para marcar como suspeito quando as notas mencionam "parcial", "R$ X reais" entre parênteses depois de "paga", ou "X/Y" com Y ≠ count → força botão "Consultar IA" a aparecer piscando no card.

### 5. Corrigir o registro específico deste cliente
Depois do parser corrigido, o próximo save recomputa. Para o registro já persistido, oferecer no card MGMV um botão "Reanalisar com IA" que reaplica o parser + sugestão da IA e mostra o modal de revisão (`MgmvAiReviewModal`) para o usuário confirmar 4×150 + parcial de 50.

## Fora do escopo
- Não vou mexer no fluxo de importação/onepage.
- Não altero schema do banco além de adicionar `paid_amount NUMERIC` opcional na tabela `mgmv_installments` (migration curta com GRANT já existente na tabela).

## Verificação
- `tsgo --noEmit`
- Rodar `src/sections/import-section.mgmv.test.ts` (ampliar com caso "600 dividido em 3x de 200 reais + 1/4 Parcela paga (50 reais)").
- Playwright: abrir o cliente da imagem, conferir card mostrando **4× R$150 · 0/4 pagas + R$50 parcial · saldo R$550**.
