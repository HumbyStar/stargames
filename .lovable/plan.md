## Diagnóstico

O sistema hoje carrega **tudo em memória** via `db-sync.ts::hydrateStoreFromDb()` (chamado no boot da app), usando `fetchAllRows` para `clients`, `products`, `mgmv_agreements`, `mgmv_installments`, `import_history`. Tudo vai para um Zustand store (`src/lib/store.ts`, 1165 linhas) e cada seção faz `useStore(s => s.products)` + `.filter()` em arrays locais.

Arquivos-gargalo mapeados:
- `src/lib/db-sync.ts` — `fetchAllRows` sem paginação, chamado no hydrate
- `src/lib/store.ts` — estado monolítico persistido
- `src/sections/clientes-section.tsx` (1900L) — filtra todos os produtos localmente
- `src/sections/collection-section.tsx` (1144L) — deriva collection de `allProducts`
- `src/sections/mgmv-section.tsx` (1058L) — carrega todas as parcelas
- `src/routes/_authenticated.index.tsx` — Dashboard usa `computeDashboardAggregates(clients, products)` em cima do store inteiro
- `src/sections/import-section.tsx` (4298L) — preview pesado

Isso é o motivo do travamento pós-importação: milhares de linhas em memória + `.filter/.sort/.map` recalculando a cada render de cada seção da one-page.

## Estratégia (7 lotes, um por vez, com relatório entre lotes)

Refatoração grande — proponho executar **um lote por turno** conforme a seção 17 do pedido, com validação (build + smoke test no preview) entre lotes. Cada lote é reversível isoladamente.

### Lote 0 — Infra de queries server-side (base, sem mudar UI)
- Criar `src/lib/api/` com server functions paginadas:
  - `listClients.functions.ts` — `{ page, pageSize, search, sortBy, sortDir, filters }` → `{ rows, total }` usando `range()` + `count: 'exact'` no Supabase
  - `listProducts.functions.ts` — idem, com filtros por `client_id`, `financial_status`, `situation`, `platform`, `due_date`, `included_in_mgmv`
  - `listCollection.functions.ts` — só itens cobráveis (WHERE server-side espelhando `shouldAppearInCollection`)
  - `listMgmvAgreements.functions.ts` + `listMgmvInstallments.functions.ts`
  - `getDashboardAggregates.functions.ts` — retorna só contadores (SELECT count(*) por status/situação, sem trazer linhas)
  - `getClientDetail.functions.ts` — cliente + agregados + produtos paginados
- Migração SQL adicionando índices faltantes:
  - `products (client_id)`, `products (financial_status, situation)`, `products (due_date)`, `products (included_in_mgmv)`
  - `clients (phone_normalized)`, extensão `pg_trgm` + índice GIN em `clients.name` e `products.product_name`
  - `mgmv_agreements (client_id, status)`, `mgmv_installments (agreement_id, due_date)`
- Hook `useServerTable(queryKey, fetcher, { page, pageSize, search, filters, debounceMs: 400 })` reutilizável, encapsulando useQuery + debounce + keepPreviousData.

### Lote 1 — Dashboard leve
- Trocar `computeDashboardAggregates` local por `getDashboardAggregates` server function (uma única RPC que retorna os ~15 contadores via `count` queries paralelas).
- Cards clicáveis abrem modal/drilldown já existente, que agora usa `listProducts` paginado com filtro pré-aplicado.
- Remover dependência do Dashboard sobre `store.clients` / `store.products`.

### Lote 2 — Seção Clientes com paginação server-side
- Substituir o array local por `useServerTable` chamando `listClients` (page/pageSize/search/sort).
- Debounce 400ms no campo de busca.
- Lista de clientes exibe **apenas resumo** (contadores por cliente vindos do banco).
- Ao abrir `ClientDrawer`, chamar `getClientDetail(clientId)` para carregar produtos daquele cliente sob demanda.
- Manter toolbar de bulk actions em produtos individuais (já implementada).

### Lote 3 — Collection sob demanda
- Query server-side retornando só itens onde `shouldAppearInCollection` é verdadeiro (financialStatus IN (...) AND situation='Em Aberto' AND (dueDate < now OR pendente)).
- Filtros e busca também server-side.
- Paginação real (10/25/50/100).

### Lote 4 — MGMV sob demanda
- `listMgmvAgreements` paginado.
- Parcelas + produtos incluídos carregam só ao expandir um acordo (`listMgmvInstallments(agreementId)`).

### Lote 5 — Realtime controlado + invalidação seletiva
- Substituir qualquer subscribe global por invalidação de queries específicas (`queryClient.invalidateQueries(['products', clientId])` etc.) em resposta a eventos das seções ativas.
- Filtros do usuário preservados.

### Lote 6 — Store enxuto + limpeza
- Remover `hydrateStoreFromDb` fetch-all. O store passa a guardar apenas: sessão, filtros ativos, dados do modal aberto, estado de UI.
- Mutations (create/update/delete) continuam via server functions e invalidam queries.
- Remover uso do store como fonte de listas.

### Lote 7 (opcional) — Virtualização + Importação
- `@tanstack/react-virtual` só onde ainda houver tabela com centenas de linhas (após paginação, provavelmente desnecessário exceto no preview de importação).
- Preview de importação paginado + processamento em Web Worker se ainda travar.

## Detalhes técnicos

- **Server functions**: `createServerFn` com `requireSupabaseAuth` para respeitar RLS por usuário. Retornam DTOs planos `{ rows, total, page, pageSize }`.
- **Índices**: migração única no Lote 0. `CREATE INDEX IF NOT EXISTS` — sem `CONCURRENTLY` (não pode em migração).
- **Query keys**: `['clients', { page, pageSize, search, sort, filters }]` — TanStack Query cuida de dedup/cache.
- **Contratos preservados**: importação com preview, Concierge, fluxo Abandonou→Retirar→Retirado, lápis com confirmação, audit_log — nenhum tocado.
- **Compat**: durante os lotes, quem ainda lê do store continua funcionando (o store só é desligado no Lote 6).

## O que NÃO vou mudar

- Regras de negócio (Collection, MGMV consolidado, importação com preview, Concierge, edição por lápis, audit_log).
- Arquitetura visual (one-page com seções, cards clicáveis, drawers).
- LocalStorage deixa de ser fonte de listas, mas ainda pode guardar preferências de UI (filtros ativos, paginação preferida).

## Próximo passo

Confirme e eu começo pelo **Lote 0** (infra + índices), sem alteração visível de UI. Ao final desse lote reporto: arquivos criados, migração aplicada, e sigo para o Lote 1 no próximo turno.
