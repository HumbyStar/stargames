## Problema

Hoje o snapshot em memória não guarda a qual ambiente ele pertence. As leituras do banco são filtradas pelo servidor (produção ou sandbox do próprio usuário), mas os dados já carregados na tela continuam sendo os do ambiente anterior. Resultado: ao entrar no Modo Teste, o painel continua mostrando 2737 clientes / 23482 produtos enquanto o banco responde 1 e 1 — e a "Verificação de integridade" acusa divergências que não existem.

Confirmado no código:
- `loadSnapshot()` e `dbFetchDiagnostics()` não recebem nem registram ambiente; dependem só das regras do banco (`current_env()` = sandbox quando o usuário está com Modo Teste ligado).
- Ao ligar/desligar o Modo Teste, é disparado apenas um evento genérico de recarga (`app:reset`), sem garantia de ordem em relação às cargas já em andamento.
- O card de integridade compara números da memória com números do banco sem saber de qual ambiente cada lado veio.

## O que será feito

1. **Snapshot com identidade de ambiente**
   - Todo carregamento passa a registrar o ambiente ativo (produção ou teste) junto com os dados.
   - Cargas antigas que chegarem atrasadas, já pertencentes ao ambiente anterior, são descartadas em vez de sobrescrever a tela.

2. **Dois snapshots independentes**
   - Produção e teste passam a ter cada um o seu próprio conjunto de dados em memória. Ao alternar, a tela mostra o snapshot daquele ambiente (recarregando do banco quando ele ainda não existir ou estiver desatualizado).
   - Alternar de volta para produção não fica dependendo de "sorte" de recarga: o snapshot de produção é restaurado/recarregado explicitamente.

3. **Troca de ambiente com recarga determinística**
   - Ao ligar/desligar o Modo Teste, a recarga só acontece depois que o servidor confirma a troca, e a carga em voo do ambiente anterior é cancelada/ignorada.
   - Enquanto a recarga acontece, o painel mostra estado de carregamento em vez de números do ambiente errado.

4. **Verificação de integridade ciente do ambiente**
   - O card passa a exibir claramente o ambiente da checagem ("Produção" ou "Modo Teste").
   - A coluna "Banco" e a coluna "Dashboard" passam a comparar sempre o mesmo ambiente; o botão "Atualizar snapshot" recarrega o ambiente ativo.
   - Se por algum motivo os dois lados estiverem em ambientes diferentes, o card avisa "recarregando ambiente" em vez de acusar divergência falsa.

## Detalhes técnicos

- `src/lib/db-sync.ts`: `loadSnapshot()` e `dbFetchDiagnostics()` passam a resolver e retornar o `env` efetivo (via estado de sandbox do usuário), permitindo validação de origem.
- `src/lib/store.ts`: novo campo `currentEnv` no store; cache de snapshot por ambiente; `refreshFromDb`/`refreshSnapshot` marcam o ambiente da requisição e descartam respostas de ambiente divergente (invalidando também a coalescência atual `refreshInFlight`).
- `src/lib/use-sandbox.tsx`: `setActive` só dispara `reloadAppData()` após confirmação do servidor, informando o novo ambiente.
- `src/components/dashboard-integrity-card.tsx`: rótulo do ambiente, estado "sincronizando ambiente" e comparação só entre lados do mesmo ambiente.
- Nenhuma mudança de banco de dados é necessária: as regras por ambiente/dono já existem.
