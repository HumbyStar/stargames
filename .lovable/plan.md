## Ficha do Cliente — modo estruturado + edição manual

Transformar o modal "Preencher Dados do Cliente" em duas experiências no mesmo componente, sem quebrar a Feature II (Gerar Formato NF):

1. **Modo textarea (ficha vazia)** — igual hoje: cola texto livre + botão "Analisar com IA" → preview → "Salvar".
2. **Modo ficha estruturada (ficha preenchida)** — formulário com um input por campo, todos editáveis manualmente.

## Formato canônico

Ao salvar em qualquer modo, `client.customerData` passa a ser gravado sempre neste template (ordem fixa, uma linha por campo, campos vazios omitidos):

```
Nome: ...
CPF: ...
Estado: ...
Cidade: ...
Bairro: ...
Rua: ...
Número: ...
CEP: ...
Complemento: ...
Telefone: ...  (pré-preenchido com client.phone se ausente)
E-mail: ...
Obs: ...
```

Isso garante que a Feature II continua funcionando: `analyzeCustomerData` já re-extrai qualquer texto para `CustomerFiscalData` — o novo formato é ainda mais fácil de parsear que o texto colado.

## Detecção de "ficha preenchida"

Um novo helper puro `parseFichaFromText(text): Partial<CustomerFiscalData>` em `src/lib/ficha-parse.ts` faz um parse determinístico linha-a-linha (regex `^(Nome|CPF|Estado|Cidade|Bairro|Rua|Número|CEP|Complemento|Telefone|E-mail|Obs)\s*:\s*(.+)$`). Considera "preenchido" quando `Nome`, `CPF` e `CEP` estão presentes. Zero chamada de IA — instantâneo, offline e testável.

## Alterações

### 1. `src/lib/ficha-parse.ts` (novo)
- `parseFichaFromText(text) → Partial<CustomerFiscalData>` (regex determinístico).
- `isFichaComplete(text) → boolean` (Nome + CPF + CEP presentes).
- `renderFichaText(f, phoneFallback) → string` (formato canônico acima; telefone cai para `client.phone` quando vazio).
- Testes em `src/lib/ficha-parse.test.ts` cobrindo: parse do próprio output (round-trip), texto vazio, texto livre não-estruturado, campos parciais.

### 2. `src/components/customer-data-modal.tsx` (refatorado)
- Ao abrir: detecta modo via `isFichaComplete(initialData)`.
- **Modo textarea** (atual): mantido idêntico; ao "Analisar com IA", ao clicar "Salvar" grava usando `renderFichaText(fiscal, client.phone)` para já normalizar. Botão extra "Preencher manualmente" pula direto para o modo ficha com o telefone pré-carregado.
- **Modo ficha**: título "Ficha do Cliente", grid 2 colunas com um `Input` por campo (Nome, CPF, Estado [UF, `maxLength=2`], Cidade, Bairro, Rua, Número, CEP, Complemento, Telefone, E-mail, Obs [Textarea pequena]). Todos editáveis. Botão secundário "Editar como texto livre" volta ao modo textarea preservando o conteúdo atual serializado.
- Salvar em qualquer modo: chama `onSave(renderFichaText(...))`.

### 3. `src/sections/clientes-section.tsx` (botão do drawer)
- Onde hoje aparece "Preencher Dados do Cliente": trocar o label dinamicamente por `isFichaComplete(client.customerData) ? "Abrir Ficha do Cliente" : "Preencher Dados do Cliente"`. Mesma ação (abre o modal).

### 4. Sem alterações em
- Banco (`customer_data` já existe).
- `src/lib/customer-data-ai.functions.ts` (a IA continua extraindo do texto — o novo formato é mais fácil ainda de parsear).
- `src/lib/nf-format.ts` / `nf-format-modal.tsx` / `nf-format.functions.ts` — a validação fiscal continua rodando `analyzeCustomerData` sobre `customerData`, e o novo formato canônico é 100% compatível.

## Compatibilidade com Feature II (NF)

O modal NF chama `analyzeCustomerData(client.customerData)` e valida com `missingFiscalFields`. Como o formato canônico usa labels em português direto (`Nome:`, `CPF:`, `CEP:`, etc.), a extração da IA fica trivial e determinística. Nada muda no fluxo NF — só melhora a taxa de extração.

## Verificação
- `bunx vitest run src/lib/ficha-parse.test.ts`
- Preview: (a) cliente sem ficha → botão "Preencher Dados do Cliente", modo textarea + IA; (b) após salvar → botão vira "Abrir Ficha do Cliente", modal abre com formulário estruturado editável, telefone pré-preenchido; (c) editar um campo e salvar → refletido no drawer; (d) abrir "Gerar Formato NF" → cabeçalho fiscal aparece corretamente.
