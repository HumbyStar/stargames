## Diagnóstico (verificado no banco e no código)

Conferi o banco e o fluxo de backup/restauração. O que encontrei:

1. **A tela mostra só 12 tabelas**: o ZIP realmente traz as 21, mas o card "Estrutura do ZIP validada" corta a lista em 12 chips (`slice(0, 12)`) e esconde as tabelas com 0 registro.
2. **Ponto da equipe some no Modo Teste**: produção tem 36 batidas, o teste ficou com **0**. Causa: o índice único `uniq_punch_user_day_kind (user_id, day, kind)` não considera o ambiente, então a restauração descarta toda batida que já existe na produção.
3. **Logs são cortados no backup**: `audit_log` sai limitado a 3.000 linhas / 30 dias (o banco tem ~69 mil), `notion_html_access_log` e `team_task_activity` idem. E `audit_log` **nunca** é restaurado.
4. **Tabelas fora do backup**: `sandbox_import_audit`, `system_backups`, `sandbox_state`, `active_sessions` não entram em nenhum backup — e nada avisa quando uma tabela nova é criada no banco e fica de fora.
5. **Finanças "zeradas" no teste não é perda de dados**: conferi as contagens por ambiente e o teste está idêntico à produção (2.728 clientes, 23.428 produtos, 77 acordos, 508 parcelas, todos os vínculos preenchidos). O que está realmente vazio nos dois ambientes é `nf_invoices`, `saved_filters`, `team_task_comments`. Ou seja: o card de finanças precisa ser reconferido depois das correções acima — se ainda vier zerado, é leitura de tela, não backup.
6. **Separação por ambiente já está correta**: o backup filtra `env` e a restauração escreve só no ambiente de destino. Isso será preservado integralmente.

## O que será feito

### 1. Cobertura total das tabelas
- Lista de tabelas do backup passa a ser conferida contra a lista real do banco (via `export_db_schema_snapshot`): qualquer tabela nova entra automaticamente e aparece no log do backup.
- Incluir `sandbox_import_audit`, `system_backups` e `sandbox_state` no pacote. `active_sessions` entra como dado histórico, mas fica marcada como **não restaurável** (sessões ativas não podem ser sobrescritas).
- O manifesto passa a registrar a lista completa e o motivo de qualquer tabela pulada.

### 2. Fim do corte dos históricos
- Remover o limite de 3.000 linhas / 30 dias dos logs. Exportação passa a ser paginada e gravada em blocos no ZIP (sem acumular tudo em memória), com um teto de segurança bem alto e aviso claro só se ele for atingido.
- `audit_log` e `notion_html_access_log` entram na restauração (no ambiente de destino, sem tocar no outro).

### 3. Ponto da equipe no Modo Teste
- Migração: substituir o índice único `(user_id, day, kind)` por `(user_id, day, kind, env)`.
- Remover o filtro de colisão contra produção na restauração — deixa de ser necessário, e as 36 batidas passam a aparecer no teste.

### 4. Restauração cobrindo tudo
- A restauração no teste deixa de seguir apenas a lista de clonagem: passa a percorrer todas as tabelas do ZIP que tenham coluna `env`, na ordem de dependência, mantendo o remapeamento de IDs.
- Tabelas globais compartilhadas (perfis, papéis, permissões, responsabilidades) continuam intocadas — elas já são visíveis nos dois ambientes, então a equipe aparece sem risco de alterar acesso real.

### 5. Tela de análise mais honesta
- Mostrar **todas** as tabelas do ZIP (sem corte em 12), com contagem explícita, e "0" em vez de esconder.
- Separar visualmente "com dados" e "vazias no backup".
- Após restaurar, a conferência já existente (esperado x gravado) passa a listar todas as tabelas processadas, inclusive as vazias.

### 6. Conferência final
- Rodar um backup de produção e um do teste, comparar contagens tabela a tabela com o banco, e confirmar que nenhum backup mistura os dois ambientes.

## Detalhes técnicos
- `src/lib/backup.functions.ts`: `BACKUP_TABLES` dinâmico, remoção de `LOG_TABLE_LIMITS`, exportação em blocos, `RESTORABLE_TABLES` ampliado, `tablesToProcess` do sandbox baseado nas tabelas com `env`.
- Migração: `uniq_punch_user_day_kind` → inclui `env`.
- `src/lib/backup-restore-keys.ts`: chave de `team_punch_entries` passa a incluir `env`.
- `src/components/restore-backup-modal.tsx`: remoção do `slice(0, 12)` e novo agrupamento das tabelas.
