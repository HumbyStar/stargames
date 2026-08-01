## Diagnóstico (verificado no banco)

- O estado de tela é gravado em `app_settings.ui_state` com **chaves planas** como `mgmv.search`, `clientes.search`, `collection.search`, `clientes.chip`, `mgmv.create.draft.<id>`, `navbar.config.<id>`. O filtro de ruído atual só ignora a chave `search` isolada, por isso "alterou busca em MGMV, Clientes e Cobrança" continua aparecendo.
- Isso é o grosso do feed: dos 69.430 registros de auditoria dos últimos 30 dias, **10.133 são de `app_settings`** — quase todos digitação em busca, troca de chip, rascunho e layout.
- `active_sessions` guarda só as sessões vivas (6 linhas hoje), então não existe histórico de "tempo online". Existem 36 registros de ponto em `team_punch_entries` e o histórico completo de auditoria desde 27/06 — é daí que sai o tempo de uso.

## 1. Limpar o feed: só ações reais

- Deixa de gerar evento qualquer mudança que seja **apenas de estado de tela**: buscas, chips, filtros rápidos, paginação, rascunhos de formulário, layout da navbar, notificações lidas, versão de reset. A regra passa a valer para chaves planas (`area.chave`) e aninhadas.
- Continuam aparecendo: **Preferências, Regras de negócio e Segurança** (o que é configuração de verdade), além de clientes, produtos, MGMV, parcelas, notas fiscais, importações, backups, tarefas, papéis/permissões, automações e entrada/saída do Modo Teste.
- No banco, o gatilho de auditoria deixa de gravar linha quando **só** o estado de tela mudou em `app_settings` — corta o ruído na origem e para de inflar a tabela (hoje ~10 mil linhas/mês só disso).

## 2. Produto com o cliente na mesma linha

- Eventos de produto passam a mostrar `Fulano adicionou o produto X para o cliente Y` (nome + telefone quando existir), resolvendo o cliente pelo vínculo do produto em lote, com cache.
- O mesmo vale para parcelas e acordos MGMV, que já trazem o nome do cliente, e para notas fiscais (que hoje não mostram cliente nenhum).

## 3. Cards em lote para importações e ações em massa

- Ações do mesmo autor, mesma tabela e mesmo tipo dentro de uma janela curta viram **um card de lote**: "Fulano importou 34 clientes e 112 produtos".
- O card tem um dropdown que abre uma **tabela detalhada** no estilo one-page: cliente, produto, plataforma, valor, situação, horário — com busca dentro do lote, contagem de erros e link para abrir o registro individual.
- Importações reais (`import_history`) puxam junto os clientes/produtos criados na mesma janela, para o lote refletir o que entrou de fato.

## 4. Painel da equipe (gamificado) dentro do card

Nova aba **"Equipe"** ao lado de "Atividade", com um card por usuário:

- Avatar, nome, papel e status (online agora / visto há X).
- **Tempo ativo** nos últimos 30 dias, calculado por blocos de 5 minutos com atividade registrada, mais o tempo de ponto batido quando houver.
- **Ações mais usadas** (top 3 por categoria, com barra de proporção) e total de ações no período.
- **Nível de uso**: pontuação 0–100 combinando volume de ações, dias ativos e regularidade, exibida como barra + selo (Bronze / Prata / Ouro / Diamante), com posição no ranking da equipe e comparação com a média.
- Mini gráfico de atividade dos últimos 30 dias (sparkline por dia) e sequência de dias ativos ("ofensiva").
- Clicar no card filtra o feed por aquela pessoa.

Os números vêm de uma função agregadora no banco (não baixa as 59 mil linhas para o navegador), com atualização a cada poucos minutos.

## 5. Mais filtros no feed

- Período: hoje, 7 dias, 30 dias, intervalo personalizado.
- Tipo de operação: criação, edição, exclusão.
- Gravidade: informativo, sucesso, atenção, crítico.
- Registro/tabela específica (cliente, produto, acordo, backup...).
- Agrupar por dia (separadores "Hoje", "Ontem", data).
- Alternar entre visão em lote e visão linha a linha, mantendo o "Nível de detalhe" já existente.
- Botão para limpar todos os filtros e contador de resultados.

## Detalhes técnicos

- `src/lib/activity-feed.ts`: nova lista de chaves/prefixos de estado de tela ignorados (com suporte a chave plana), resolução de nome de cliente para produtos e notas, agrupamento em lote e novos campos de filtro.
- Novos componentes: `src/components/activity-batch-card.tsx` (card de lote + tabela do dropdown) e `src/components/team-usage-panel.tsx` (cards gamificados).
- `src/components/realtime-updates-card.tsx`: abas Atividade/Equipe e a barra de filtros ampliada.
- Migração: função agregadora `public.team_usage_stats(days int)` (security definer, restrita a usuários internos) devolvendo por usuário — total de ações, ações por categoria, dias ativos, blocos ativos, última atividade e série diária; e ajuste no gatilho `audit_change()` para ignorar mudanças que só tocam o estado de tela em `app_settings`.
- Nenhum dado histórico é apagado; o feed apenas deixa de exibir e de registrar ruído novo.
