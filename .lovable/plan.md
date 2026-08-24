# Seguro no envio: igualar Correios, Jadlog e Loggi

## O que eu verifiquei no código

- Na **cotação** (`/calculator`) o sistema envia `insurance_value` **e** `use_insurance_value: true` quando o seguro está marcado. Por isso o preço com seguro aparece nos cartões.
- Na **criação da etiqueta** (`/cart`) o sistema envia apenas `insurance_value` — **sem** `use_insurance_value`. Também envia `non_commercial: true`.

Ou seja: cotação e etiqueta não usam exatamente as mesmas opções. Correios (PAC/SEDEX) tratam o valor declarado de forma diferente das transportadoras privadas (Jadlog/Loggi), então a diferença aparece justamente nelas.

Ainda não está confirmado que essa é a causa exata do que você viu — a confirmação vem da resposta real da SuperFrete, que o sistema já guarda no histórico de cada envio.

## Passos

1. **Confirmar com dados reais**: ler os registros de cotação e criação de etiqueta já gravados no histórico de envios, comparando um envio PAC com um Jadlog/Loggi, para ver o que a SuperFrete devolveu quanto ao seguro em cada caso.
2. **Alinhar o payload da etiqueta com o da cotação**: incluir `use_insurance_value` na criação da etiqueta, com o mesmo valor usado no cálculo, para que a etiqueta seja emitida exatamente com o seguro cotado.
3. **Mostrar o seguro por transportadora na etapa 3**: quando o seguro estiver ligado, cada cartão indica se aquela transportadora aceitou o seguro (e o valor protegido) ou se devolveu erro/ignorou, em vez de o usuário descobrir só depois.
4. **Etapa 4 e histórico**: exibir o seguro confirmado pela resposta da SuperFrete (não só o que foi pedido), para o selo e o histórico refletirem a etiqueta real.

## Detalhes técnicos

- `src/lib/superfrete.functions.ts`, `createSuperfreteCartOrder`: adicionar `use_insurance_value: data.insuranceValue > 0` em `options`, mantendo `insurance_value`; reavaliar `non_commercial` quando houver seguro, conforme o retorno da API.
- Ler `payload_quote`/`response_quote`/`payload_cart`/`response_cart` de `public.shipments` e `shipment_logs` para o diagnóstico do passo 1.
- `SuperfreteQuoteOption` ganha o dado de seguro devolvido por serviço (quando presente) e o cartão da etapa 3 em `src/components/shipment-wizard-modal.tsx` passa a mostrá-lo.
- Sem mudanças de schema; nenhuma etiqueta é liberada durante a verificação.
