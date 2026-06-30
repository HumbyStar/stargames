## Diagnóstico da lentidão

Mapeei a árvore principal (`/` → `OnePage`) e os pontos críticos de performance. A lentidão tem 4 causas combinadas:

### 1. A home renderiza TODAS as sessões grandes ao mesmo tempo
`src/routes/_authenticated.index.tsx` monta simultaneamente `DashboardSection`, `ClientesSection` (1.378 linhas), `EquipeSection` (764), `MGMVSection` (719) e `CollectionSection` (979) — todas com tabelas, filtros e cálculos. Cada navegação por âncora (`#clientes`, `#mgmv`, etc.) só rola a página; o React continua mantendo tudo montado e re-renderizando.

### 2. `useStore()` sem seletor causa re-render em cascata
Locais que assinam o store inteiro (qualquer mudança de qualquer campo dispara render completo das sessões pesadas):
- `_authenticated.index.tsx:48` → `const { clients, products } = useStore();`
- `clientes-section.tsx:89` → desestruturação ampla
- `collection-section.tsx:80`
- `mgmv-section.tsx:130`
- `import-section.tsx:983`
- `dashboard-drilldown-modal.tsx:327`
- `concierge-modal.tsx`, `finance-dashboard.tsx`

Zustand sem seletor compara por igualdade referencial do estado inteiro — qualquer `set(...)` re-renderiza tudo. Combinado com (1), uma única edição (pagamento, abrir cliente, mudar filtro persistido) re-renderiza ~7.000 linhas de JSX.

### 3. Filtros pesados sem memoização estável
`clientes-section` reconstrói `rows` (lista, soma, status por cliente) a cada render. Como dependências instáveis vêm de `useStore()` sem selector, `useMemo` não ajuda (o array `clients/products` é nova referência a cada `set`). O mesmo padrão aparece em `collection-section` e `mgmv-section`.

### 4. Persistência síncrona em cada mutação
Cada `addProduct`, `updateProduct`, `registerPayment` chama `dbUpsertProduct` dentro do `set` (linhas 513–651 em `store.ts`). São N chamadas sequenciais ao backend durante operações em lote (importação, pagamentos múltiplos), o que trava a UI thread porque o `set` é processado de forma contígua.

## Mudanças propostas

### A. Code-splitting da home — ganho principal
- `src/routes/_authenticated.index.tsx`: converter `ClientesSection`, `EquipeSection`, `MGMVSection`, `CollectionSection` em `lazy()` envoltos em `<Suspense fallback={<SectionSkeleton />}>`.
- Carregar cada sessão apenas quando entra no viewport (`IntersectionObserver` em um wrapper `<LazySection id="clientes">`). Resultado: a primeira pintura mostra só Dashboard; as outras sessões só montam ao rolar/navegar até elas.
- Arquivos novos: `src/components/lazy-section.tsx`.

### B. Trocar `useStore()` por seletores granulares
Refatorar os 7 pontos listados acima para selecionar apenas o que cada componente usa, com `useShallow` quando precisar de várias propriedades:
- `import { useShallow } from "zustand/react/shallow"`
- Ex.: `const { clients, products } = useStore(useShallow((s) => ({ clients: s.clients, products: s.products })))`
- Ações (`addClient`, `updateProduct`, etc.) viram seletores individuais — funções têm referência estável, então não causam render.

Sem isso, o code-split de (A) é parcialmente desperdiçado: abrir um modal ainda dispararia render das sessões montadas.

### C. Memoização efetiva nas sessões pesadas
Depois de (B), `useMemo` em `rows`/`filtered`/`totals` passa a funcionar (deps estáveis). Estabilizar:
- `clientes-section.tsx` `rows` (linhas 144–214)
- `collection-section.tsx` filtro `em_aberto` e listas derivadas
- `mgmv-section.tsx` agregações por cliente
- Indexar `products` por `clientId` uma única vez com `useMemo(() => groupBy(products, 'clientId'), [products])` para eliminar o `products.filter(p => p.clientId === c.id)` em O(N×M).

### D. Debounce de persistência no store
Em `src/lib/store.ts`, trocar as chamadas diretas `dbUpsertProduct(...)` dentro de `set(...)` por um agregador `queueProductUpsert(prod)` que coalesça por `id` e faz `dbUpsertProductsAsync(batch)` em `requestIdleCallback`/microtask. Mesmo padrão para `dbUpsertClient`. Mutações isoladas pela UI continuam com latência similar; operações em lote (importação, regravação de situações no `hydrate`) deixam de bloquear.

### E. Quick wins adicionais
- `src/components/app-layout.tsx` (1.086 linhas com vários `useEffect`): mover handlers de scroll/intersection para `passive: true` e garantir cleanup; revisar o `useEffect` na linha 1024 (`setTimeout` sem cleanup).
- `tutorial-runner.tsx`: o loop `setTimeout(tryFind, 120)` por 20 tentativas (linhas 89–91) roda em paralelo com renders pesados. Adicionar guarda `cancelled` no cleanup.

## Validação

- `tsgo --noEmit` e `bunx vitest run` (54 testes existentes).
- Smoke com Playwright headless: medir `performance.now()` entre o clique em "Ver Clientes" e a primeira pintura visível da tabela; alvo < 500 ms com ~1k clientes / ~3k produtos.
- Verificar via React DevTools Profiler (manual) que abrir/fechar um modal não re-renderiza `ClientesSection` quando o foco está no Dashboard.

## Ordem de execução (incremental, cada passo é mergeable)

1. (B) Seletores granulares — refator mecânico, baixo risco.
2. (A) Lazy sections + IntersectionObserver — maior ganho perceptível.
3. (C) Memoização e índice por `clientId`.
4. (D) Debounce de upsert.
5. (E) Limpeza de efeitos.

## Fora de escopo

- Sem mudanças de schema, RLS, edge functions ou regras de negócio (MGMV, importador, IA).
- Sem alteração visual; apenas estrutura de render e persistência.
