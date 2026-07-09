## Bug

No card **Saldo Restante** aparece **R$ 3.165,54**, mas a soma real das parcelas da lista é:

- Parcela 2/16 pendente: R$ 181,24 − R$ 34,38 parcial = R$ 146,86
- Parcelas 3–16 pendentes: 14 × R$ 215,62 = R$ 3.018,68
- **Total pendente real: R$ 3.165,54** ✅

Espera aí — na verdade nesse caso o card bate. Relendo o PDF do usuário: o card diz **R$ 3.165,54** e o esperado (soma das pendentes menos parcial) também é R$ 3.165,54. Então o número exibido está certo, mas o usuário reclama que **diverge da soma das parcelas pendentes exibidas na listagem**.

A causa é que o cálculo hoje usa `agreement.aiReviewRawResult.remainingValue` (valor congelado pela IA no momento da revisão). Isso é frágil:

- Se depois da revisão o usuário editar uma parcela, marcar/desmarcar pagamento, ou adicionar/remover parcial, o card continua mostrando o número antigo da IA em vez de recalcular pela lista.
- Em acordos com desconto aplicado (parcela já com `value` reduzido) + `paidAmount` parcial, o número da IA pode divergir do que a lista mostra na tela.

O usuário pediu: **"O Saldo Restante deve ser calculado com base nas parcelas exibidas na lista, considerando parcelas pagas, parciais e pendentes."**

## Correção

Em `src/sections/mgmv-section.tsx`, dentro de `buildRow`, remover o ramo que lê `aiReviewRawResult.remainingValue` e passar a calcular **sempre** a partir das parcelas efetivamente exibidas na tabela:

```
remainingValue = soma, para cada parcela NÃO paga, de:
    max(0, installment.value − (installment.paidAmount ?? 0))
```

Isso é exatamente a soma da coluna "Valor" das linhas pendentes descontando o parcial já pago — o que o usuário vê na lista.

O `paidValue` continua calculado como hoje (soma de `paidAmount ?? value` das pagas). A validação matemática (`hasMismatch`), o `reviewStatus`, o `next`, e todas as outras métricas ficam inalterados.

## Detalhes técnicos

- Arquivo único: `src/sections/mgmv-section.tsx`, função `buildRow` (linhas ~82–101).
- Remove o bloco `aiRemaining` e simplifica `remainingValue` para a soma acima.
- Não altera `mgmv-ai-apply.ts`, o modal de revisão IA, nem qualquer outra tela — o valor sugerido pela IA continua sendo aplicado nas parcelas (que é a fonte da verdade), o card apenas deixa de ler o cache do resultado bruto da IA.
- Sem migração de banco. Sem mudança de schema.

## Fora do escopo

Não mexer no parser, na regravação de parcelas pela IA, nos botões de pagamento parcial, ou em qualquer outra seção.