## Bug: importação por Lista/CSV não usa a data marcada no cabeçalho

### Causa raiz
`ParsedRow.registerDate`/`dueDate` são tipados como **`YYYY-MM-DD`** e o parser do Notion respeita isso (via `normalizeDateBR`). Mas os parsers de lista fazem o contrário e devolvem **ISO completo**:

- `src/sections/import-section.tsx` linha 1091 (`parseTextList`): `registerDate: headerDate ? brDateToISO(headerDate) : null` — `brDateToISO` retorna `new Date(...).toISOString()` (ex.: `2026-06-25T15:00:00.000Z`).
- Linha 1127/1128 (`parseTabular`): `registerDate: toISO(reg)`, `dueDate: toISO(due)` — mesma coisa.

No commit da importação (linhas ~1868–1875, 1924–1944, 2329) todo o código assume `YYYY-MM-DD` e concatena `T12:00:00`:

```
new Date(`${p.registerDate}T12:00:00`).toISOString()
```

Com um ISO completo isso vira `"2026-06-25T15:00:00.000ZT12:00:00"` → `Invalid Date` → `toISOString()` lança `RangeError`, o `addProduct` nunca é chamado com a data correta e o produto **não aparece na data marcada** (cai em hoje ou quebra a linha).

### Correção
Padronizar os parsers de lista/tabular para devolver **`YYYY-MM-DD`** em `registerDate`/`dueDate`, igual ao parser do Notion.

1. `parseTextList` (linha 1050): trocar `brDateToISO(headerDate)` por `normalizeDateBR(headerDate)`; manter `date: headerDate` (BR) para a UI de preview.
2. `parseTabular` (linha 1108): trocar `toISO(reg)`/`toISO(due)` por um `toYMD(v)` local que:
   - Aceita `YYYY-MM-DD` (retorna igual).
   - Aceita `DD/MM/AAAA` via `normalizeDateBR`.
   - Aceita ISO completo → devolve `slice(0,10)` do UTC.
   - Caso contrário devolve `null`.
3. `parseHTMLList` já delega para `parseTextList`, então fica coberto.

### Verificação
- Colar no textarea de importação por lista uma primeira linha com data (ex.: `25/06/2026` ou `Itens 25/06/2026`) seguida de linhas de produtos e clicar em **Validar aqui / Importação Assistida**.
- No preview a coluna Data deve mostrar `2026-06-25` (não um ISO completo) e o item precisa ser confirmado no commit sem `RangeError` no console.
- Após confirmar, o produto deve aparecer agrupado/filtrado pela data marcada, e não pela data de hoje.
- Rodar `bun tsgo --noEmit` para confirmar tipos.

### Arquivos afetados
- `src/sections/import-section.tsx` (apenas `parseTextList` e `parseTabular`; nenhuma mudança em store, DB ou UI).
