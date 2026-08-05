# Contagem de produtos "indisponível" e snapshot automático

## Por que o card mostra "—" só em Produtos

Confirmado no banco: a tabela de produtos tem 23.727 linhas em produção, contra 2.761 clientes e 78 acordos. A regra de visibilidade da tabela de produtos (`Internal read products`) chama a função `env_row_visible(env, sandbox_owner)` **linha a linha**. Em 2.761 clientes isso passa; em 23.727 produtos a contagem exata estoura o tempo limite do banco. Por isso Clientes e Acordos mostram "OK" e só Produtos aparece como "indisponível" — não é a base vazia, é a contagem que não termina a tempo.

O botão "Atualizar snapshot" não resolve isso: ele recarrega a lista, mas a contagem continua caindo no mesmo tempo limite.

## O que vai mudar

### 1. Contagem que sempre responde
Criar uma função no banco que conta as linhas de um ambiente em uma única consulta, validando uma vez só se o usuário tem papel interno (em vez de reavaliar a visibilidade em cada uma das 23 mil linhas). A contagem passa a responder em milissegundos e o card mostra o número real de produtos em vez de "indisponível".

### 2. Snapshot automático (fim do botão manual)
- A verificação roda sozinha ao abrir o dashboard, ao trocar de ambiente e a cada 60 segundos.
- Quando o app recebe um evento em tempo real de clientes/produtos/acordos, a verificação é reagendada (com pequeno atraso para agrupar rajadas).
- Se for detectada divergência entre a tela e o banco, o app **recarrega o snapshot sozinho** uma vez e reconfere; só se a divergência persistir é que o card avisa.
- O botão "Atualizar snapshot" sai da frente: fica apenas um ícone discreto de "reconferir agora", e o card exibe o horário da última verificação automática.

## Detalhes técnicos

- Migração: `public.count_env_rows(_table text, _env app_env, _owner uuid)` como `SECURITY DEFINER`, `STABLE`, `search_path = public`, validando `has_any_internal_role(auth.uid())` no início e aceitando apenas a lista fixa de tabelas (`clients`, `products`, `mgmv_agreements`, `mgmv_installments`); `GRANT EXECUTE ... TO authenticated` apenas (sem `anon`).
- `src/lib/db-sync.ts` → `dbFetchDiagnostics`: trocar os `select(count: exact, head)` por chamadas `rpc("count_env_rows", ...)`, mantendo `null` como "indisponível" quando a RPC falhar.
- `src/components/dashboard-integrity-card.tsx`: remover o botão primário; adicionar `setInterval` de 60s, re-checagem em eventos realtime/foco de janela, auto-`refreshSnapshot()` uma única vez por divergência detectada (com guarda para não entrar em laço), e rótulo "verificado há X".
- Testes em `src/lib/db-sync.test.ts`: RPC com erro vira `null`; contagem bem-sucedida é repassada por ambiente.