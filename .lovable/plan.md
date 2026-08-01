## Problema

A data limite fica igual à data de cadastro porque a regra de prazo só existe para produtos com status **Reserva**. Confirmado no código:

- `src/lib/store.ts` → `normalizeProductDueDateForCreate` retorna o produto sem alteração quando o status não é "Reserva"; só a Reserva recebe cadastro + 1 mês.
- `src/sections/import-section.tsx` → `calculateDueDate` devolve literalmente `registerDate` para qualquer status diferente de Reserva.
- Ainda em `import-section.tsx`, alguns caminhos de importação (HTML/ZIP) usam um fallback de cadastro + 7 dias, gerando prazos inconsistentes.

## Regra alvo

1. **Reserva**: mantém o comportamento atual (mesmo dia do mês seguinte, com ajuste para meses curtos).
2. **Demais status** (Pendente, Pago, Revisão necessária): data limite = data de cadastro + 30 dias.
3. **Data limite explícita do arquivo** (cabeçalho "Data Limite" da lista colada, coluna de data do HTML/ZIP): tem prioridade sempre que for maior que a data de cadastro; caso contrário cai na regra padrão.

## Alterações

**src/lib/store.ts**
- Adicionar `calculateDefaultDueDate(registerDate)` = cadastro + 30 dias.
- Generalizar `normalizeProductDueDateForCreate` para todos os status: se houver `dueDate` informado e estritamente maior que `registerDate`, preserva; senão aplica +1 mês (Reserva) ou +30 dias (demais).

**src/sections/import-section.tsx**
- `calculateDueDate` passa a usar a nova função para status não-Reserva em vez de devolver a data de cadastro.
- Substituir os fallbacks de +7 dias e os `dueDate ?? registerDate` pelos mesmos helpers, mantendo a prioridade da data vinda do arquivo.

**Testes** (`src/lib/store.test.ts`)
- Casos: produto Pendente sem data → cadastro + 30 dias; Pago sem data → +30 dias; Reserva sem data → +1 mês; data do arquivo maior que o cadastro → preservada; data do arquivo igual/menor → substituída pela regra.

Observação: a mudança vale para novos cadastros e importações; produtos já gravados no banco não são alterados.
