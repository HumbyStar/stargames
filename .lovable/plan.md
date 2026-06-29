## Objetivo

Substituir o fluxo atual de importação por uma experiência única em ZIP que processa em lotes, exibe progresso visual moderno e abre um preview comparativo lado a lado (Clientes comuns × Clientes MGMV) antes de qualquer gravação no banco.

## Escopo

A mudança fica em frontend + camada de pré-processamento/preview. Regras de detecção (parser MGMV, regras financeiras, persistência oficial) ficam intactas.

## Arquivos afetados

- `src/sections/import-section.tsx` — refatorar fluxo: upload → análise em lotes → preview → confirmação. Remover blocos longos de texto. Remover qualquer corte artificial (limites de 2k/5k/etc.).
- `src/components/import-progress-modal.tsx` — substituir pelo novo modal visual (cards + esteira contínua + barra de progresso por lote).
- `src/components/import-preview-modal.tsx` *(novo)* — modal grande com dois painéis internos lado a lado (desktop) / empilhados (mobile).
- `src/components/import-cards.tsx` *(novo)* — cards retangulares reutilizáveis (ícone + título + número + microdescrição + animação count-up/pulse).
- `src/components/import-conveyor.tsx` *(novo)* — esteira CSS com loop infinito; respeita `prefers-reduced-motion`; só finaliza quando `done === true`.
- `src/lib/import-pipeline.ts` *(novo)* — orquestra leitura recursiva do ZIP, extração de HTML/HTM, classificação Comum vs MGMV, processamento em lotes (100–250 arquivos/lote), emissão de eventos de progresso, cancelamento. Reutiliza parsers existentes de `db-sync.ts`.
- `src/lib/import-preview-store.ts` *(novo)* — store em memória do preview (não persiste no banco). Mantém `commonClientsPreview`, `mgmvClientsPreview`, métricas agregadas, filtros independentes por painel.
- `src/lib/db-sync.ts` — expor função `commitImportPreview({ scope: 'common' | 'mgmv' | 'all', preview })` que grava no banco oficial apenas após confirmação. Reusar lógica atual de persistência; remover qualquer caminho que persista antes do preview.
- `src/lib/store.ts` — adicionar limpeza de estado temporário (preview, runtime, sessionStorage de importação) em concluir/cancelar/resetar.

## Fluxo

```text
Upload ZIP
   ↓
import-pipeline: percorre pastas, junta .html/.htm, divide em lotes
   ↓
ImportProgressModal: esteira animada contínua + cards atualizando em tempo real + "Lote X de N"
   ↓ (ao concluir todos os lotes)
animação de sucesso → abre ImportPreviewModal
   ↓
Preview comparativo (Comum | MGMV) com filtros, paginação e ações
   ↓
Rodapé: Cancelar / Importar só comuns / Importar só MGMV / Importar tudo validado
   ↓
commitImportPreview → grava clients, products, mgmv_agreements, mgmv_installments
   ↓
limpa preview/cache/sessionStorage; Dashboard/Clientes/MGMV/Collection leem só dados oficiais
```

## Detalhes técnicos

**Pipeline em lotes**
- `extractZipEntries(file)` → lista completa de `.html/.htm` (sem corte).
- `processBatch(entries, batchSize)` em loop com `await` entre lotes para liberar o event loop; `AbortController` para cancelar.
- Emite `{ batchIndex, totalBatches, filesAnalyzed, totalFiles, counters }` via callback.
- Classifica cada cliente detectado em `common` ou `mgmv` (baseado em parser MGMV atual).

**Cards (`import-cards.tsx`)**
- `<ImportCard icon title value description tone>` com count-up suave (lerp), pulse on change, skeleton enquanto `value === undefined`. Tema claro/escuro via tokens.
- Conjuntos: progresso (arquivos/pastas/HTMLs), comum (clientes/produtos/valores), MGMV (clientes/acordos/parcelas/dívida/revisão/IA), alertas (duplicatas/conflitos/erros/telefones corrigidos).

**Esteira (`import-conveyor.tsx`)**
- Trilho horizontal com sequência infinita de ícones (Arquivo→Pasta→HTML→Cliente→Produto→MGMV→Validação→IA→Preview).
- `@keyframes` translateX com `animation-duration` longo e `iteration-count: infinite`; pausa só quando `state === 'done' | 'cancelled'`.
- Em `prefers-reduced-motion`, reduz para fade entre ícones, mas mantém feedback.

**Preview comparativo (`import-preview-modal.tsx`)**
- Layout `grid lg:grid-cols-2` (desktop) / `flex-col` (mobile). Largura máxima ~1400px.
- Cabeçalho: área de comparação compacta (distribuição %, totais).
- Cada painel: cards próprios, filtros próprios (search, pasta, status, etc.), tabela paginada (10/20/30/40/50), expansão sob demanda. Borda azul/neutra (Comum) vs dourada (MGMV). Badges: Comum, MGMV, Revisão necessária, Revisado com IA, Conflito, Corrigido automaticamente, Duplicata, Pronto para importar.
- Ações por linha: Expandir, Revisar, Revisar com IA (só MGMV em revisão), Aplicar decisão, Remover da importação.
- Filtros 100% independentes entre painéis.

**IA**
- Mantém regra híbrida atual: automática só para MGMV "Revisão necessária", sob demanda nos demais. Botão "Revisar com IA" no painel MGMV. Após aplicar + validação matemática OK, item muda para "Revisado com IA" e sai de "Revisão necessária".

**Confirmação e persistência**
- Rodapé com 4 ações conforme especificado.
- Itens com conflito/revisão necessária exigem confirmação explícita (checkbox "incluir mesmo assim").
- Após salvar: limpa `commonClientsPreview`, `mgmvClientsPreview`, `lastImportPreview`, `processedFiles`, runtime store, chaves de localStorage/sessionStorage de importação, `import_progress` antigo.
- Produtos MGMV recebem `included_in_mgmv = true`, `mgmv_agreement_id`, `collection_eligible = false`.

**Limites artificiais**
- Auditar e remover toda constante tipo `MAX_FILES`, `MAX_PRODUCTS`, `slice(0, N)` no caminho de importação. Substituir mensagens "serão ignorados" por "Volume alto detectado. A importação será processada em lotes para evitar travamentos."

**Performance**
- Tabelas paginadas (mesma `LoadMoreButton`/`usePersistedState` já usados em MGMV/Clientes/Collection). Virtualização só se >2000 linhas visíveis.

## Não alterar

Regras de detecção MGMV, parser por regra, regras financeiras, persistência oficial das tabelas, fluxo de unificação de duplicatas, navegação one-page atual.

## Critérios de aceite

Replicam os 19 itens listados pelo usuário na seção 23: ZIP único, lotes, sem corte, modal moderno, esteira contínua que só para ao concluir, preview comparativo lado a lado/empilhado, cards e filtros independentes por painel, três modos de importação no rodapé, nada salvo antes da confirmação, badge "Revisado com IA" após IA + validação OK, limpeza de cache/preview após persistir.
