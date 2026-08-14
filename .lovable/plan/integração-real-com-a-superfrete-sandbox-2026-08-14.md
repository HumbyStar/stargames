# Integração real com a SuperFrete (Sandbox)

Conectar o fluxo de envio já existente (seção Envio/SuperFrete, botão "Enviar" na ficha, assistente em 4 etapas, histórico de envios) à API oficial da SuperFrete em ambiente Sandbox. Nenhum componente visual é recriado: o layout, as etapas, os cards e as tabelas continuam iguais; só a origem dos dados e alguns botões/estados novos dentro das etapas já existentes.

## Chaves e segurança

Serão pedidos os segredos (guardados no backend, nunca no navegador):

- `SUPERFRETE_API_TOKEN` (token do Sandbox)
- `SUPERFRETE_API_BASE_URL` (padrão `https://sandbox.superfrete.com/api/v0`)
- `SUPERFRETE_USER_AGENT` (`Star Games/1.0 (email da conta)`)
- `SUPERFRETE_ENVIRONMENT` (`sandbox`)

Todas as chamadas saem de funções de servidor; o token nunca chega ao front-end nem aos logs (payloads salvos têm cabeçalhos removidos).

## Origem do envio (remetente)

Hoje o remetente é um texto fixo dentro do gerador de etiqueta. Passa a ser configurável em Configurações (card "Envio / SuperFrete"): CEP, nome, telefone, e-mail, endereço, número, complemento, bairro, cidade e UF, guardados nas configurações do app. Faltando qualquer campo obrigatório, o cálculo de frete é bloqueado com mensagem clara.

## O que muda no assistente de envio

Etapa 1 (Produtos) e etapa 2 (Destinatário) continuam iguais. Na etapa 2, antes de avançar, valida-se nome, telefone, CEP, endereço, número, cidade e UF — faltando algo aparece "Complete os dados do destinatário antes de calcular o frete."

Etapa 3 (Transportadora) deixa de mostrar preços simulados:

- Botão **Calcular frete** chama a SuperFrete (`POST /calculator`) com origem, destino, produtos selecionados (peso, medidas, valor declarado) e os serviços PAC, SEDEX, Mini Envios, Jadlog, Loggi e J&T quando disponível.
- A lista de cartões passa a exibir as opções reais: transportadora, serviço, preço, prazo, dimensões devolvidas e erro por serviço quando houver.
- Nenhuma opção é pré-selecionada; o usuário escolhe. As dimensões devolvidas na cotação são guardadas para reuso na etiqueta (sem inventar medidas diferentes).
- A regra de caixas de até 1 kg continua: acima disso o assistente sugere dividir em nova caixa, e o pacote enviado à API respeita esse agrupamento.

Etapa 4 (Revisão) ganha as ações da etiqueta, na mesma moldura atual:

- **Confirmar envio** grava o envio e cria o pedido na SuperFrete (`POST /cart`), gravando `superfrete_order_id`, serviço, preço, prazo e as respostas. Status interno: **Etiqueta pendente de pagamento** — os produtos NÃO viram "Enviado".
- **Liberar etiqueta (Sandbox)** chama `POST /checkout` com confirmação manual e o aviso: "Esta ação libera uma etiqueta no ambiente Sandbox. A etiqueta não possui validade real para postagem." Status vira **Etiqueta liberada / aguardando postagem**.
- **Marcar como enviado** continua sendo uma ação manual (ou automática só quando a SuperFrete reportar `posted`).

## Histórico de envios

No modal "Envios" da ficha, cada envio passa a mostrar status da etiqueta, código de rastreio e link do PDF oficial quando existir, com botão **Atualizar status** (`GET /order/info/{id}`). O PDF de exemplo atual continua disponível enquanto não houver etiqueta oficial.

Mapeamento de status: pending → Etiqueta pendente de pagamento; released → Etiqueta liberada/aguardando postagem; posted → Postado/Enviado; delivered → Entregue; cancelled → Cancelado.

## Erros

Falha na SuperFrete mostra no modal "Não foi possível concluir a operação com a SuperFrete. Verifique CEP, peso, medidas e tente novamente."; o modal não fecha e o erro técnico vai para o log do envio.

## Detalhes técnicos

- Banco: novas colunas em `public.shipments` (`superfrete_order_id`, `superfrete_status`, `selected_service_id`, `selected_service_name`, `estimated_delivery_days`, `tracking_code`, `label_url`, `payload_quote`, `response_quote`, `payload_cart`, `response_cart`, `response_order_info`, `confirmed_at`, `released_at`, `posted_at`, `delivered_at`, `cancelled_at`, campos de destinatário derivados) e nova tabela `public.shipment_logs` (`shipment_id`, `action`, `previous_status`, `new_status`, `message`, `payload`, `response`, `created_by`) com GRANTs, RLS por ambiente (`env`/`sandbox_owner`) e escrita exigindo `shipping.mark_sent`. Os itens continuam no `items` jsonb já existente (evita migrar dados); se preferir tabela separada, `shipment_items` pode ser criada depois.
- Novo `src/lib/superfrete.server.ts`: cliente HTTP com `Authorization: Bearer`, `User-Agent`, `Content-Type`/`Accept`, timeout, normalização de erro e sanitização de payload para log.
- Novo `src/lib/superfrete.functions.ts` com as funções autenticadas `calculateSuperfreteQuote`, `createSuperfreteCartOrder`, `checkoutSuperfreteOrder` e `getSuperfreteOrderInfo` (o `.server` só é importado dentro dos handlers).
- `src/lib/shipments.functions.ts`: `createShipment` passa a gravar os campos da SuperFrete e o status "Etiqueta pendente"; novas `updateShipmentStatus` e `listShipmentLogs`.
- `src/components/shipment-wizard-modal.tsx`: substitui `quoteShipping` local pela chamada ao servidor, adiciona estados de carregamento/erro e as ações de etiqueta na etapa 4 — sem mudar a estrutura de etapas nem os estilos.
- `src/lib/shipping-quotes.ts` fica só com os utilitários de peso/cubagem e o agrupamento de caixas de 1 kg; a tabela fictícia deixa de alimentar o modal.
- `src/components/shipment-history-modal.tsx` e `src/sections/envio-section.tsx` passam a exibir status/rastreio e o botão de atualizar status.
- Nada é alterado em cobrança, MGMV, importação ou clientes.
