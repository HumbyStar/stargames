# Cores por status: reserva vencida em vermelho e fechados em cinza

## O que muda na tela

Regra final de cores nas listas de produtos (Clientes e MGMV):

- Enviado / Removido / Retirado / Resolvido: cinza suave (linha discreta, texto acinzentado), como era antes.
- Pago (em aberto): verde suave.
- Reserva vencida e Pendente: vermelho — fundo vermelho suave e a palavra do status em vermelho negrito, para diferenciar de "Reserva" comum.
- Reserva ainda dentro do prazo: amarelo/laranja, exatamente como está hoje.

A prioridade continua sendo itens em aberto: situação fechada sempre vence e cai no cinza, mesmo que o item esteja pago ou vencido.

## Legenda

A legenda no topo (Clientes, MGMV e Cobrança) passa a ter 4 chips: Pago (verde), Reserva (amarelo), Reserva vencida / Pendente (vermelho) e Enviado/Removido (cinza), cada um com tooltip explicando a regra. O texto de rodapé é ajustado para dizer que fechados ficam em cinza.

## Detalhes técnicos

`src/lib/status-tone.ts`
- `productStatusTone` passa a receber o produto (ou `{ financialStatus, situation, dueDate }`) em vez de só status+situação.
- Ordem de decisão: situação fechada -> `bg-muted/40 text-muted-foreground`; `Pendente` ou (`Reserva` + `isOverdue(dueDate)`) -> `bg-destructive/10`; `Pago` -> verde; `Reserva` -> amarelo.
- Nova função irmã `productStatusTextTone` devolvendo apenas a classe de texto do rótulo (`text-destructive font-semibold` para vencido/pendente, `text-muted-foreground` para fechados, vazio no resto).
- `isOverdue` já existe em `src/lib/store.ts` e é reutilizado.

`src/sections/clientes-section.tsx` e `src/sections/mgmv-section.tsx`
- Chamadas de `productStatusTone(p.financialStatus, p.situation)` passam a `productStatusTone(p)`.
- A `<Tag>` do status recebe a classe de texto de `productStatusTextTone`; itens fechados continuam com variante neutra.
- O rótulo "Reserva vencida" (já calculado por `productCollectionStatus`) fica no mesmo vermelho de Pendente.

`src/components/status-legend.tsx`
- Adiciona os chips "Reserva vencida / Pendente" e "Enviado/Removido" com tooltips e ajusta o rodapé.

Nenhuma mudança de banco de dados ou de regra de negócio — apenas apresentação.
