## Escopo

Todas as mudanças ficam em `src/components/finance-dashboard.tsx` (mais um util local). Nenhuma mudança em store/DB/backend — os dados já estão disponíveis (`clients`, `products`, `client.mgmv.installments`).

## 1. Corrigir "Top devedores" (saldo real por cliente)

Hoje o cálculo é apenas `Σ(totalValue - paidValue)` dos produtos. Isso ignora dívida MGMV e mistura produtos já contemplados no acordo.

Novo cálculo por cliente:

- **Se cliente tem MGMV**: dívida MGMV = soma das parcelas **não pagas** (`installment.value - (paidAmount ?? 0)` para parcelas com `paid=false`). Mais: dívida de produtos **fora do acordo** (produtos do cliente cujo `financialStatus !== "MGMV"` e `situation === "Em Aberto"`, saldo = `totalValue - paidValue`).
- **Se cliente não tem MGMV**: soma de `totalValue - paidValue` para produtos `situation === "Em Aberto"` e `financialStatus !== "Pago"`.

Filtro: só entra no ranking quem tem saldo > 0. Continua top 6.

## 2. Botão "abrir" em cada linha de Top devedores/compradores

Cada linha ganha um `<Button size="icon" variant="ghost">` (ícone `ArrowUpRight` do lucide) que:

1. Chama `useUiStore.getState().closeFinance()` e `setActiveSection("clientes")` (ou `"mgmv"` se o cliente for MGMV).
2. Chama `useStore.getState().openClient(clientId)` — o drawer/modal do cliente abre automaticamente porque `clientes-section` já observa `openClientId`.

Isso reaproveita o fluxo existente (nenhum modal novo).

## 3. Novo card "Top compradores"

Card irmão do Top devedores. Ranking por **valor total pago** do cliente, mas restrito a clientes **sem pendência**:

Cliente elegível quando:
- **Todos** os produtos do cliente têm `situation ∈ {"Em Aberto","Enviado","Retirado","Retirar","Resolvido"}` (nunca `Desistiu`/`Abandonou`/`Removido`) **E** `financialStatus ∈ {"Pago","Reserva"}` **e não está vencido** (usar `isOverdue(dueDate)` do store para reservas), **E**
- Se tem MGMV: todas as parcelas ou estão `paid=true`, ou têm `dueDate` no futuro (nenhuma parcela vencida em aberto).

Valor = `Σ paidValue` dos produtos + `Σ paidAmount (parcelas pagas)` do MGMV.

Layout: grid muda para 2 colunas já existente, adiciono um 3º card em uma nova linha `grid-cols-1 lg:grid-cols-2` abaixo, ou reorganizo o bloco atual para `lg:grid-cols-3` incluindo Top plataformas + Top devedores + Top compradores. Vou pela segunda opção (mais compacto).

## 4. Gráfico "Fluxo financeiro" — filtro de período + novas séries

**Filtro**: `<Select>` do shadcn no header do card com opções:
- `7 dias` (buckets diários, últimos 7 dias)
- `30 dias` (buckets diários)
- `6 meses` (buckets mensais — atual default)
- `12 meses` (buckets mensais)
- `Todos os anos` (buckets anuais desde o registro mais antigo)

Estado local: `useState<"7d" | "30d" | "6m" | "12m" | "all">`.

Geração dos buckets: uma função pura `buildTimeline(products, clients, mode)` que retorna `{ label, registrado, recebido, aReceber, inadimplencia }[]`:

- `registrado`: soma `totalValue` de produtos cujo `registerDate` cai no bucket.
- `recebido`: soma `paidValue` de produtos no bucket **+** parcelas MGMV com `paid=true` cujo `paidAt` cai no bucket.
- `aReceber`: saldo aberto (`totalValue - paidValue`) de produtos ainda em aberto cujo `dueDate` cai no bucket **+** parcelas MGMV não pagas cujo `dueDate` cai no bucket.
- `inadimplencia`: subconjunto de `aReceber` cujo `dueDate < hoje` (produtos não pagos vencidos + parcelas MGMV vencidas não pagas).

Chart passa a ter 4 `<Area>`s empilháveis (mantendo cores semânticas: registrado=azul, recebido=verde, a receber=amarelo, inadimplência=vermelho — todas via tokens `oklch(...)` já usados).

## Fora de escopo

- Nenhuma alteração em RLS/tabelas/migrations.
- Nenhum novo modal — reaproveita o drawer de cliente existente.
- Nenhuma mudança nos outros KPIs, pie de status, ou top plataformas.
- Sem exportação/CSV do gráfico.

## Detalhes técnicos

- `useMemo` recalcula `topDebtors`, `topBuyers` e `timeline` em função de `[clients, products, timelineMode]`.
- `isOverdue` já é exportado de `@/lib/store`.
- Novo helper `buildTimeline` fica no mesmo arquivo (função pura ~40 linhas). Se crescer, extraio para `src/lib/finance-timeline.ts` — decido durante implementação.
- Botão "abrir cliente" usa `import { useUiStore } from "@/lib/ui-store"` já disponível.
