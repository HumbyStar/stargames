# Envio: medidas por caixa e seguro da SuperFrete

Duas mudanças no assistente de envio (usado na seção Envio/SuperFrete e na ficha do cliente).

## 1. Medidas por caixa, não por produto

A etapa 1 passa a ter duas partes:

- **Produtos** — cartões compactos apenas para selecionar o que vai no envio (nome, plataforma, valor). Sem campos de peso/medidas.
- **Caixas do envio** — lista de caixas com "Adicionar caixa" e remover. Cada caixa tem peso (kg), comprimento, largura e altura (cm). Começa com 1 caixa já preenchida com os valores padrão atuais (0,5 kg / 20×15×10).

Resumo abaixo da lista: número de caixas, peso somado, peso cubado e volume equivalente enviado à SuperFrete.

Havendo mais de uma caixa, o envio continua sendo **uma única etiqueta**: pesos somam, alturas empilham e largura/comprimento usam o maior valor (mesma regra de `combineParcels` já existente). As medidas de cada caixa ficam registradas no histórico do envio.

Avançar exige ao menos um produto selecionado e todas as caixas com peso e medidas válidos (> 0).

## 2. Seguro de envio da SuperFrete

Na etapa 3 (transportadora), um interruptor **"Enviar com seguro (SuperFrete)"**, desmarcado por padrão. Não há campo de valor: o seguro usa o valor dos produtos do próprio envio, como na SuperFrete.

- Ao marcar/desmarcar, o frete é recalculado automaticamente e os preços dos cartões passam a refletir o seguro.
- A etiqueta é criada com a mesma opção de seguro escolhida, então o valor real cobrado na liberação já inclui o seguro.
- A etapa 4 mostra "Seguro: sim/não" e o valor protegido, junto do valor real do frete e do saldo.

## Detalhes técnicos

- `src/components/shipment-wizard-modal.tsx`: substitui `measures: Record<productId, Measures>` por `boxes: Box[]` (id, weightKg, lengthCm, widthCm, heightCm); `parcel` passa a usar `combineParcels(boxes)`. Novo estado `insured: boolean`; muda a dependência do efeito de cotação para refazer o cálculo quando `insured` muda.
- `insuranceValue` enviado a `calculateSuperfreteQuote` e `createSuperfreteCartOrder` = soma de `totalValue` dos produtos selecionados quando `insured` está ligado, `0` quando desligado (o backend já converte isso em `use_insurance_value`/`insurance_value`).
- `src/lib/shipments.functions.ts` / `createShipment`: grava as caixas e o sinalizador de seguro no envio (payload de itens/medidas já persistido), sem alterar regras de permissão.
- `src/components/shipment-history-modal.tsx`: exibe caixas e seguro no detalhe do envio.
- Sem mudanças de schema além do campo de metadados do envio, caso necessário para as caixas.
