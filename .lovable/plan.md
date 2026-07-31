# Migrar Banco de Dados (Configurações)

Novo card em Configurações que gera um **pacote de migração** pronto para subir em outra conta/projeto de nuvem — para clonar o Star Games para sócios ou para sair do Lovable Cloud quando quiser.

## O que o usuário vê

Card "Migrar banco de dados" (somente admin / admin master), com:

1. **Destino** — 5 opções, cada uma com ícone, descrição e o que gera:
   - **Supabase / Postgres** — `schema.sql` (tabelas, enums, funções, RLS, GRANTs, triggers) + `data.sql` (INSERTs em lote) + `README-supabase.md` com o passo a passo.
   - **Neon / Postgres puro** — mesmo SQL, sem as partes específicas do Supabase (auth, storage, `auth.uid()` substituído por comentário/parâmetro), para rodar em qualquer Postgres.
   - **Firebase (Firestore)** — JSON de coleções no formato aceito pelo `firebase-import` / Admin SDK, com relacionamentos convertidos em subcoleções ou campos de referência.
   - **AWS (RDS + DynamoDB)** — pasta `rds/` com o SQL Postgres e pasta `dynamodb/` com arquivos `BatchWriteItem` (25 itens por lote) + definição de tabelas/índices.
   - **MongoDB Atlas** — arquivos `.json` por coleção prontos para `mongoimport`, mais um script `mongoimport.sh`.

2. **Conteúdo** — seletor: *Clone completo* (estrutura + dados + segurança) ou *Somente estrutura* (projeto novo em branco para o sócio).

3. **Ambiente** — sempre o ambiente ativo (produção ou modo teste), igual ao backup, exibido de forma clara no card e no nome do arquivo.

4. **Pré-validação** — antes de liberar o download, roda uma checagem e mostra um relatório:
   - contagem de linhas por tabela e tamanho estimado do pacote;
   - referências órfãs (ex.: produto sem cliente) que quebrariam a importação com chave estrangeira;
   - campos incompatíveis com o destino escolhido (ex.: `uuid`, `numeric`, arrays e `jsonb` em Firestore/DynamoDB, limite de 400 KB por documento, nomes reservados);
   - avisos sobre o que **não** é migrado (usuários do auth, arquivos de storage, agendamentos cron) com instruções de como recriar.
   Resultado: **OK**, **Avisos** (segue com ressalvas) ou **Bloqueado** (mostra como corrigir).

5. **Download** — ZIP único com `manifest.json` (origem, ambiente, versão, data, contagens), a pasta do destino escolhido, `README.md` com passo a passo de importação e `CHECKLIST.md` pós-migração.

## Como funciona por baixo

- Novo `src/lib/db-migration.functions.ts` (server functions, autenticadas com verificação de papel admin) reaproveitando a leitura paginada por tabela que o backup já usa, com o mesmo filtro por `env`.
- Novo `src/lib/db-migration-formats.ts` com um *adapter* por destino: recebe `{ tabela, linhas, schema }` e devolve os arquivos daquele formato. Adicionar um sexto destino no futuro é criar um adapter.
- O `schema.sql` é gerado a partir do catálogo real do banco (tabelas, colunas, defaults, enums, funções, policies, grants, triggers), não escrito à mão — assim continua correto quando o schema mudar.
- Geração em streaming/lotes e ZIP com o mesmo mecanismo do backup, com barra de progresso e log em tempo real, para não estourar memória (aprendizado do backup do `audit_log`).
- Tabelas de log (`audit_log`, `notion_html_access_log`, `team_task_activity`) entram opcionalmente e com janela recente, já que não são dados de negócio.
- Novo `src/components/db-migration-card.tsx` + modal de relatório de validação, montado na tela de Configurações ao lado dos cards de Backup e GitHub.

## Correção incluída

Erro atual no preview: uma consulta ordena `audit_log` por `created_at`, mas a coluna correta é `changed_at`. Será corrigido no mesmo trabalho.

## Fora do escopo (explicado no README gerado)

Contas de usuário do auth e arquivos do storage não vão no pacote SQL — o README traz o procedimento recomendado para cada nuvem (convite de usuários / cópia de bucket).
