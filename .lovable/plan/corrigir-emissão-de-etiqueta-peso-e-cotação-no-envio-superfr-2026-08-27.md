# Corrigir emissão de etiqueta, peso e cotação no Envio/SuperFrete

O que os registros de envio mostram (verificado nos logs reais de hoje):

- **Etiqueta não emitida:** todas as falhas de hoje têm o mesmo motivo devolvido pela SuperFrete: `to.phone: O telefone do destinatário deve ter 11 dígitos` (o cadastro tinha 3175262953, com 10 dígitos). O sistema mostra só "Ocorreu um ou mais erros", escondendo o motivo.
- **Cliente marcado como "etiqueta não paga" sem etiqueta:** o envio é gravado no banco **antes** de chamar a SuperFrete. Quando a criação falha, a linha fica como "Etiqueta pendente de pagamento" sem `superfrete_order_id` — hoje há 9 envios nesse estado. É isso que acende o selo nos produtos.
- **Peso com problema:** falhas de cotação com `correios.weight não pode ser maior que 30 kg` (peso 650 enviado em gramas). O detalhe do erro também não aparece na tela.
- **Cotação variando:** na cotação cada caixa é enviada como um volume separado; na criação da etiqueta é enviado um único volume somado. Origens diferentes de cálculo mudam o preço final em relação ao cotado.

## O que muda

### 1. Mensagem de erro real
Quando a SuperFrete recusar, a tela passa a mostrar o motivo campo a campo em português, por exemplo:
"Telefone do destinatário deve ter 11 dígitos (DDD + número)" ou "Peso acima de 30 kg para os Correios".
Nada de "Ocorreu um ou mais erros" sozinho. O erro completo continua no histórico do envio.

### 2. Validação do destinatário antes de chamar a API
Na etapa 2 (destinatário), antes de avançar/cotar:
- telefone normalizado só com dígitos e obrigatoriamente com 11 (DDD + 9). Com 10 dígitos, aviso claro e sugestão de acrescentar o 9;
- CPF/CNPJ com 11 ou 14 dígitos;
- CEP com 8 dígitos.
Campos inválidos bloqueiam o cálculo do frete e a criação da etiqueta, com a mensagem apontando o campo.

### 3. Nada de envio fantasma
A ordem passa a ser: cria a etiqueta na SuperFrete **primeiro**; só com o pedido criado o envio é gravado no banco. Se a SuperFrete recusar, nenhum envio é registrado e nenhum produto ganha o selo de "etiqueta não paga" — apenas o log do erro é guardado.

Além disso, limpeza dos 9 envios já gravados sem pedido na SuperFrete: passam para o status **Falha na emissão**, saindo do selo de etiqueta pendente nos produtos do cliente.

### 4. Cotação e etiqueta com o mesmo pacote
A criação da etiqueta passa a enviar exatamente as mesmas caixas usadas na cotação (um volume por caixa), em vez de um volume único somado. Assim o valor cobrado bate com o valor cotado. A etapa 4 continua mostrando o valor real devolvido pela SuperFrete quando houver diferença.

### 5. Peso validado também no servidor
As regras de peso/medidas (até 30 kg por caixa, mínimo 16 × 11 × 2 cm, máximo 100 cm por lado e 200 cm somados) passam a valer também no servidor, com mensagem que sugere a conversão quando o valor parece estar em gramas.

## Detalhes técnicos

- `src/lib/superfrete.server.ts` / `superfrete.functions.ts`: extrair `response.errors` (objeto campo → mensagens) e montar mensagem amigável em `friendlyError`; manter o corpo bruto em `shipment_logs.response`.
- `src/lib/superfrete.functions.ts`: `createSuperfreteCartOrder` passa a aceitar `shipmentId` opcional e a receber `volumes` como lista (uma por caixa); validação Zod de peso/medidas por caixa.
- `src/components/shipment-wizard-modal.tsx`: `confirm()` inverte a ordem (cart → `createShipment`), normaliza telefone/documento/CEP em `toAddress()`, e a etapa 2 ganha as validações com mensagens por campo.
- `src/lib/shipments.functions.ts`: `createShipment` recebe `superfreteOrderId`, `superfreteStatus` e o preço real, gravando o envio já com o pedido criado.
- Migração de dados: `update shipments set status = 'Falha na emissão' where superfrete_order_id is null and status = 'Etiqueta pendente de pagamento'`; `shipment-label-badge.tsx` ignora esse status.
