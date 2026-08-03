# Cores por status só para itens em aberto + filtros de situação

## Regra de cor (o que muda)

Hoje a cor de fundo/etiqueta vem só do status financeiro, então "Pago" e "Pago + Enviado" e "Pago + Removido" ficam todos verdes — o que gera confusão com as situações.

Nova regra:

- Cor suave (verde/laranja/vermelho) **somente quando a Situação for "Em Aberto"**.
- Qualquer outra situação (Enviado, Removido, Retirado, Resolvido, Abandonou, Desistiu) fica **sem cor**, no visual padrão de antes — mesmo que o produto esteja Pago.
- A etiqueta da coluna "Status" segue a mesma regra: colorida só em aberto, neutra nos demais casos.

Isso vale no Histórico de Produtos individual do cliente e na lista de produtos incluídos do MGMV.

A legenda de status ganha uma linha curta explicando: "as cores destacam apenas itens em aberto".

## Filtro

A barra de filtros passa a ter dois grupos:

- Por status: Pago, Reserva, Pendente (como hoje, com contagem).
- Por situação: Em Aberto, Enviado, Removido, Retirado (com contagem).

Ambos são multi-seleção e combinam entre si (status E situação). "Limpar filtro" limpa os dois grupos, e a seleção continua salva no navegador.

Observação: "Retirado" hoje sai da lista ativa e vai para o histórico; ao marcar o filtro "Retirado", esses itens passam a aparecer na lista principal.

## Detalhes técnicos

- `src/lib/status-tone.ts`: `productStatusTone(status, situation)` retorna string vazia quando `isOpenSituation` for falso; usa os helpers de `@/lib/store`.
- `src/sections/clientes-section.tsx`: passar `p.situation` para `productStatusTone`; tornar a Tag de Status neutra fora de "Em Aberto"; novo estado `situationFilter: Set<Situation>` persistido junto com o filtro de status (mesma chave em localStorage, formato objeto), aplicado no `individualProducts` e nas contagens; permitir "Retirado" na lista quando filtrado.
- `src/sections/mgmv-section.tsx`: mesma assinatura nova do helper.
- `src/components/status-legend.tsx`: nota de rodapé sobre cor só em aberto.
