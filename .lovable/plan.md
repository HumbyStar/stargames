## Objetivo

Hoje existe **um único** ambiente sandbox compartilhado: todas as linhas com `env = 'sandbox'` (hoje 49 clientes, por exemplo) são visíveis para qualquer usuário em modo teste, e quando alguém clona a produção ou reseta o sandbox, isso apaga/substitui o sandbox de todo mundo.

A mudança dá a cada usuário o **seu próprio sandbox**, invisível para os demais, sem tocar em nada da produção.

## Como vai funcionar

- Cada linha de sandbox passa a ter um "dono".
- Ao entrar no modo teste, você só enxerga os dados de sandbox que você mesmo criou ou clonou.
- Clonar produção → sandbox, resetar sandbox e importar backup no sandbox afetam **apenas o seu** ambiente.
- Produção continua exatamente como está: compartilhada por todos, sem dono.

## Detalhes técnicos

**1. Banco (migração)**

- Adicionar coluna `sandbox_owner uuid` (nullable, FK `auth.users`, `ON DELETE CASCADE`) nas 14 tabelas do `CLONE_ORDER`: `clients`, `mgmv_agreements`, `mgmv_installments`, `products`, `nf_invoices`, `import_history`, `team_tasks`, `team_task_comments`, `team_task_activity`, `team_punch_entries`, `saved_filters`, `ai_automations`, `app_settings`, `ai_training_profile`. Índice parcial por `(sandbox_owner)` onde `env = 'sandbox'`.
- Trigger `BEFORE INSERT/UPDATE`: se `env = 'sandbox'` e `sandbox_owner IS NULL`, preencher com `auth.uid()`; se `env = 'producao'`, forçar `NULL`. Impede que o cliente escolha outro dono.
- Nova função `public.env_row_visible(_env app_env, _owner uuid) RETURNS boolean` (stable, security definer): verdadeira quando `_env = current_env()` **e** (`_env = 'producao'` OU `_owner = auth.uid()`).
- Reescrever as policies SELECT/INSERT/UPDATE/DELETE dessas tabelas trocando `env = current_env()` por `public.env_row_visible(env, sandbox_owner)` (mantendo os checks de papel/roles já existentes).
- Chaves primárias compostas com `env` (`app_settings (id, env)` e `ai_training_profile (user_id, env)`) precisam incluir o dono: PK passa a `(id, env, sandbox_owner)` — com `sandbox_owner` `NOT NULL DEFAULT '00000000-…0000'`-equivalente não é possível em PK nullable, então uso coluna gerada `sandbox_key uuid` = `coalesce(sandbox_owner, uuid_nil())` e PK sobre ela.
- Backfill: as linhas de sandbox já existentes ficam sem dono e serão removidas na migração (dados de teste descartáveis), evitando um "sandbox órfão" visível para ninguém. Confirmo antes de rodar se preferir preservá-las atribuindo a um usuário específico.

**2. Aplicação**

- `src/lib/sandbox.functions.ts`: `countsForEnv`, `resetSandbox` e a limpeza inicial de `cloneProductionToSandbox` passam a filtrar `.eq('sandbox_owner', context.userId)` (o cliente admin ignora RLS, então o filtro precisa ser explícito).
- `src/lib/sandbox-clone.ts`: `remapRow` grava `sandbox_owner` do usuário que clonou.
- `src/lib/backup.functions.ts` e o fluxo de importação de backup em sandbox: escrever/ler apenas linhas do dono atual; backups de sandbox continuam com prefixo de ambiente e passam a ser por usuário.
- `src/lib/db-migration.functions.ts` e a exportação de esquema: incluir a nova coluna.
- Regenerar `src/integrations/supabase/types.ts`.

**3. Verificação**

- Consultas conferindo que dois usuários diferentes em modo teste não veem as linhas um do outro.
- Conferir que a produção segue com a mesma contagem antes/depois (2737 clientes).
