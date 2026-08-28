# Consumo de créditos: antes x depois + modo ocioso

## 1. Comparativo (estimativa por usuário, sessão de 8h com a aba aberta)

Base: requisições ao banco por hora, contando só o que roda sozinho (polling/realtime) mais a carga inicial das telas.

| Fonte | Antes | Depois | Redução |
|---|---|---|---|
| Carga de clientes/produtos por abertura/refresh | listas completas (~2.800 clientes, ~24.000 produtos) | 20 por vez + "Carregar mais" | ~95% menos linhas lidas |
| Realtime (tabelas assinadas) | 5 em db-sync + 3 no card de integridade | 2 (clients, products) | ~75% menos eventos |
| Feed de atividades | realtime + polling 15s = 240 req/h | polling 120s = 30 req/h | ~87% |
| Heartbeat de sessão | 30s = 120 req/h | 120s = 30 req/h | 75% |
| Presença online | 30s = 120 req/h | 120s = 30 req/h | 75% |
| Notificações | 60s = 60 req/h | 300s = 12 req/h | 80% |
| Integridade do dashboard | automática 60s = 60 req/h (consultas pesadas) | só no botão = 0 | ~100% |
| Kanban/tarefas/desempenho | leituras em 4+ tabelas por aba aberta | removido | 100% |
| SuperFrete | 3min = 20 req/h | 15min e só com envios pendentes = 0–4 req/h | ~85% |
| Ping de conexão | 30s = 120 req/h | 30s (inalterado) | 0% |

**Total automático por usuário/hora: de ~740 requisições para ~135** — queda de aproximadamente **80%**, e o peso médio de cada requisição também caiu (paginação + índices).

Traduzindo para créditos, mantendo o mesmo padrão de uso que gerava ~28 créditos/dia de banco: a expectativa é **~5 a 8 créditos/dia** (queda de 70–80%). Não é um número contratual — depende de quantos usuários ficam com a aba aberta e de quantas importações/backups são feitos no dia, que não mudaram.

## 2. Modo ocioso (sua pergunta): sim, vale muito a pena

Hoje, uma aba aberta sem ninguém mexendo continua consumindo: heartbeat, presença, atividades, notificações, ping de conexão e eventos realtime. É o pior tipo de gasto — custo sem uso.

Proposta a implementar:

- Detector de ociosidade global: sem clique, tecla, scroll ou mouse por **5 minutos**, ou aba em segundo plano (`visibilitychange`), marca a sessão como ociosa.
- Ao ficar ociosa: pausa **todo** polling (atividades, presença, notificações, SuperFrete, ping de conexão) e **fecha os canais realtime**.
- Heartbeat de sessão continua, mas em ritmo lento (a cada 10 min) só para não derrubar o login; presença passa a mostrar "ausente" em vez de "online".
- Ao voltar a atividade: uma única rodada de sincronização (reabre realtime + refetch das telas visíveis) e volta ao ritmo normal.
- Indicador discreto na navbar: bolinha amarela "ausente — atualização pausada", com clique para retomar na hora.

Efeito esperado: uma aba esquecida aberta o dia todo passa de ~740 req/h para praticamente **0–6 req/h**. Em equipe com várias abas abertas, esse é hoje provavelmente o maior gasto invisível.

## 3. Outras sugestões de melhoria (fora do que já foi feito)

1. **Cache persistente entre reloads** — salvar o resultado das consultas em `localStorage` por 10 min, para que dar F5 não refaça tudo do zero.
2. **Contagens agregadas em vez de listas** — usar RPCs que devolvem só os números do dashboard, em vez de contar linha a linha.
3. **Busca só a partir de 3 caracteres** com debounce de 500ms, evitando uma consulta por letra digitada.
4. **Realtime só na seção aberta** — hoje `clients`/`products` ficam assinados o tempo todo; poderiam ser assinados apenas quando a seção correspondente está visível.
5. **Deduplicação de requisições entre abas** — usar `BroadcastChannel` para que 3 abas do mesmo usuário compartilhem um só heartbeat/presença.
6. **Ping de conexão sem banco** — trocar a consulta em `app_settings` por um endpoint estático leve; economiza 120 consultas/hora por usuário.
7. **Backups fora do horário de pico** e apenas incrementais no dia a dia.

## Detalhes técnicos

- Novo hook `src/lib/use-idle.ts` (eventos de atividade + `visibilitychange`, threshold configurável) e um contexto `IdleProvider` em `src/components/app-layout.tsx`.
- Consumidores a adaptar: `src/lib/activity-feed.ts`, `src/lib/notifications.ts`, `src/components/online-presence.tsx`, `src/components/session-guard.tsx`, `src/lib/use-superfrete-sync.ts`, `src/lib/use-connection-status.ts`, `src/lib/db-sync.ts` (unsubscribe/resubscribe dos canais).
- Nenhuma mudança de dados, tabelas ou RLS.
