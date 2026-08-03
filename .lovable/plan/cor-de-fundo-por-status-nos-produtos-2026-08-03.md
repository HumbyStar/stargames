# Cor de fundo por status nos produtos

Objetivo: identificar rapidamente o status financeiro de cada produto (útil na hora de gerar a nota fiscal dos pagos), usando fundos suaves — nada berrante.

## Regra de cores (tons bem suaves, ~10% de opacidade)

- Pago: verde suave
- Reserva: laranja suave
- Pendente: vermelho suave
- Sem status reconhecido: sem cor (como hoje)

## Onde aplica

1. Histórico de Produtos individual (cliente): a linha do produto recebe o fundo suave conforme o status financeiro, e a etiqueta de status na coluna "Status" passa a usar a mesma cor.
2. MGMV → "Produtos incluídos": cada item da lista recebe o mesmo fundo suave conforme o status do produto.

O texto continua com a cor atual para manter a legibilidade em tema escuro; o contraste é verificado nos dois temas.

## Detalhes técnicos

- Criar um helper compartilhado (ex.: `productStatusTone(financialStatus)`) que devolve as classes de fundo/borda por status.
- Adicionar tokens semânticos suaves em `src/styles.css` (ex.: `--status-paid-soft`, `--status-reserva-soft`, `--status-pendente-soft`) e mapeá-los no `@theme inline`, sem cores hardcoded nos componentes.
- Aplicar o helper na `<tr>` do histórico em `src/sections/clientes-section.tsx` e no item da lista de produtos incluídos em `src/sections/mgmv-section.tsx`.
- Estender `Tag` em `src/components/ui-bits.tsx` apenas se for necessária uma variante nova para o laranja de Reserva.
