## Bug: MGMV — permitir adicionar itens manualmente e exibir total dos produtos incluídos

### Escopo
Editor de acordo MGMV (`src/components/mgmv-agreement-editor.tsx`), usado tanto na seção **MGMV** quanto no modal de ficha do cliente em **Clientes**.

### Mudanças

**1. Adicionar itens manualmente (`MgmvAgreementEditor`)**
- Nova prop `availableProducts: Product[]` — produtos do cliente que **não estão** no acordo (`financialStatus !== "MGMV"`) e ainda podem ser cobrados (não removidos/retirados/quitados fora do MGMV).
- No card "Produtos incluídos", adicionar botão **"+ Adicionar item"** que abre um seletor (dropdown/lista com busca) listando `availableProducts` com nome, plataforma e valor restante.
- Ao confirmar: chamar `updateProduct(id, { financialStatus: "MGMV" })`. Toast "Produto adicionado ao acordo." Sem alterar `totalDebt` automaticamente (spec).
- Se não houver itens disponíveis, mostrar estado vazio: "Nenhum outro produto deste cliente disponível para incluir."

**2. Total dos Produtos Incluídos (sempre visível)**
- Substituir o rótulo atual do card por: **"Produtos incluídos (N) · Total: R$ X,XX"**, onde X = soma de `totalValue - paidValue` dos itens incluídos (o cálculo `productsRemainingTotal` já existe).
- Mostrar também o total considerando somente `totalValue` (valor cheio dos produtos), útil quando parte já foi paga fora do acordo — exibir como sub-linha discreta: "Valor cheio dos produtos: R$ Y,YY".
- Atualizar em tempo real ao remover/incluir itens (o Zustand `updateProduct` já re-renderiza).

**3. Total do acordo permanece manual**
- Nenhuma mudança no comportamento de `totalDebt`. Continua editável manualmente. O botão existente "Ajustar total (…)" segue funcionando quando o usuário quiser sincronizar.

**4. Correção colateral em `mgmv-section.tsx`**
- Onde `<MgmvAgreementEditor products={productsOfClient} />` é chamado, filtrar para `productsOfClient.filter(p => p.financialStatus === "MGMV")` para bater com a semântica do card (já correto em `clientes-section.tsx`, que passa `mgmvProducts`).
- Passar `availableProducts = productsOfClient.filter(p => p.financialStatus !== "MGMV" && !isResolvedSituation(p))` (mesmo filtro em `clientes-section.tsx`).

### Detalhes técnicos
- Nenhuma migração SQL — mudança 100% de UI/estado (o campo `financialStatus` já existe).
- Nenhum novo tipo em `store.ts`. Reutiliza `updateProduct` existente.
- Sem alteração em `MGMVAgreement.installments` — adicionar produto não recalcula parcelas nem total automaticamente.
- Testes existentes de `mgmv-schedule` e parser continuam válidos (sem tocar nessa lógica).

### Arquivos afetados
- `src/components/mgmv-agreement-editor.tsx` — nova prop, seletor de adição, total visível.
- `src/sections/mgmv-section.tsx` — dividir products em `mgmvProducts` / `availableProducts` e passar ao editor.
- `src/sections/clientes-section.tsx` — passar `availableProducts` ao editor.