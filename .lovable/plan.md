## Bug 01 — HADI: apenas 1 tabela migrada

### Causa raiz
No fluxo de importação de ZIP do Notion, `parseClientArticle` em `src/sections/import-section.tsx` (linhas 760–767) pega **apenas a primeira** `<table>` do arquivo do cliente:

```
const table =
  article.querySelector("table.simple-table") || article.querySelector("table");
```

O arquivo do Hadi (e outros clientes com histórico grande) contém 3 `<table class="simple-table">` — por isso só a primeira foi migrada. O parser alternativo `parseClientHtml` (em `src/lib/html-client-import-parser.ts`) já itera todas as tabelas corretamente; a divergência está só no caminho do ZIP.

### Correção

`src/sections/import-section.tsx`, função `parseClientArticle`:
- Trocar `querySelector` por `querySelectorAll("table.simple-table")` com fallback para `querySelectorAll("table")`.
- Iterar todas as tabelas encontradas e concatenar os produtos.
- Passar um offset de `line` para `parseProductsTable` (ou reindexar após concatenar) para que `line` continue crescente entre tabelas e as mensagens de erro por linha façam sentido.
- Só emitir o erro "tabela não encontrada" quando nenhuma tabela existir.

Pequeno ajuste em `parseProductsTable` (opcional, mais limpo): aceitar `lineOffset = 0` e usar `idx + 1 + lineOffset` no lugar de `idx + 1`.

### Verificação
- Rodar os testes existentes (`html-client-import-parser.test.ts` continua verde — não é o mesmo parser, mas serve de regressão do formato).
- Adicionar teste em `src/sections/import-section.mgmv.test.ts` (ou arquivo próprio) com um HTML tipo Hadi contendo 3 tabelas e conferir que `parseNotionHtml(...).clients[0].products.length` = soma das 3 tabelas.
- Testar manualmente reimportando o ZIP do Hadi na tela de Import e conferir contagem total de produtos no preview.

### Fora do escopo
- Não muda UI, preview, dedup, MGMV nem regras de status/situação.
- Não altera o parser `parseClientHtml` (já correto).