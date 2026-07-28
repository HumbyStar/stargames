## Feature II — Gerador de Formato para Nota Fiscal

Adicionar ação **"Gerar Formato NF"** na barra do card **Histórico de Produtos** do drawer do cliente, que classifica os produtos selecionados por NCM via IA, agrupa por lote e gera um texto pronto para enviar ao contador.

## Fluxo

1. Usuário seleciona 1+ produtos no Histórico de Produtos.
2. Clica em **Gerar Formato NF** (novo botão na mesma barra dos botões Copiar / Pago / Enviado / etc.).
3. Sistema valida cadastro fiscal do cliente (usa a IA já existente `analyzeCustomerData` sobre `client.customerData` — se faltar Nome, CPF, Endereço, Número, Bairro, Cidade, UF, CEP, mostra toast pedindo para completar via "Preencher Dados do Cliente" e aborta).
4. Envia cada produto individual à IA (gateway Lovable, `google/gemini-3.6-flash`) para classificar Categoria + NCM.
5. Agrupa produtos por NCM (nunca mistura NCMs distintos), ordena por categoria.
6. Calcula subtotais por lote (soma de `totalValue`) e total geral.
7. Abre modal com o texto formatado + botão **Copiar**.

## Alterações

### 1. Server function (nova)
**`src/lib/nf-format.functions.ts`** — `createServerFn` protegido:
- Input: `{ products: Array<{ id, name, platform, totalValue }> }`.
- Chama a Lovable AI Gateway (`google/gemini-3.6-flash`, `response_format: json_object`) com prompt fiscal BR pedindo `{ ncm: "8523.49.90", category: "Jogos de videogame mídia física" }` para cada produto (batch em 1 chamada com lista numerada, para economizar créditos).
- Retorna `Array<{ id, ncm, category }>`.
- Trata 429/402 igual ao `customer-data-ai.functions.ts`.

### 2. Utilitário puro (novo, testável)
**`src/lib/nf-format.ts`**:
- `buildFiscalHeader(client, fiscal)` → linhas com Nome, CPF, Endereço, CEP.
- `groupByNcm(products, classifications)` → `Array<{ ncm, category, items, subtotal }>` ordenado por categoria.
- `renderNfText(header, groups, total)` → string final no formato do PDF (usando `formatBRL`, "Lote N – Categoria", Quantidade, NCM, Subtotal, VALOR TOTAL DA NOTA).
- Testes em `src/lib/nf-format.test.ts` cobrindo agrupamento, ordenação e formatação.

### 3. Modal (novo)
**`src/components/nf-format-modal.tsx`**:
- Props: `open`, `onClose`, `client`, `selectedProducts`.
- Ao abrir: estado `loading` → chama `analyzeCustomerData` (se `customerData` presente) para obter campos fiscais; valida obrigatórios; se OK, chama `classifyProductsForNf`.
- Renderiza pré-visualização (lotes + total) e um `<pre>` com o texto final + botão **Copiar** (usa `navigator.clipboard.writeText`, toast de sucesso).
- Em erro: mostra mensagem clara ("Complete o cadastro fiscal", "IA indisponível", etc.) e botão Fechar.

### 4. Integração no drawer
Em **`src/sections/clientes-section.tsx`** (barra de ações do Histórico de Produtos, ~linha 1570):
- Novo botão `Gerar Formato NF` (habilitado somente com `selectedCount > 0`).
- Estado local `nfModalOpen` + render do `<NfFormatModal />` no final do drawer.
- Passa apenas os produtos individuais selecionados (ignora itens MGMV, consistente com o card existente).

### 5. Sem alterações em
- Banco (usa `customer_data` já existente).
- Store / cálculos financeiros / MGMV.
- Outras seções.

## Detalhes técnicos

- IA em uma única requisição batch para reduzir custo; se algum item vier sem NCM, agrupa em lote "Sem classificação (revisar)" no fim, sem quebrar a saída.
- NCM sempre exibido no formato mascarado `XXXX.XX.XX` (helper `formatNcm`).
- Valores em pt-BR via `formatBRL` já existente.
- Não persiste NCM no banco nesta feature — é gerado sob demanda (evita migration e mantém escopo enxuto). Se quiser cache depois, é incremento futuro.

## Verificação

- `bunx vitest run src/lib/nf-format.test.ts`.
- Preview: selecionar 2+ produtos → clicar em Gerar Formato NF → validar texto no modal e cópia para clipboard.
- Caso cadastro fiscal incompleto: garantir toast "Complete o cadastro fiscal em Preencher Dados do Cliente" e modal não abrir com resultado.
