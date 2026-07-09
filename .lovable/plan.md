## Problema

Hoje `src/sections/clientes-section.tsx` (linhas 181-185) exclui **todo** cliente que tem acordo MGMV do baseRows da seção Clientes:

```ts
.filter((c) => {
  const isMgmv = c.clientType === "mgmv" || (!!c.mgmv && c.mgmv.installments.length > 0);
  return !isMgmv;
})
```

Consequência: um cliente MGMV que também possui produtos comuns em aberto (Pago aguardando envio, Enviado, Pendente, Reserva, etc.) desaparece da seção Clientes e só aparece em MGMV. Todos os chips/filtros da seção Clientes ignoram esses clientes.

## Regra desejada

- **Seção Clientes**: não filtrar por MGMV. Um cliente MGMV aparece aqui se tiver ao menos um produto **fora do MGMV** (qualquer produto com `financialStatus !== "MGMV"`). Todos os chips (reserva_vencida, pendente, pago_aguardando, enviado, abandonou, em_dia, sem_produtos, todos) passam a considerá-lo normalmente.
- **Seção MGMV**: comportamento atual mantido (lista todos os clientes com acordo MGMV). Nada a alterar lá — o pedido "aparecer somente em MGMV se não tiver produtos fora do MGMV" já é satisfeito automaticamente: um cliente MGMV puro não tem produtos comuns e portanto não surge na seção Clientes; a exclusividade emerge da nova regra em Clientes.

## Alteração

Arquivo único: `src/sections/clientes-section.tsx`.

Substituir o `.filter` acima por uma regra que só exclua clientes MGMV **puros** (sem produtos comuns):

```ts
.filter((c) => {
  const isMgmv = c.clientType === "mgmv" || (!!c.mgmv && c.mgmv.installments.length > 0);
  if (!isMgmv) return true;
  const ps = productsByClient.get(c.id) ?? [];
  const hasNonMgmvProducts = ps.some((p) => p.financialStatus !== "MGMV");
  return hasNonMgmvProducts;
})
```

O restante da pipeline (agregados `totalPurchased` / `totalOpen`, chips, busca) já opera sobre `r.products` — que inclui os produtos comuns do cliente — então os filtros existentes (`pago_aguardando`, `enviado`, `pendente`, `reserva_vencida`, `abandonou`, `em_dia`) passam a aceitar esses clientes MGMV sem outras mudanças. Produtos com `financialStatus === "MGMV"` continuam contando apenas como itens do card do cliente; não interferem nos chips porque nenhum chip casa esse status.

## Fora de escopo

- Nenhum ajuste em `mgmv-section.tsx`, dashboard drilldown, ou store.
- Nenhuma migração/backend.
- Não altero visual do card do cliente nem exibição do acordo MGMV dentro dele.
