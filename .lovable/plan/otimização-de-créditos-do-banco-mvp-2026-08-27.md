# Otimização de créditos do banco (MVP)

Objetivo: reduzir drasticamente requisições ao banco sem mudar o comportamento das telas que você usa no dia a dia.

## O que mais gasta créditos hoje (confirmado no código)

1. **Carga completa de clientes e produtos** — as seções da one-page trabalham sobre o store carregado do banco (`src/lib/db-sync.ts`, buscas em `clients`/`products` sem paginação real). Com ~2.800 clientes e ~24.000 produtos, cada abertura/refresh do sistema é o maior custo isolado.
2. **Tempo real (Realtime)** — `db-sync` assina 5 tabelas (`clients`, `products`, `mgmv_agreements`, `mgmv_installments`, `import_history`) e o card de integridade assina mais 3. Cada evento dispara re-leituras em cascata.
3. **Feed de atividades** — `src/lib/activity-feed.ts` combina canal realtime no `audit_log` **e** polling a cada 15s.
4. **Presença/heartbeat** — `session-guard` faz ping a cada 30s, `online-presence` recarrega a cada 30s, `notifications` a cada 60s.
5. **Desempenho da equipe** — `useTeamUsage` chama `team_usage_stats` + 4 consultas a cada 5 min por usuário aberto.
6. **Integridade do dashboard** — verificação automática periódica com contagens pesadas.
7. **Sync SuperFrete** — polling a cada 3 min.

## Mudanças propostas

### 1. Tabelas de 20 em 20 (one-page)
- Clientes, Cobrança, MGMV e Envio passam a exibir 20 registros por vez, com o botão "Carregar mais" já existente (`LoadMoreButton` + `usePaginatedList` com `step: 20`).
- Produtos de um cliente continuam carregando sob demanda ao abrir a ficha (nada de carregar produtos de todos os clientes na listagem).

### 2. Remover Kanban e Tarefas
- Remove as abas "Kanban" e o botão "Nova tarefa" de `src/sections/equipe-section.tsx`, os modais de tarefa e as leituras de `team_tasks`/`team_task_activity`/`team_task_comments` na interface.
- Remove também o Dashboard de tarefas (`team-dashboard.tsx`) e o Concierge de tarefas, que só existem para alimentar o Kanban.
- As tabelas permanecem no banco (nada é apagado), apenas deixam de ser consultadas.

### 3. Remover tempo real de atividades e nível da equipe
- Feed de atividades: sai o canal realtime e o polling de 15s; passa a carregar só quando o card é aberto, com botão "Atualizar".
- Aba "Desempenho" (níveis, score, ranking, `useTeamUsage`): removida.

### 4. Reduzir tempo real e polling do resto
- Realtime em `db-sync` fica só em `clients` e `products` (as demais atualizam quando a seção é aberta).
- Card de integridade: sem realtime e sem verificação automática — só no botão.
- Heartbeat de sessão: 30s → 120s. Presença online: 30s → 120s. Notificações: 60s → 300s. SuperFrete: 3 min → 15 min e só quando há envios pendentes.
- `staleTime` padrão das consultas sobe de 30s para 5 min, e listas param de refetchar ao focar a janela.

### 5. Índices no banco
- Índices para os filtros mais usados: `products(client_id)`, `products(env, financial_status)`, `products(env, due_date)`, `clients(env, client_type)`, `audit_log(changed_at desc)`.
- Reduz o tempo/custo das consultas que restarem.

## Detalhes técnicos
- Arquivos tocados: `src/lib/db-sync.ts`, `src/lib/activity-feed.ts`, `src/sections/equipe-section.tsx`, `src/sections/{clientes,collection,mgmv,envio}-section.tsx`, `src/components/{dashboard-integrity-card,online-presence,session-guard,team-dashboard,concierge*}.tsx`, `src/lib/{notifications,team-usage,use-superfrete-sync}.ts`, `src/lib/api/use-server-table.ts`.
- Uma migração apenas com `CREATE INDEX` (sem alterar dados nem RLS).
- Nenhuma tabela é removida; nenhum dado é apagado.

## Impacto esperado
Menos leituras por sessão (paginação), menos eventos realtime e menos polling — a maior parte do consumo atual vem de repetição, não de volume de dados.
