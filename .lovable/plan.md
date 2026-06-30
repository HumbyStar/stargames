## Diagnóstico

O bug está concentrado no **importador**, na função `normalizeSituationBR` em `src/sections/import-section.tsx` (linhas 124–130). Hoje ela só reconhece 3 termos da planilha do Notion:

- `entregue` / `enviado` → `Enviado`
- `desistiu` → `Desistiu`
- `abandonou` → `Abandonou`
- **qualquer outra coisa → `Em Aberto`** ← causa do bug

Consequência: quando a planilha vem com `Retirado`, `Removido`, `MGMV`, ou qualquer variação não prevista (acentos, abreviações, "OK", "Quitado", etc.), a importação grava `situation = "Em Aberto"`. A partir daí, as regras `shouldAppearInCollection`, `generalStatus` e o `totalOpen` da seção Clientes — que filtram por `situation === "Em Aberto"` — exibem o cliente como em cobrança e inflam "Valores a Receber".

A regra correta (PDF):
- **Enviado / Retirado** → produto entregue (`Enviado`)
- **Removido / Desistiu** → cliente abandonou (`Desistiu` / `Abandonou`)
- **MGMV** → produto consolidado em acordo (`Resolvido`, com `financialStatus = MGMV`)
- **Em branco** → único caso que vira `Em Aberto`
- **Qualquer outro texto preenchido** → NÃO é "Em Aberto"; marcar como `Resolvido` e sinalizar para revisão manual (pode haver observação no Notion)

## Mudanças

### 1. `src/lib/store.ts`
- Estender o tipo `Situation` para incluir `"Retirado"` e `"Removido"` (mapeáveis 1:1 às regras do Notion), mantendo retrocompatibilidade.
- Adicionar helper `isResolvedSituation(p)` que retorna `true` para `Enviado | Retirado | Removido | Desistiu | Abandonou | Resolvido` ou quando `financialStatus === "MGMV"`.
- Em `shouldAppearInCollection`: trocar a checagem `situation === "Em Aberto"` por `!isResolvedSituation(p)` — assim só entra na cobrança quem realmente está em aberto.

### 2. `src/sections/import-section.tsx` — coração da correção
- Reescrever `normalizeSituationBR` para:
  - Normalizar removendo acentos e espaços.
  - Reconhecer explicitamente: `enviado|entregue|entreguei|retirado|retirou` → `Enviado`; `removido|removi|removeu` → `Removido`; `desistiu|desistencia|cancelou` → `Desistiu`; `abandonou|abandono` → `Abandonou`; `mgmv|acordo|parcelado` → `Resolvido` (e sinalizar para o caller marcar `financialStatus = MGMV`).
  - **Situação vazia** → `Em Aberto` (única forma legítima de chegar nesse estado).
  - **Texto preenchido mas não reconhecido** → retornar `Resolvido` + warning "Situação '<valor original>' não reconhecida — verifique observação no Notion." Isso evita a dupla cobrança citada no PDF.
- Em `parseProductsTable` (linha ~577): trocar o warning genérico "Situação vazia" para deixar claro que **só vazio** vira `Em Aberto`; quando o reconhecedor retornar `Resolvido` por fallback, propagar o warning para a UI de revisão da importação.
- Atualizar `VALID_SITUATION` e `SITUATIONS` (linhas 62, 3478) para incluir `Retirado`, `Removido` e `Resolvido` nas validações e selects do editor manual da importação.

### 3. `src/sections/clientes-section.tsx`
- `totalOpen` (linha 155): trocar `p.situation === "Em Aberto"` por `!isResolvedSituation(p)` para o total bater com a nova regra.
- `generalStatus` (linhas 58, 62, 66): mesma troca, garantindo que clientes com produtos `Retirado/Removido/Resolvido` não apareçam como "Reserva vencida" / "Pendente".

### 4. `src/sections/collection-section.tsx`
- Filtro `em_aberto` (linha 163): aplicar `!isResolvedSituation(p)` em vez do label atual, para o card "Em aberto" refletir só os realmente abertos.
- Garantir que `productCollectionStatus` retorne label neutro ("Resolvido", "Enviado", "Removido") quando o produto não está mais em aberto, para não aparecer como vencido no histórico.

### 5. Migração one-shot dos dados já importados (rodada local no store)
- Em `src/lib/store.ts`, no bloco de auto-sincronização já existente (linha ~1197), adicionar uma passada única que: para todo `Product` com `situation === "Em Aberto"` cujo `financialStatus === "MGMV"`, reescrever para `Resolvido`. Isso conserta retroativamente clientes MGMV que já foram importados errado, sem precisar reimportar.
- Para os demais casos (Retirado/Removido vindos como "Em Aberto"), não há como inferir automaticamente — esses só são corrigidos na próxima importação. Documentar isso no resumo final do importador (já existe o painel de itens ignorados/avisos).

## Validação

- Atualizar/estender `src/sections/import-section.mgmv.test.ts` (ou criar `import-section.situation.test.ts`) cobrindo: planilha com Situação `Retirado`, `Removido`, `MGMV`, `Enviado`, vazia, e texto desconhecido — verificando o `situation` resultante e a lista de warnings.
- Rodar `tsgo --noEmit` e `bunx vitest run` para garantir tipagem e testes.
- Smoke manual: importar um ZIP de exemplo e conferir que o card "Em aberto" e "Valores a Receber" não contam mais os clientes com Situação preenchida.

## Fora de escopo

- Nenhuma mudança em RLS, schema do banco ou edge functions — o bug é 100% client-side de parsing/exibição.
- Sem alteração nos fluxos de MGMV, IA, ou Treinar I.A.
