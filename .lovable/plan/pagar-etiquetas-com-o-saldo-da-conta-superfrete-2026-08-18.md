# Pagar etiquetas com o saldo da conta SuperFrete

Hoje o sistema cria a etiqueta e chama a liberação, mas não mostra nada sobre a sua carteira: quando falta saldo, só aparece o erro depois da tentativa. A ideia é trazer o saldo da sua conta SuperFrete para dentro do Star Games e usar esse saldo para pagar as etiquetas com confiança.

## O que muda para você

1. **Saldo visível**
   - Um indicador "Saldo SuperFrete: R$ X" aparece no passo de confirmação do envio, na sessão Envio/SuperFrete e no card de configuração do remetente.
   - Botão para atualizar o saldo na hora.

2. **Pagar etiqueta com saldo**
   - No passo final do envio, o botão passa a ser "Pagar etiqueta com saldo (R$ 26,08)", mostrando o valor da etiqueta e o saldo restante estimado.
   - Se o saldo for menor que o valor, o botão fica desabilitado com o aviso "Saldo insuficiente — faltam R$ Y" e um link para recarregar na SuperFrete.
   - Após o pagamento, o saldo é atualizado na tela e o selo do produto muda de "Etiqueta não paga" (âmbar) para "Etiqueta" (azul).

3. **Pagamento em lote**
   - Na sessão Envio/SuperFrete, selecionar vários envios com etiqueta não paga e pagar todos de uma vez, com um resumo do custo total contra o saldo antes de confirmar.

4. **Histórico**
   - Cada pagamento, pendência ou falha continua registrado na linha do tempo do envio, agora incluindo o saldo antes e depois da operação.

## Detalhes técnicos

- Nova server function `getSuperfreteBalance` em `src/lib/superfrete.functions.ts`, consultando a API oficial de produção (`/user` / `/balance`, com fallback entre os dois formatos de resposta) e devolvendo apenas `{ balanceCents, currency, fetchedAt }` — o token continua exclusivamente no servidor.
- `checkoutSuperfreteOrder` ganha: leitura do saldo antes da chamada, bloqueio antecipado com mensagem clara quando o saldo é insuficiente (sem chamar a API à toa), e novo campo no log (`saldo antes/depois`) em `shipment_logs`.
- Nova server function `checkoutSuperfreteOrders` para pagar vários pedidos numa só chamada `/checkout`, atualizando cada linha de `shipments` e gravando um log por envio.
- Hook `src/lib/use-superfrete-balance.ts` com cache curto (60 s) e revalidação após qualquer pagamento, consumido pelo wizard, pela sessão de envios e pelo card de configuração.
- UI: `shipment-wizard-modal.tsx` (passo 4 com saldo e botão de pagamento), `envio-section.tsx` (barra de saldo + ação em lote), `shipping-origin-card.tsx` (saldo informativo).
- Sem mudanças de schema: `shipments.superfrete_status`, `released_at` e `shipment_logs` já cobrem os estados necessários.

## Fora do escopo

- Recarregar a carteira ou pagar com cartão pelo sistema (a SuperFrete não expõe isso na API pública; o link leva ao painel deles).
