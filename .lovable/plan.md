## Objetivo

Reduzir o volume de dados processado nas seções da one-page (Clientes, MGMV, Cobranças) removendo o filtro "Todos" — que hoje força cada varredura (`useMemo` de filtro + highlight + `matchCols`) sobre 100% dos registros a cada tecla digitada na navbar. As seções passam a operar sempre sobre um **subconjunto operacional pequeno**, e o acesso a "tudo / histórico" acontece via **modal dedicado lazy**, fora do fluxo principal.

## Escopo das mudanças

### 1. Defaults das seções (chip inicial)

Trocar o `initial` do `usePersistedState` do chip em cada seção:

| Seção      | Chip default hoje | Novo default          |
| ---------- | ----------------- | --------------------- |
| Clientes   | `todos`           | `pago_aguardando`     |
| MGMV       | `todos`           | `em_atraso`           |
| Cobranças  | `todos`           | `em_aberto`           |

Chaves persistidas afetadas: `clientes.chip`, `mgmv.chip`, `collection.filter`. Fallback só se aplica quando o valor salvo for `"todos"` ou vazio (usuários que já têm outro chip salvo mantêm sua escolha).

### 2. Remover chip "Todos" dos headers das seções

- `src/sections/clientes-section.tsx`: retirar `{ id: "todos", label: "Todos" }` do array `chips` (linha ~358).
- `src/sections/mgmv-section.tsx`: retirar `{ id: "todos", ... }` do array `chips` (linha ~458).
- `src/sections/collection-section.tsx`: retirar `{ id: "todos", label: "Todos" }` (linha ~355).
- Manter "Enviado" e "Retirado/Abandonou" como chips selecionáveis (conforme decisão), só nunca como default.
- `clearAll()` de cada seção passa a resetar para o **novo default operacional** em vez de `"todos"`.
- Manter o tipo `Filter` / `ChipFilter` incluindo `"todos"` para compatibilidade com estado persistido antigo e com o drill-down do modal — só sumimos do array visível de chips.

### 3. Cards do dashboard → modal dedicado lazy

Em `src/routes/_authenticated.index.tsx`, os cards que hoje apontam para filtros "amplos" mudam de destino:

| Card                        | Comportamento hoje                        | Novo comportamento                     |
| --------------------------- | ----------------------------------------- | -------------------------------------- |
| Total Clientes              | drill → `clientes.chip = todos`           | abre `HistoryModal` (contexto: clientes) |
| Desistências                | drill → `clientes.chip = todos`           | abre `HistoryModal` (contexto: desistiu) |
| Abandonos                   | drill → `clientes.chip = abandonou`       | abre `HistoryModal` (contexto: abandonou) |
| Clientes MGMV               | drill → `mgmv.chip = todos`               | abre `HistoryModal` (contexto: mgmv-todos) |

Os cards operacionais continuam com drill-down direto: Reservas Ativas, Reservas Vencidas, Pendências, MGMV Vencidas, Pagos Ag. Envio.

### 4. Novo modal `HistoryModal`

Novo arquivo `src/components/history-modal.tsx`, importado via `React.lazy` no `_authenticated.index.tsx` (só monta ao abrir).

- Recebe `context: "clientes-todos" | "desistiu" | "abandonou" | "mgmv-todos"` e o `open/onOpenChange`.
- Reusa `useStore` para ler `clients`/`products` e monta a lista **dentro do modal**, com sua própria paginação (`usePaginatedList`, step 10) e input de busca local.
- Nenhum estado do modal reflete nas seções da one-page — completamente isolado (`ui_state` separado, ex.: `history.search`).
- UI mínima: título contextual, busca, tabela enxuta (Nome, Telefone, Produto, Situação/Status), botão "Ver na seção" que fecha o modal, seta o chip correspondente (`enviado`, `abandonou`, etc.) e rola até a seção.
- Fechado por padrão → **zero custo enquanto o usuário não clica**.

### 5. Impacto na busca da navbar

O comportamento atual (navbar espelha para `clientes.search`, `mgmv.search`, `collection.search`) permanece igual. Como cada seção agora filtra sobre um subconjunto muito menor (pendências / atrasos / em aberto), o custo por keystroke cai proporcionalmente. `HistoryModal` **não escuta** a busca global — tem input próprio.

### 6. Testes/verificação

- Abrir a one-page: confirmar que Clientes mostra só "Pago aguardando envio", MGMV só "Em atraso", Cobranças só "Em aberto".
- Digitar na navbar: verificar que highlight e `matchCols` operam sobre o subconjunto (contador reduzido).
- Clicar em Total Clientes / Desistências / Abandonos / Clientes MGMV: abre o modal, não faz scroll.
- Clicar em Reservas Vencidas / Pendências / MGMV Vencidas / Pagos Ag. Envio: continua fazendo scroll + aplicando chip.
- Chip "Enviado" e "Retirado/Abandonou" continuam clicáveis manualmente nas seções (mostram os dados quando selecionados).

## Arquivos afetados

- `src/sections/clientes-section.tsx` — remover chip "Todos", novo default, ajustar `clearAll`.
- `src/sections/mgmv-section.tsx` — idem.
- `src/sections/collection-section.tsx` — idem.
- `src/routes/_authenticated.index.tsx` — redirecionar 4 cards para `HistoryModal`, importar via `lazy`.
- `src/components/history-modal.tsx` — **novo**, contém a lista completa/histórica com busca isolada.

## Ganho esperado

- Primeira montagem das seções: filtragem já entrega poucos itens → `useMemo` inicial mais barato.
- Cada keystroke da navbar: highlight/`matchCols` varre subconjunto (pendências) em vez do dataset inteiro.
- Cards "de histórico" só custam CPU quando o usuário abrir o modal.
- Nenhuma perda funcional: histórico continua acessível em 1 clique.
