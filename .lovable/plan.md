# Cobrança automatizada no WhatsApp — projeto separado ligado a este

Você vai criar um segundo projeto com duas seções (Gestor de Cobrança e Esteira de follow-up) que usa a mesma base de dados deste projeto e conversa com ele por webhook nos dois sentidos.

## Como os dois projetos se ligam

```text
Star Games (este)  --- webhook "cobrança marcada" --->  Projeto WhatsApp
Star Games (este)  <-- webhook "pago / respondeu"  ---  Projeto WhatsApp
        \                                                    /
         \------------- mesma base de dados ----------------/
```

- **Mesma base:** o projeto novo se conecta à base deste projeto, então a lista de cobrança é exatamente a mesma, sem cópia nem atraso.
- **Webhook:** serve para avisar o outro lado na hora em que algo muda (um item entra em cobrança aqui; o cliente pagou lá), para disparar a automação e mover o card na esteira.

## Novas informações guardadas na base

Tudo novo fica em tabelas próprias, sem mexer no que já existe:

- **Campanhas de cobrança** — o filtro aplicado, quem disparou, quando, quantos clientes entraram.
- **Cards da esteira** — cliente, telefone, valor, etapa atual (Cobrado, Aguardando resposta, Follow-up agendado, Prometeu pagar, Pago, Sem sucesso), data do próximo contato, tentativas.
- **Conversas** — cada mensagem enviada e recebida, na ordem, exibida dentro do card.
- **Eventos de webhook** — registro de tudo que entrou e saiu, para conferência e reenvio em caso de falha.

## Seção 1 — Gestor de Cobrança (projeto novo)

Mesma lista de cobrança deste projeto, com filtros: dias em atraso, faixa de valor, plataforma, situação, pasta, se já foi cobrado antes e há quanto tempo, e busca por nome/telefone. Seleção em massa, prévia de quantos clientes serão atingidos e botão "Iniciar automação" que cria a campanha, envia a primeira mensagem para cada cliente e gera os cards na esteira.

## Seção 2 — Esteira (kanban) de follow-up

Colunas: **Cobrado → Aguardando resposta → Follow-up agendado → Prometeu pagar → Pago / Sem sucesso**.

Cada card mostra nome, telefone e a conversa completa (com campo para responder manualmente). Ações do time: mover de coluna, "Cobrar novamente" escolhendo a janela de tempo (2h, 24h, 3 dias, 7 dias ou data escolhida), "Marcar como pago" — que atualiza a cobrança também neste projeto — e notas internas.

## WhatsApp (API oficial da Meta)

A API oficial só permite iniciar conversa com modelo de mensagem aprovado; depois que o cliente responde, abre-se uma janela de 24h para mensagem livre. O projeto novo precisa de: número business verificado, modelos aprovados (primeira cobrança, lembrete, confirmação de pagamento) e um endereço público que receba as respostas e os recibos de entrega.

## Detalhes técnicos

- Base compartilhada: o projeto novo se conecta ao mesmo Supabase (URL + chave publicável), com RLS nas tabelas novas e os mesmos papéis/permissões já existentes (`has_permission`, `env_row_visible`).
- Endpoints públicos deste lado, em `src/routes/api/public/`: `collection-event` (saída) e `payment-callback` (entrada), ambos com assinatura HMAC em cabeçalho e segredo compartilhado guardado nos dois projetos.
- Endpoints do projeto novo: `whatsapp-inbound` (mensagens e status da Meta, com verificação de assinatura da Meta), `collection-intake` (eventos vindos daqui) e um endpoint de agendador que dispara os follow-ups vencidos.
- Agendamento de follow-up por `pg_cron` chamando o endpoint do agendador a cada 15 minutos.
- Entrega garantida: cada evento tem id único, o receptor ignora repetidos e falhas são reenviadas com espera crescente.

## Prompt para colar no projeto novo

> Crie um gestor de cobrança automatizada por WhatsApp com duas seções.
>
> **Base de dados:** conecte-se ao Supabase já existente do meu outro projeto (vou fornecer URL e chave). Não recrie clientes nem produtos — leia as tabelas `clients`, `products` e `mgmv_agreements`. Crie apenas as tabelas novas: `collection_campaigns`, `collection_cards`, `collection_messages` e `webhook_events`, cada uma com RLS e permissões para usuários autenticados.
>
> **Seção 1 – Gestor de Cobrança:** lista de produtos em aberto/atrasados com filtros de dias em atraso, faixa de valor, plataforma, situação, pasta, "já cobrado" e busca por nome/telefone. Seleção em massa, contagem de clientes atingidos e botão "Iniciar automação" que cria uma campanha, envia a primeira mensagem de WhatsApp a cada cliente e cria um card na esteira.
>
> **Seção 2 – Esteira kanban:** colunas Cobrado, Aguardando resposta, Follow-up agendado, Prometeu pagar, Pago e Sem sucesso. Cada card mostra nome, telefone, valor devido e o histórico completo da conversa, com campo para responder manualmente. Ações: arrastar entre colunas, "Cobrar novamente" com janela de tempo (2h, 24h, 3 dias, 7 dias ou data escolhida) e "Marcar como pago".
>
> **WhatsApp:** use a API oficial da Meta (Cloud API) com modelos aprovados para a primeira mensagem e mensagem livre dentro da janela de 24h. Crie um endpoint público que receba mensagens recebidas e status de entrega, validando a assinatura da Meta.
>
> **Integração:** crie um endpoint público `collection-intake` que receba eventos do outro projeto (item entrou em cobrança, valor alterado, pagamento registrado) validando assinatura HMAC, e envie de volta um webhook sempre que um card for marcado como pago. Registre todos os eventos, ignore repetidos e reenvie falhas.
>
> **Agendador:** um endpoint que a cada 15 minutos envia os follow-ups cujo horário chegou.

## O que fica pronto deste lado

Os dois endpoints públicos com assinatura, o disparo do evento quando o time marca uma ação de cobrança, e o recebimento do aviso de pagamento atualizando o produto/acordo aqui.
