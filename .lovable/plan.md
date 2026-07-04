## Objetivo

Adicionar **5 botões de ação** direto na linha do cliente na tabela principal de **Clientes** (mesma célula onde hoje ficam "lápis / Abrir / + Produto"), sem precisar abrir modal ou expandir:

1. **Editar** (ícone lápis) — já existe, sem mudança.
2. **Pago**
3. **Enviado**
4. **Retirar**
5. **Removido**

Como cada cliente tem N produtos, os 4 botões de status agem **em lote** sobre os produtos do cliente que ainda estão em aberto (situation `Em Aberto` / `Abandonou` / `Desistiu` — não toca em produtos já `Enviado`, `Retirar`, `Retirado`, `Removido`). Isso reproduz o comportamento "atualizar status" no nível de cliente sem exigir clique por produto.

Também aparece no modal do cliente (`ClientDrawer`), por produto, conforme já planejado antes.

## Regras de cada botão (linha do cliente)

Todos aplicam via handlers já existentes na store (`updateProduct`, `setProductSituation`) — sem nova lógica de negócio:

- **Pago**: para cada produto com `financialStatus !== "Pago"` e situação em aberto → `updateProduct(id, { paidValue: totalValue, financialStatus: "Pago" })`. Toast: "N produto(s) marcados como pagos".
- **Enviado**: `window.confirm("Marcar todos os produtos em aberto como Enviado?")` → para cada produto em aberto → `setProductSituation(id, "Enviado")`. Toast igual.
- **Retirar**: `window.confirm(...)` → para cada produto em aberto → `setProductSituation(id, "Retirar")`.
- **Removido**: `window.confirm(...)` → para cada produto em aberto → `setProductSituation(id, "Removido")`.

Se o cliente não tem produtos em aberto, os 4 botões ficam **desabilitados** (visual claro de que não há nada a atualizar). O contador de produtos aplicáveis vira `title` do botão (tooltip) — ex.: "Marcar 3 produto(s) como Pago".

## Layout

Na célula de ações da linha do cliente (~L759-824, `src/sections/clientes-section.tsx`), quando NÃO está em modo edição e NÃO está compacto:

```
[lápis] [Abrir] [+ Produto] [Pago] [Enviado] [Retirar] [Removido] [Cobrança?]
```

- Botões novos: `size="sm" variant="outline"` para consistência.
- No modo compacto: manter apenas [lápis] [Abrir] + os 4 de status (esconde "+ Produto" e "Cobrança" como já é feito hoje) — assim os 5 pedidos ficam sempre visíveis.
- Nada muda quando `clientEdit.isEditing(r.client.id)` está ativo (mantém `RowEditActions`).

## Modal do cliente

Manter o plano anterior: substituir o bloco condicional (~L1443-1504) por [lápis] [Pago] [Enviado] [Retirar] [Removido] fixos por produto.

## Verificação

1. Tabela principal de Clientes: cada linha exibe os 5 botões inline.
2. Cliente com 3 produtos em aberto → clicar "Pago" na tabela → todos os 3 viram Pago (badge do cliente atualiza para "Pago ag. envio"), toast confirma quantidade.
3. Clicar "Enviado" com confirm → situações dos abertos viram Enviado.
4. Cliente sem produtos em aberto → botões de status desabilitados; lápis e Abrir seguem funcionando.
5. Abrir modal do cliente → tabela de produtos individuais mostra por linha [lápis] [Pago] [Enviado] [Retirar] [Removido].

## Arquivos afetados

- `src/sections/clientes-section.tsx` — apenas duas células de ações (linha da tabela do cliente ~L759-824 e linha do produto no drawer ~L1443-1504). Nenhuma mudança de store, tipos, ou outros componentes.
