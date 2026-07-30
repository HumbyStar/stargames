## Objetivo

Um card em Configurações chamado **Atualizações em tempo real**: um feed ao vivo de tudo que acontece no sistema (edições de clientes/produtos, acordos MGMV, importações, backups, notas fiscais, tarefas da equipe, mudanças de configurações e permissões), mostrando **quem** fez cada ação, atualizando sozinho, sem recarregar a página.

## Estado atual verificado

- Existe a tabela `audit_log` (tabela, ação, id da linha, usuário, e-mail, dados antigos/novos, data), somente leitura para usuários autenticados. Ela já grava `user_id` e `user_email` de quem executou a ação.
- Hoje o registro automático só existe em 3 tabelas: `app_settings`, `import_history`, `saved_filters`. Clientes, produtos, MGMV, backups, NF, tarefas e papéis **não** são registrados.
- O Realtime está ligado para `clients`, `products`, `mgmv_agreements`, `mgmv_installments` — mas **não** para `audit_log`, então o feed não chegaria sozinho.
- Existe a tabela `profiles` com `display_name` e `avatar_url`, e `active_sessions` com quem está online agora.

## O que será feito

### 1. Banco (migração)
- Adicionar o gatilho de auditoria já existente às tabelas relevantes: `clients`, `products`, `mgmv_agreements`, `mgmv_installments`, `system_backups`, `nf_invoices`, `team_tasks`, `user_roles`, `role_permissions`, `ai_automations`, `sandbox_state`.
- Publicar `audit_log` no Realtime para o feed chegar instantaneamente.
- Índice por data para carregar rápido os eventos recentes.
- Sem mudança de permissão: o feed continua legível apenas por usuários autenticados; dados brutos sensíveis não são exibidos.

### 2. Identificação de quem fez a ação
- Cada evento mostra **nome do usuário** (do perfil) com avatar/iniciais; se não houver nome, mostra o e-mail; se a ação foi automática (rotina agendada, gatilho do sistema), mostra "Sistema".
- Os nomes vêm de um mapa carregado uma vez de `profiles` e completado sob demanda, para não fazer uma consulta por evento.
- Filtro "somente minhas ações" e filtro por pessoa.
- Faixa **"Ativos agora"** no topo do card, listando quem está com sessão aberta (via `active_sessions`), atualizada ao vivo — assim dá para acompanhar quem está mexendo no sistema no momento.

### 3. Tradução dos eventos para linguagem humana
Novo módulo que converte cada registro técnico em uma frase com autor, ícone e categoria:
- "**Ana** atualizou o cliente Fulano — telefone alterado"
- "**Carlos** adicionou um produto a Fulano"
- "**Ana** marcou a parcela 3/10 como paga"
- "**Carlos** concluiu uma importação — 12 clientes, 40 produtos"
- "**Sistema** finalizou o backup completo (24 MB)"
- "**Ana** gerou nota fiscal para Fulano"
- "**Carlos** alterou as preferências do sistema"
- "**Ana** concedeu o papel gerente a um usuário"

Cada evento traz categoria (Clientes, MGMV, Importação, Backup, Financeiro, Equipe, Configurações, Segurança) e severidade.

### 4. Card na interface
- Lista dos eventos mais recentes (últimos ~50, com "carregar mais"), do mais novo para o mais antigo, com hora relativa ("agora", "há 3 min") e autor destacado.
- Indicador "ao vivo" pulsante quando conectado; novos eventos entram no topo com destaque suave.
- Filtros por categoria (chips), por pessoa e "somente minhas ações".
- Botão de pausar/retomar o feed.
- Estados de carregamento e vazio no padrão visual da OnePage (mesmo `Card`, tokens e badges já usados).

### 5. Eventos locais do próprio app
Além do banco, o feed recebe eventos do cliente que não passam por tabela: progresso e conclusão de backup, restauração no Sandbox, entrada/saída do Modo Teste e Modo Local e reset do sistema — via o mesmo barramento já usado hoje (`app:reset`), padronizado num pequeno emissor de eventos, sempre atribuídos ao usuário logado.

## Detalhes técnicos

- Novo `src/lib/activity-feed.ts`: tipos, mapeamento `audit_log` → evento legível com autor resolvido, hook `useActivityFeed()` com carga inicial via Supabase, assinatura Realtime em `postgres_changes` de `audit_log` (canal criado/derrubado em `useEffect`), buffer limitado (200 itens) e coalescência para não pesar durante importações/restaurações em massa.
- Novo `src/components/realtime-updates-card.tsx`, montado em `src/sections/configuracoes-section.tsx`.
- Emissor local em `src/lib/app-events.ts`, com disparos nos pontos de backup/sandbox/local existentes.
- Presença ("Ativos agora") lida de `active_sessions` com assinatura Realtime, considerando apenas sessões recentes.
- Respeita o ambiente ativo (produção vs. sandbox) para tabelas com coluna `env`.
