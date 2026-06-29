## Objetivo

Expandir a lógica de cards clicáveis (já implementada no Dashboard via `DashboardDrilldownModal`) para **todas as áreas** do sistema: Clientes, MGMV, Collection, Importação, Preview de Importação, Detalhe do Cliente e Detalhe MGMV.

Cada card de resumo passa a abrir um modal padrão com **lista filtrada do próprio contexto**, sem misturar dados oficiais com dados temporários de preview.

---

## Arquitetura

### 1. Modal genérico de drill-down `ContextDrilldownModal`

Novo componente em `src/components/context-drilldown-modal.tsx`. Recebe:

```ts
type DrillContext = {
  title: string;
  description?: string;
  origin: string;          // "Seção MGMV", "Preview – Comuns", "Cliente João", etc.
  filterLabel: string;     // "Status = Em atraso"
  rows: DrillRow[];        // já filtradas pelo chamador
  totalValue?: number;
  columns?: ("status" | "due" | "value" | "meta")[];
  actions?: DrillAction[]; // openClient | whatsapp | markPaid | markShipped | openAgreement | payInstallment
  onGoToSection?: () => void; // opcional — não aparece em contextos de preview
};
```

Estrutura visual reaproveita o padrão do `DashboardDrilldownModal` (header, chips de filtro ativo + total, busca, tabela com ações por linha, footer com **Limpar filtro / Ver na seção / Fechar**). Renderização sob demanda (rows só são montadas quando o modal abre — lazy via `useMemo` no componente pai).

### 2. Registro central `card-registry.ts`

`src/lib/card-registry.ts` exporta:

```ts
export type CardContextId =
  | "dashboard" | "clients" | "mgmv" | "collection"
  | "import" | "import-common" | "import-mgmv"
  | "client-detail" | "mgmv-detail";

export type CardDescriptor = {
  id: string;                 // ex.: "mgmv-review-required"
  context: CardContextId;
  label: string;
  tooltip: string;
  modalTitle: string;
  filterLabel: string;
  actions: DrillActionKind[];
};

export const CARD_REGISTRY: Record<string, CardDescriptor> = { ... };
```

O registry concentra **título, tooltip, filterLabel e ações** por card. Cada seção apenas referencia `CARD_REGISTRY["clients-with-reservation"]` em vez de duplicar strings.

### 3. Reuso do `MetricCard`

`MetricCard` já aceita `onClick` + `tooltip` + visual de hover/chevron — **não muda**. Cards informativos continuam sem `onClick` e parecem informativos.

---

## Mapa de cards a tornar clicáveis

### Seção Clientes (`src/sections/clientes-section.tsx`)
- Total de Clientes → lista comuns
- Clientes com Pendência → clientes com produto pendente/vencido
- Clientes em MGMV → roteia para seção MGMV (chip todos)
- Pagos aguardando envio → produtos pagos sem envio

### Seção MGMV (`src/sections/mgmv-section.tsx`)
- Clientes MGMV → todos
- Acordos ativos → `chip = ativos`
- Em atraso → `chip = vencidos`
- Revisão necessária → `reviewStatus = review_required`
- Quitados → `chip = quitados`
- Revisados com IA → `reviewStatus = ai_reviewed`
- Saldo total → ordenado por maior saldo restante

### Seção Collection (`src/sections/collection-section.tsx`)
- Total em atraso → cobranças com `daysLate > 0`
- Clientes inadimplentes → distinct clients in atraso
- Reservas vencidas → `filter = reserva_vencida`
- Pendentes vencidos → `filter = pendente_vencido`
- Parcelas MGMV vencidas → MGMV overdue installments
- Valor total restante → ordenado por valor restante

### Detalhe do Cliente (`clientes-section.tsx` — modal `ClientDetail`)
- Total Comprado / Pago / Restante → filtra produtos do cliente
- Produtos → todos do cliente
- MGMV → abre acordo MGMV daquele cliente
- Cards do bloco MGMV (Saldo, Parcelas pagas, Parcela mensal) → filtra parcelas

### Importação (`src/sections/import-section.tsx`)
- Cards do **resumo geral** (linhas 2120/2294/2743/2871) → lista temporária do preview com filtro
- Painel **Comuns**: Clientes / Produtos / Reservas / Pendências / Duplicatas / Telefones corrigidos
- Painel **MGMV**: Clientes / Acordos detectados / Revisão necessária / Revisados IA / Conflitos / Saldo

**Importante:** clique em card de preview **abre modal interno ao próprio import-section** com dados temporários — nunca despacha para seções oficiais e nunca persiste nada.

---

## Filtros que precisam ser deep-linkáveis

Já existem (`usePersistedState`):
- `mgmv.chip`
- `clientes.chip`
- `collection.filter`

Adicionar suporte (se ausente) para chips faltantes — verificar em cada seção e migrar `useState` → `usePersistedState` apenas quando necessário para deep-link.

---

## Visual / UX

- Cards clicáveis: hover lift + chevron + tooltip (já existe).
- Cards informativos (ex.: valores agregados sem ação concreta) **permanecem sem onClick** — não fingem ser clicáveis.
- Modal mostra badge "Origem: <card>" + chip "Filtro: <filterLabel>" + botão "Limpar filtro" (= fecha) + "Ver na seção" (quando aplicável).
- Performance: tabela renderiza com `slice(0, 200)` + busca; nada é montado até clique.

---

## Restrições

- **Não** mudar parser de importação, regras MGMV/financeiras, persistência, estrutura do Dashboard atual.
- Preview temporário **nunca** alimenta seções oficiais.
- Dashboard drilldown existente continua funcionando inalterado.

---

## Entregáveis

1. `src/components/context-drilldown-modal.tsx` — modal genérico reutilizável.
2. `src/lib/card-registry.ts` — descriptors centralizados.
3. Edições em `clientes-section.tsx`, `mgmv-section.tsx`, `collection-section.tsx`, `import-section.tsx` para fiar onClick + abrir modal local com rows filtradas.
4. Sem mudanças em `_authenticated.index.tsx` (Dashboard já pronto).
