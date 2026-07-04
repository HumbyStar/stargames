## Mudanças na busca global (navbar)

### 1. `src/components/app-layout.tsx` → `SearchBox`

**Remover busca por produto.** Hoje `results` mescla `clientMatches` + `productMatches`. Manter apenas resultados de **clientes** e **acordos MGMV**.

Novo shape de `results`:

```ts
{ type: "client"; id: string; title: string; subtitle: string; statusLabel: string }
| { type: "agreement"; id: string; clientId: string; title: string; subtitle: string; statusLabel: string }
```

Lógica:

- **Clientes**: match por nome (case-insensitive) ou telefone (dígitos). Igual ao atual, sem produtos.
- **Acordos**: itera `clients` que tenham `client.mgmv`; casa quando o nome do cliente casa o termo OU quando o termo bate número de parcelas / valor / algum id do acordo. Escopo simples: match pelo nome do cliente do acordo. `title = "Acordo MGMV — <cliente>"`, `subtitle = "N/M parcelas · <restante>"`.
- Limitar 6 clientes + 6 acordos.
- Placeholder do input: `"Buscar cliente ou acordo..."` (remover "produto").

**Reaproveitar `generalStatus(client, products)`** (exportar de `clientes-section.tsx` OU duplicar helper local em `app-layout.tsx` importando `store` — vou **exportar** `generalStatus` já existente para evitar duplicação). Ela devolve `{ label, variant }` com labels: `"Reserva vencida"`, `"Pendente"`, `"MGMV"`, `"Pago ag. envio"`, `"Enviado"`, `"Sem produtos"`, `"Em dia"`.

Também considerar produtos com `financialStatus === "Reserva"` NÃO vencidos: para mapear "reserva simples" → amarelo, checar `ps.some(p => p.financialStatus === "Reserva" && isOpenSituation(p))` como fallback antes de "Em dia".

### 2. Borda colorida por resultado

Cada `<button>` de resultado ganha borda esquerda grossa (`border-l-4`) via `statusLabel`:

| statusLabel                           | Borda                        |
| ------------------------------------- | ---------------------------- |
| `Em dia`                              | `border-l-blue-500` (azul)   |
| `Pendente`                            | `border-l-red-500` (vermelho)|
| `Reserva vencida` / reserva em aberto | `border-l-yellow-500` (amarelo) |
| `Pago ag. envio`                      | `border-l-green-500` (verde) |
| `MGMV` / `Enviado` / `Sem produtos`   | `border-l-transparent`       |

Aplicar via `cn(..., statusToBorder(statusLabel))`. Cores diretas Tailwind (não são semânticas do design system, mas o pedido é literal e explícito — azul/vermelho/amarelo/verde).

Também exibir um pequeno badge com o `statusLabel` na direita do item (substitui o "Cliente"/"Produto" atual), para reforçar o motivo da cor. Ícone: `User` para cliente, `FileText` (já disponível em lucide) ou `Package` para acordo.

### 3. Seleção

`handleSelect`:
- `client` → mantém (`openClient(id)` + scroll para `#clientes`).
- `agreement` → `openClient(clientId)` + scroll para `#clientes` (o modal do cliente já mostra o acordo MGMV).

## Verificação

1. Buscar por termo que hoje casa um produto (ex.: `"PS5"`) → não retorna mais produtos, só clientes que tenham "PS5" no nome/telefone (nenhum, provavelmente) e/ou acordos.
2. Buscar por nome de cliente com produto pago aguardando envio → resultado com borda verde.
3. Cliente com reserva vencida → borda amarela.
4. Cliente com pendência → borda vermelha.
5. Cliente em dia → borda azul.
6. Cliente com acordo MGMV → aparece um resultado extra "Acordo MGMV — <cliente>", com borda conforme status geral do cliente.

## Arquivos afetados

- `src/components/app-layout.tsx` — `SearchBox` (remover ramo product, adicionar ramo agreement, aplicar bordas).
- `src/sections/clientes-section.tsx` — exportar `generalStatus` (é `function generalStatus(...)`, virar `export function generalStatus(...)`).

Sem mudanças em store/tipos.
