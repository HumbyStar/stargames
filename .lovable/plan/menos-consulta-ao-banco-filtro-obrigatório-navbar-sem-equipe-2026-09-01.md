# Menos consulta ao banco: filtro obrigatório, navbar sem Equipe e Finanças rápido

## 1. Retirar Equipe da navbar

- Remove o botão "Equipe" da navbar (desktop e menu mobile) e o modal `Dialog` que carrega `EquipeSection`.
- Remove o pré-carregamento de `equipe-section` e o estado `equipeOpen/openEquipe/closeEquipe` do `ui-store`.
- O registro de ponto (`TeamPunch`) deixa de ser acessível pela navbar; nada é apagado no banco.

## 2. Finanças mais rápido

Hoje o painel de Finanças recalcula tudo em memória sobre ~24.000 produtos e ~2.800 clientes a cada abertura/troca de período, e desenha vários gráficos ao mesmo tempo — é isso que trava.

- Passa a consumir uma consulta agregada no servidor (uma única server function que devolve totais, série temporal, distribuição por status e top clientes já somados pelo banco), com cache de 5 minutos e botão "Atualizar".
- Gráficos passam a receber no máximo ~30 pontos (dia/mês conforme o período) e só o gráfico da aba visível é montado.
- O modal só dispara a consulta quando é aberto.

Resultado: abre praticamente instantâneo e sem depender de ter a lista inteira carregada.

## 3. Filtro obrigatório nas seções da one-page

Seções: Clientes, Cobrança, MGMV e Envio.

- O chip "Todos" sai de todas elas. Estado inicial passa a ser "nenhum filtro".
- Sem filtro (e sem busca), a tabela mostra um estado vazio centralizado, com ícone de funil, fundo desfocado e o texto: **"Aplique o filtro desejado à consulta."**
- Nenhuma linha é lida/renderizada nesse estado; ao escolher um chip ou digitar uma busca (a partir de 3 caracteres, com debounce), a lista aparece paginada de 20 em 20 como já é hoje.
- O drill-down dos cards do Dashboard continua funcionando: ele já grava o chip da seção antes de rolar até ela.

## 4. Carregamento sob demanda (a maior economia)

Hoje, toda abertura/refresh do sistema lê a tabela inteira de clientes, produtos, acordos e parcelas para a memória, mesmo que ninguém abra uma lista.

- Esse carregamento passa a ser **sob demanda**: acontece na primeira vez que algo realmente precisa da lista (aplicar um filtro, buscar, abrir importação, concierge, integridade), e fica em cache na sessão.
- O Dashboard continua com os agregados do servidor, então abrir o sistema e olhar os números **não lê mais nenhuma lista**.
- Abrir a ficha de um cliente continua lendo só os produtos daquele cliente.

## 5. Onde o banco é mais consultado (mais usado x menos usado)

| Função | Peso no banco | Uso real |
|---|---|---|
| Carga completa de clientes/produtos/acordos/parcelas na abertura | **Altíssimo** (~30 mil linhas por sessão) | Involuntário — ninguém pede |
| Painel de Finanças (varre tudo em memória, mas depende da carga acima) | Alto | Baixo/médio |
| Listas Clientes / Cobrança / MGMV com chip "Todos" | Alto | Médio (e quase sempre sem necessidade de ver tudo) |
| Agregados do Dashboard | Médio (contagens) | **Altíssimo** — é a primeira tela |
| Ficha do cliente (produtos, NF, envios) | Baixo por abertura | Alto |
| Importação (upserts em lote) | Alto em picos | Médio |
| Backups | Alto, mas agendado | Baixo |
| Presença / heartbeat / notificações / ping | Baixo por chamada, alto por repetição | Involuntário (já reduzido pelo modo ocioso) |
| Sync SuperFrete | Baixo | Baixo |
| Verificação de integridade | Alto por execução | Baixo (só no botão) |
| Catálogo de produtos / NCM | Médio | Baixo |

Prioridade de economia: itens 4, 3 e 2 desta lista de mudanças atacam exatamente as três primeiras linhas da tabela — que hoje são o grosso dos créditos.

## Detalhes técnicos

- `src/components/app-layout.tsx` e `src/lib/ui-store.ts`: remoção do botão/modal Equipe.
- `src/lib/api/queries.functions.ts`: nova `getFinanceAggregates` (agregações SQL por período), consumida em `src/components/finance-dashboard.tsx`.
- `src/sections/{clientes,collection,mgmv,envio}-section.tsx`: remoção do chip "Todos", estado inicial vazio, novo componente compartilhado `FilterEmptyState` (blur + ícone + texto).
- `src/lib/db-sync.ts` + `src/lib/store.ts`: `loadSnapshot` deixa de rodar no boot; passa por um `ensureSnapshotLoaded()` chamado pelos consumidores que precisam das listas.
- Sem migração de banco, sem mudança de RLS, sem remoção de dados.
