# Reserva vencida em vermelho (garantir em todas as telas)

## O que está acontecendo

A regra de "Reserva vencida = vermelho" já existe em `src/lib/status-tone.ts`, mas ela não chega igual em todas as telas:

- Em MGMV, o item de "Produtos incluídos" tem um fundo fixo de card aplicado junto com o fundo do status, o que pode anular a cor vermelha.
- A função que deixa a palavra do status em vermelho negrito (`productStatusTextTone`) foi criada mas não está sendo usada em nenhum lugar — então a "letra" do status não fica vermelha.
- Na tela de Cobrança as linhas não usam a cor de status.

## O que muda

1. Histórico de produtos do cliente: a palavra do status ("Reserva vencida" / "Pendente") passa a aparecer em vermelho negrito, além do fundo vermelho suave da linha.
2. MGMV: o item de produto deixa de usar o fundo fixo de card quando há cor de status, para o vermelho (e as demais cores) realmente aparecer.
3. Cobrança: as linhas de produto passam a usar as mesmas cores/legenda das outras telas.

Regra final (inalterada): fechados (enviado/removido/retirado) em cinza; pago em aberto em verde; reserva vencida e pendente em vermelho; reserva no prazo em amarelo.

## Detalhes técnicos

- `src/sections/clientes-section.tsx`: aplicar `productStatusTextTone(p)` na `<Tag>`/rótulo do status.
- `src/sections/mgmv-section.tsx`: trocar `bg-card` fixo por fallback condicional (`productStatusTone(p) || "bg-card"`) para evitar conflito de utilitários de background.
- `src/sections/collection-section.tsx`: importar `productStatusTone`/`productStatusTextTone` e aplicar nas linhas/rótulos das tabelas de produtos.
- Sem mudanças de banco ou de regra de negócio — apenas apresentação.
