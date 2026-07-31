# Migrar para a sua própria conta Supabase

Objetivo: sair do banco gerenciado pelo Lovable Cloud e passar a rodar no **seu** projeto Supabase, sem perder dados e sem ninguém alterando dados durante a virada.

Ao aprovar, eu registro na memória do projeto a decisão da migração e o combinado abaixo, para retomar exatamente daqui quando você criar e conectar o projeto. Repetir isso para outra conta/organização Supabase no futuro é só gerar um novo pacote pelo card **Migrar banco de dados** e conectar a nova conta no Lovable.

## Como funciona a virada

A troca é feita **conectando a sua conta Supabase** ao projeto (Connectors → Supabase). A partir daí o app aponta para o seu projeto e o banco atual fica só como cópia histórica. Nenhuma tela precisa ser reescrita: o app já usa o cliente Supabase padrão.

Não viajam automaticamente (tratamos passo a passo): contas de login, arquivos de storage e os agendamentos automáticos.

## Etapa 1 — Modo Manutenção (bloqueio de não-admins)

- Novo card em Configurações: **Modo Manutenção / Migração**, visível e acionável só por admin e admin master.
- Ligado: quem não é admin/admin master cai numa página amigável ("Estamos migrando o sistema — voltamos em instantes"), com o mascote e o horário de início.
- Bloqueio validado no servidor (papel conferido no banco) e reforçado por política de banco, para que nem uma aba já aberta ou chamada direta consiga gravar.
- Sessões abertas recebem o aviso em tempo real, sem recarregar a página.

## Etapa 2 — Pacote de migração fiel

Reaproveita o card **Migrar banco de dados** já existente:

- Gerar o pacote **Supabase / Postgres** de produção: `01-schema.sql`, `02-data.sql`, `03-security.sql` e o snapshot do schema.
- Acrescentar ao pacote um **relatório de contagem por tabela** (conferência pós-importação).
- Acrescentar o inventário/exportação dos buckets (`notion-html-originals`, `system-backups`) e a lista de usuários do login.

## Etapa 3 — Criar e preparar o seu projeto Supabase

1. Você cria o projeto na sua conta (região São Paulo).
2. Você conecta a conta no Lovable e seleciona esse projeto.
3. Eu aplico o schema: tabelas, enums, funções, políticas de acesso, GRANTs e triggers idênticos.
4. Eu importo os dados em lotes e confiro tabela a tabela contra o relatório.
5. Recriamos os buckets e subimos os arquivos.
6. Recriamos o agendamento de backup apontando para a nova URL.

## Etapa 4 — Usuários e acesso

- Recriamos as contas mantendo o mesmo e-mail e o mesmo `id`, para preservar vínculos (tarefas, pontos, papéis); cada pessoa define a senha por e-mail de redefinição no primeiro acesso.
- Papéis e permissões vêm junto nas tabelas, então os acessos continuam iguais.
- Login com Google reativado no novo projeto, se estiver em uso.

## Etapa 5 — Conferência e retorno

- Checklist: contagem origem × destino, leitura de cada seção, teste de escrita, backup manual e restauração.
- Só com o checklist verde eu desligo o Modo Manutenção.
- O banco antigo permanece intacto; nada é apagado.

## Detalhes técnicos

- Novo `src/lib/maintenance.functions.ts` (server functions autenticadas) com a flag em `app_settings`, papel verificado via `has_role`.
- Guarda em `src/routes/_authenticated.tsx` → nova rota `src/routes/manutencao.tsx` para não-admins.
- Ajustes em `src/lib/db-migration.functions.ts` para incluir relatório de contagens e inventário de storage no ZIP.
- Memória do projeto atualizada com a decisão de migração e o estado do processo.

## O que preciso de você

1. Criar o projeto na sua conta Supabase.
2. Conectar a conta Supabase no Lovable e escolher o projeto.
3. Confirmar quando eu puder ligar o Modo Manutenção.
