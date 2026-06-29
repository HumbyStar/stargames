# Fase 1 — Navbar polida + base do módulo Equipe

## 1. Navbar: animação + estado glass ao rolar

**1.1 Borda percorrendo (fix do efeito anterior)**
- Reescrever `.nav-progress-ring` em `src/styles.css` voltando ao formato que funcionava: anel SVG fino circulando todo o pill (não conic-gradient quebrado). Implementação: pseudo-elemento `::before` com `border-radius: 999px`, `padding: 1.5px`, fundo `conic-gradient` rodando 360° contínuos em 2.4s, máscara dupla (`content-box` xor `border-box`) para virar apenas borda, glow `drop-shadow` na cor primary.
- Loop contínuo (`data-progress="loop"`) enquanto o mouse estiver sobre a navbar; some com fade 250ms ao sair.
- Mantém variante `data-progress="true"` (preenchimento 0→100% em 3s) para o caso de hover sobre um ícone específico no modo compacto.

**1.2 Estado "glass embaçado" ao rolar**
- Em `src/components/app-layout.tsx`, observar o `scroll` do `.page-container` (já é o container rolável). Setar `data-scrolled="true"` na navbar quando `scrollTop > 24`, remover ao voltar perto do topo (`< 8`, com histerese).
- Quando `data-scrolled="true"` E o mouse NÃO está sobre a navbar:
  - `background: color-mix(... 35%, transparent)`, `backdrop-filter: blur(28px) saturate(140%)`, `border-color` quase transparente, `box-shadow` reduzido.
  - Ícones/labels recebem `opacity: 0.45` e `filter: blur(0.4px)` (sutil).
  - Transição 400ms ease.
- Hover sobre a navbar nesse estado → remove o `data-scrolled` visual (volta ao original imediatamente, transição 250ms). Implementado com seletor CSS `.floating-navbar[data-scrolled="true"]:not(:hover)`.
- Subir até o topo → também volta ao original.
- Respeitar `prefers-reduced-motion` (já existe bloco no css).

## 2. Módulo Equipe — base (kanban + papéis + atribuição)

### 2.1 Papéis e permissões (migration)
Estender o RBAC existente:
- Novos valores no enum `app_role`: `admin_master`, `gerente`, `supervisor`, `funcionario`, `envio`, `mgmv`. Manter os antigos por compatibilidade.
- Novos valores no enum `app_permission`:
  `team.view`, `team.assign.all` (admin_master), `team.assign.team` (gerente→supervisor/funcionario; supervisor→funcionario), `team.task.update_own`, `team.task.comment`, `punch.clock`, `shipping.mark_sent`, `mgmv.register_product`.
- Popular `role_permissions`:
  - `admin_master`: tudo.
  - `gerente`: team.view, team.assign.team, team.task.update_own, team.task.comment, punch.clock + permissões já existentes de manager.
  - `supervisor`: team.view, team.assign.team (escopo funcionario), team.task.update_own, team.task.comment, punch.clock.
  - `funcionario`: team.view (próprias + da equipe), team.task.update_own, team.task.comment, punch.clock.
  - `envio`: herda funcionario + shipping.mark_sent.
  - `mgmv`: herda funcionario + mgmv.register_product.
- Função SQL `can_assign_to(_assigner uuid, _assignee uuid)` que valida a escada (admin_master→todos; gerente→supervisor/funcionario/envio/mgmv; supervisor→funcionario/envio/mgmv).

### 2.2 Tabelas novas (RLS + GRANT em todas)
- `team_tasks`: title, description, status (`todo|doing|review|blocked|done`), priority (`low|med|high|urgent`), assignee_id, created_by, due_at, started_at, completed_at, client_id (opcional), product_id (opcional), position (int para ordenação no kanban), tags (text[]).
- `team_task_comments`: task_id, author_id, body, kind (`comment|completion|observation`).
- `team_task_activity`: task_id, actor_id, action, payload jsonb (auditoria leve, para o dashboard).

RLS: assignee/criador leem/atualizam o que lhes diz respeito; admin_master/gerente/supervisor leem conforme escada; criação validada por `can_assign_to`.

### 2.3 Server functions (`src/lib/team.functions.ts`)
- `listTeamMembers` (filtrável por papel)
- `listTasks({ board: 'mine'|'team'|'all', filters })`
- `createTask` (verifica `can_assign_to`)
- `updateTaskStatus` (com transições válidas; `done` exige comentário do tipo `completion`; `observation` opcional)
- `moveTaskPosition` (drag and drop)
- `addTaskComment`

### 2.4 UI
- Nova rota `src/routes/_authenticated/equipe.tsx` + seção `src/sections/equipe-section.tsx`.
- Ícone na navbar (entre Dashboard e Clientes ou onde fizer sentido — Users), gated por `team.view`.
- Layout Trello: colunas `A Fazer / Em Andamento / Revisão / Bloqueado / Concluído`. Drag and drop com `@dnd-kit/core` (já alinhado ao stack React).
- Card: título, prioridade (badge colorido), prazo (relativo), avatar do responsável, cliente vinculado se houver, contador de comentários.
- Modal de tarefa: detalhes + timeline de atividade + caixa para `Conclusão` (obrigatória ao marcar Done) e `Observação` (opcional). Para papel `envio` mostra botão "Marcar como enviado"; para `mgmv` mostra "Cadastrar produto vinculado" (abre o fluxo já existente de produto).
- Filtros: por responsável, prioridade, cliente, tag.

### 2.5 Campos da tarefa (definidos para otimizar tempo/processo)
Decisão sugerida (você confirma se quiser ajustar):
- Obrigatórios: título, responsável, prioridade, prazo.
- Opcionais: descrição (markdown leve), cliente, produto/MGMV, tags, checklist (subtarefas simples em jsonb dentro da própria tarefa para evitar tabela extra na Fase 1).
- Automáticos: `started_at` ao mover para "Em Andamento", `completed_at` ao mover para "Concluído", duração calculada para o dashboard futuro.

## 3. Fora desta fase (vai para Fase 2, conforme combinado)
- Ponto eletrônico (4 batidas + form de feedback na saída).
- Dashboard de equipe (produtividade, tempo médio por tarefa, ponto, ranking, feedbacks agregados).
- Flags extras de produto enviado dentro do fluxo de pedidos (apenas o botão na tarefa entra agora).

## Verificação manual ao final da Fase 1
1. Scroll na home → navbar fica translúcida/embaçada; hover → volta ao normal; topo → volta ao normal.
2. Hover sobre a navbar compacta → borda percorrendo em loop, sem quebrar.
3. Login como admin_master cria tarefa para qualquer um; gerente só consegue atribuir a supervisor/funcionario/envio/mgmv; funcionario só vê as próprias + as da equipe.
4. Mover card para "Concluído" sem comentário de conclusão é bloqueado.
5. Usuário `envio` vê botão "Marcar como enviado"; `mgmv` vê "Cadastrar produto".

Confirmar e eu implemento.