## Análise das imagens

Nos três prints, o "Histórico de Produtos" do cliente mostra `CADASTRO` e `LIMITE` **com a mesma data** (ex.: 17/07/2026 e 17/07/2026, ou 27/06/2026 e 27/06/2026). Como a data limite é igual à data de cadastro, qualquer reserva já nasce vencida — daí o badge vermelho "Reserva vencida" mesmo em itens recém-importados. Também dá pra ver que essas linhas vieram do fluxo "Importar em lista" (rodapé com os grupos colados: "Nathanael - 87 9164-4200 - Star Wars Battlefront II...", "katlheen - 85 9680-8742 - Hulkbuster...", "Bruno Ribeiro - 21 97629-1177 - Nami (One Piece)... - reserva(20)"), não do CSV/Excel.

## Causa

Em `src/components/list-import-modal.tsx` (linha 489), a confirmação da importação em lista grava:

```
registerDate: now,
dueDate: now,
```

Ou seja, o `dueDate` é copiado do `registerDate` sem considerar o status. Para comparação, o caminho de CSV/Excel/Texto em `src/sections/import-section.tsx` já soma `+30d` para Reserva (e `+7d` caso contrário) via `calculateDueDate`. O caminho de lista simplesmente ignorou essa regra.

## Correção

Aplicar a mesma regra do CSV no commit da lista colada / HTML de cliente. Em `src/components/list-import-modal.tsx`, ao montar o `addProduct`, calcular `dueDate` a partir de `registerDate` de acordo com o status financeiro resolvido:

- `Reserva` → `registerDate + 30 dias`
- demais status (`Pago`, `Pendente`, `Revisão necessária`) → mantém `registerDate` (mesmo comportamento neutro atual, sem gerar "vencida" precoce)

Implementação:

1. Extrair um helper local (ou reusar/portar `calculateDueDate` de `import-section.tsx`) que receba `(financialStatusFinal, registerDateISO)` e devolva o ISO de vencimento.
2. Substituir `dueDate: now` por `dueDate: computeDueISO(financialStatusFinal, now)`, usando o mesmo `financialStatusFinal` já passado para `addProduct`.
3. Não mexer em nada mais — parser, preview, MGMV, tudo intacto. Nenhum item já importado é retroativamente alterado.

## Verificação

- Importar em lista uma linha "... - 100 reais - reserva" com data de cadastro 17/07/2026 → card do cliente deve mostrar Cadastro 17/07/2026 e Limite 17/08/2026, sem badge "Reserva vencida".
- Importar linha "pago" → Limite permanece igual ao Cadastro (sem regressão).

## Fora do escopo

- Recalcular retroativamente `dueDate` dos produtos já importados. Se quiser depois, dá pra adicionar um botão "Recalcular limite das reservas" — só avise.
- Alterar a regra dos 30 dias (é o que o CSV já usa).
