# Frete mais caro que no site, revisão da API e desmarcar etiqueta não paga

## 1. Por que o preço sai maior que a cotação feita direto no SuperFrete

Comparando o que enviamos hoje (`src/lib/superfrete.functions.ts`) com o simulador do site:

- **Seguro (valor declarado).** Quando o botão "Enviar com seguro" está ligado, mandamos `insurance_value` com o valor total dos produtos e `use_insurance_value: true`. No simulador do site o padrão é sem valor declarado. Isso sozinho já encarece (Correios cobram taxa sobre o declarado; Jadlog/Loggi ajustam o preço pela cobertura).
- **Uma caixa = um item na cotação.** Dividimos o envio em vários `products` (um por caixa) e cada volume tem cobrança mínima própria. No site normalmente se cota um pacote só, com peso/medida somados — resultado mais barato.
- **Cotação e etiqueta com opções diferentes.** Na cotação (`/calculator`) não enviamos `non_commercial`, mas na criação da etiqueta (`/cart`) enviamos `non_commercial: true`. Opções diferentes = preço diferente entre o que aparece na tela e o que é cobrado.
- **Arredondamento de medidas.** Aplicamos mínimos (`Math.max(1, ...)`) por conta própria, o que pode gerar cubagem diferente da do site.

### O que muda

- A etapa 3 passa a mostrar **duas colunas de preço por serviço: "sem seguro" e "com seguro"**, para ficar explícito quanto o seguro custa. O toggle continua existindo, só deixa de ser um custo invisível.
- Passa a existir a opção **"cotar como pacote único"** (padrão) x **"cotar por caixa"**, para bater com o que o site calcula. Quando houver mais de uma caixa, o sistema mostra os dois valores lado a lado.
- Cotação e etiqueta passam a usar **exatamente o mesmo bloco de opções** (`non_commercial`, `own_hand`, `receipt`, `reverse`, seguro), eliminando a diferença entre cotado e cobrado.
- Abaixo do valor escolhido aparece a linha "cotado X · cobrado Y" quando a SuperFrete devolver preço diferente na criação da etiqueta, com o motivo registrado no histórico.

## 2. Revisão da API SuperFrete: o que já usamos e o que falta

Levantamento da documentação oficial (v0) confrontado com o código, entregue como resumo no chat e aplicado onde fizer sentido:

- Já em uso: `/calculator`, `/cart`, `/checkout`, `/order/info/{id}`, saldo da conta, seguro, plataforma, status sincronizado a cada 3 minutos.
- A avaliar/ativar: `/tag/print` (PDF oficial em vez do PDF de exemplo), `/tag/cancel` (cancelar etiqueta paga por engano), `/user/info` (dados/limites da conta), `/tag/tracking` (rastreio consolidado), e campos ainda não usados no `/cart` (`tags`/`invoice` para número de nota, `platform` já enviado).
- Os itens que dependerem de contrato/permissão da conta ficam listados no relatório, sem serem ativados às cegas.

## 3. Desmarcar etiqueta não paga

Hoje só dá para descartar o selo produto a produto. Passa a ter:

- Botão **"Verificar no SuperFrete"** no selo/ficha: consulta o pedido pela API; se ele não existir mais (ou estiver cancelado), o selo some sozinho e o envio vira "Falha na emissão".
- Ação **"Descartar etiquetas não pagas deste cliente"** na ficha, que limpa de uma vez todos os selos âmbar do cliente, com confirmação e registro no histórico.
- Na seção Envio, filtro **"Etiqueta não paga"** com seleção múltipla e descarte em lote.

## Detalhes técnicos

- `superfrete.functions.ts`: `calculateSuperfreteQuote` ganha `combineIntoSingleParcel` e devolve, por serviço, `priceCents` e `priceWithoutInsuranceCents` (duas chamadas ao `/calculator`, com e sem seguro); bloco `options` extraído para uma função compartilhada com `createSuperfreteCartOrder`.
- Nova `verifySuperfreteLabel(shipmentId)` usando `GET /order/info/{id}`, marcando `Falha na emissão` quando o pedido não existir/estiver cancelado.
- Nova `dismissClientShipmentLabels(clientId)` em `shipments.functions.ts` (lote), reutilizando a lógica de `dismissShipmentLabel` e gravando em `shipment_logs`.
- `shipment-wizard-modal.tsx`: alternador pacote único/por caixa, exibição dos dois preços, linha "cotado x cobrado".
- `shipment-label-badge.tsx` / `clientes-section.tsx` / `envio-section.tsx`: ações de verificar e descartar em lote.
- Sem alterações de schema; nenhuma mudança em cobrança, MGMV ou importação.
