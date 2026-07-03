## Detecção de MGMV por tabela na importação do Notion (Hadi)

Hoje `parseClientArticle` em `src/sections/import-section.tsx` concatena todas as `<table>` do artigo do cliente e todas as linhas passam pela mesma regra (`financialStatus` derivado só do valor da célula Status/Situação). Isso está errado quando o cliente tem múltiplas tabelas separadas por seção — como no print enviado, onde uma tabela é precedida pelo título **"LOTE FECHADO MEU GAME MINHA VIDA"** (variante de MGMV) e todas as linhas estão como `PAGO / ENVIADO`. Essas linhas deveriam ser tratadas como itens de um MGMV ativo, enquanto tabelas sem menção a MGMV continuam sendo produtos fora do acordo.

### Regra

Para cada tabela do artigo:

1. Coleta o **contexto textual precedente** — sobe pelos `previousElementSibling` do `<table>` até encontrar outra `<table>` ou o topo do `<article>`, concatenando `textContent` de headings (`h1-h4`), parágrafos, e blocos toggle/callout do Notion.
2. Se o contexto casar com **`/mgmv|meu\s*game\s*minha\s*vida|lote\s*fechado|acordo/i`**, a tabela é marcada como `mgmvTable = true`.
3. Todas as linhas dessa tabela recebem `financialStatus = "MGMV"` e `situation = "Resolvido"` (padrão do sistema para itens dentro de acordo), preservando `paidValue` original. Um `warning` de linha "Item classificado como MGMV pelo cabeçalho da tabela: <trecho>" é gravado para transparência no preview.
4. Tabelas sem esse contexto mantêm o comportamento atual — regra por célula.

Casos edge:
- Se o próprio Status/Situação da linha já é MGMV, nada muda.
- Se a linha está `PAGO/ENVIADO`: continua com `paidValue` intacto, apenas `financialStatus="MGMV"` (fica como parcela quitada dentro do lote).
- Se o contexto contém "fora do MGMV" ou "não MGMV", ignora o match (negação explícita).

### Alterações

- `parseProductsTable(table, lineOffset = 0, opts?: { forceMgmv?: boolean; mgmvHeading?: string })` — quando `forceMgmv=true`, sobrescreve `financialStatus="MGMV"` e adiciona o warning; mantém demais regras.
- `parseClientArticle` — para cada tabela: computa `tableContext` (função nova `collectTableContext(table, article)`), detecta MGMV via regex, e chama `parseProductsTable` com `forceMgmv` conforme necessário.
- Nova função utilitária `tableHeadingMentionsMgmv(text): boolean` — mesma regex, ignorando trechos com negação explícita.

Nenhuma mudança em `parseNotionHtml`, MGMV agreement extraction, preview, ou UI. Apenas classificação por tabela.

### Testes

Em `src/sections/import-section.mgmv.test.ts`:
- HTML com 2 tabelas: a primeira sem heading MGMV (linhas PAGO/ENVIADO → continuam Pago) e a segunda precedida por "LOTE FECHADO MEU GAME MINHA VIDA" (linhas PAGO/ENVIADO → viram MGMV com warning).
- Heading "MGMV Ativo" → força MGMV.
- Heading neutro ("Histórico 2024") + linha com Status=MGMV → linha continua MGMV (comportamento por célula intacto).
- Negação "produtos fora do MGMV" → tabela NÃO vira MGMV.

### Fora do escopo

- Não altera o extrator do `MGMVAgreement` a partir de `notes` (mantém contrato atual).
- Não muda UI da seção Import/MGMV.
- Não mexe no `parseClientHtml` (parser alternativo já não é usado no ZIP).

### Arquivos afetados

- `src/sections/import-section.tsx` — parser das tabelas.
- `src/sections/import-section.mgmv.test.ts` — cobertura nova.
