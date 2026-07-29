## Objetivo

Criar um "Modo Teste" (sandbox): o mesmo sistema, com uma cópia dos dados reais, onde tudo que o admin fizer — importar, editar, apagar, reprocessar MGMV, gerar backup, emitir NF — não toca nos dados de produção.

## Como funciona (visão geral)

Cada linha do banco passa a ter um marcador de ambiente: `producao` ou `sandbox`. Enquanto o admin está em Modo Teste, o banco só enxerga as linhas `sandbox`; tudo que ele criar nasce já marcado como `sandbox`. Ao sair do modo, volta a enxergar apenas produção. O isolamento é garantido pelo próprio banco (regras de acesso), não pelas telas — então nenhuma parte do sistema pode "vazar" para produção por esquecimento.

```text
Admin normal      ──▶  linhas env='producao'   (dados reais)
Admin em teste    ──▶  linhas env='sandbox'    (cópia descartável)
Demais usuários   ──▶  sempre env='producao'
```

## Entrada pelo Configurações

A ativação fica **exclusivamente** em Configurações, num card dedicado "Ambiente de Teste (Sandbox)" — não há toggle na navbar.

O card mostra:
- Status atual (Produção / Modo Teste) com badge.
- Data da última clonagem e contagem de linhas por tabela no sandbox.
- Botão "Entrar no Modo Teste" (com diálogo de confirmação explicando o que muda).
- Botões "Clonar dados de produção" (com barra de progresso) e "Resetar sandbox".
- Botão "Sair do Modo Teste" quando ativo.

Visível apenas para admin/admin_master. Enquanto o Modo Teste estiver ativo, uma faixa fixa no topo avisa "MODO TESTE — nada afeta a produção", com atalho para voltar ao card em Configurações.

## Fluxo para o usuário

1. Configurações → card Ambiente de Teste → "Entrar no Modo Teste".
2. Se o sandbox estiver vazio, o próprio diálogo oferece clonar a produção na hora.
3. Todas as seções (Clientes, MGMV, Collection, Finanças, Equipe, Importação, Backups) funcionam igual, só que sobre os dados de teste.
4. "Resetar sandbox" limpa tudo; "Reclonar" refaz a cópia da produção.
5. Ao sair, o sistema recarrega os dados em tempo real (sem F5) e o sandbox fica guardado para a próxima vez.

## Escopo dos dados

Entram na cópia: clientes, produtos, acordos MGMV, parcelas, histórico de importação, notas fiscais, tarefas/comentários/atividades da equipe, pontos, filtros salvos, configurações do app, automações e perfil de treino da IA.

Não são copiados: usuários, papéis/permissões, log de auditoria, sessões ativas e backups. Papéis continuam valendo em ambos os ambientes (você é o mesmo usuário).

Arquivos HTML originais do Notion não são duplicados no storage; o sandbox aponta para os mesmos arquivos em modo somente leitura (evita duplicar armazenamento).

## Backup no Modo Teste

O backup roda igual, com os dados do sandbox, gera o arquivo real e permite download. Os registros ficam marcados como "teste" e são listados numa aba separada, com badge, para não se confundirem com os oficiais. Restaurar um backup em Modo Teste só reescreve linhas sandbox.

## Detalhes técnicos

**Banco**
- Novo tipo `app_env` (`producao` | `sandbox`) e coluna `env app_env NOT NULL DEFAULT public.current_env()` em todas as tabelas de dados listadas acima.
- Tabela `public.sandbox_state (user_id, active bool, cloned_at, updated_at)` + GRANTs; cada usuário controla o próprio modo. Só admin/admin_master pode ativar (checado por `has_role` no server fn e por policy).
- Função `public.current_env()` (STABLE, SECURITY DEFINER): retorna `sandbox` se existe `sandbox_state` ativo para `auth.uid()`, senão `producao`.
- Policies dessas tabelas ganham `AND env = public.current_env()` no `USING` e no `WITH CHECK`. Esse é o coração do isolamento: as ~200 chamadas `.from(...)` existentes passam a ser filtradas automaticamente, sem alterar o código de consulta.
- Índices compostos `(env, ...)` nas colunas mais consultadas; chaves únicas hoje globais passam a incluir `env`.

**Clonagem**
- Server fn `cloneProductionToSandbox` (admin-only, roda com service role após verificar o papel): apaga o sandbox atual e copia a produção em lotes, na ordem de dependência (clients → products → mgmv_agreements → mgmv_installments → nf_invoices → team_* → demais).
- Como as linhas ficam na mesma tabela, os UUIDs são regerados: mantém-se um mapa `id_producao → id_sandbox` por tabela e as chaves estrangeiras são reescritas na inserção. Progresso persistido para barra e retomada, no mesmo padrão já usado pelo backup.
- Server fns auxiliares: `getSandboxState`, `setSandboxMode`, `resetSandbox`, `getSandboxCounts`.

**Frontend**
- `src/lib/use-sandbox.tsx`: contexto com estado do modo, montado no `_authenticated`.
- `src/components/sandbox-settings-card.tsx`: card em Configurações (único ponto de entrada).
- Faixa de aviso no `app-layout.tsx` quando ativo (tokens semânticos, sem cores fixas).
- Ao alternar: `queryClient.clear()` + o evento `app:reset` já existente, para recarregar tudo sem F5.

**Pontos de atenção**
- Código que usa o cliente admin (backup, restauração, integridade, tarefas do concierge) ignora as policies — nesses pontos aplica-se `eq("env", ...)` explícito, com o ambiente resolvido pelo usuário chamador.
- A assinatura de realtime passa a filtrar por ambiente.
- O cron de backup automático permanece apenas em produção.

## Ordem de execução

1. Migração: tipo, coluna `env`, `sandbox_state`, `current_env()`, policies, índices.
2. Server fns de estado, contagem e clonagem.
3. Contexto de sandbox + card em Configurações + faixa de aviso.
4. Ajuste dos caminhos com cliente admin (backup/restauração/integridade) e do realtime.
5. Verificação ponta a ponta: clonar → editar no teste → conferir produção intacta → gerar backup de teste.
