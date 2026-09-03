# MGMV sem falhas: criação assistida e fim do "produto some e volta"

## O que eu confirmei no código e no banco

1. **Ordem de gravação errada na criação do acordo.** No modal de criação (`mgmv-create-modal.tsx`), os produtos selecionados são marcados como MGMV com `updateProduct(...)`, que apenas **enfileira** uma gravação com atraso (fila com debounce em `db-sync.ts`). Logo em seguida o acordo é gravado pela transação `save_mgmv_agreement_atomic`, que decide quais produtos entram no acordo **lendo o status que está no banco naquele instante**. Como a gravação dos produtos ainda não chegou, a transação marca todos como "fora do acordo"; depois a fila grava o status MGMV, mas sem o vínculo. Resultado: acordo criado com itens soltos, que aparecem ora na tabela do acordo, ora na de produtos individuais.
   Prova no banco: hoje existem 8 produtos em produção com status MGMV e sem vínculo com nenhum acordo.

2. **Duas versões diferentes do mesmo produto na tela.** O carregamento completo converte "MGMV + Em Aberto" para a situação "Resolvido" (três pontos em `store.ts`), mas a atualização em tempo real e a releitura da ficha (`applyRealtimeRow`, `refreshClientData`) gravam a linha crua vinda do banco. O mesmo item alterna entre duas situações conforme o caminho que atualizou por último — e some/reaparece dos filtros. Hoje há 260 produtos em produção nessa condição.

3. **Eco do tempo real sobrescreve a edição em andamento.** `applyRealtimeRow` aplica qualquer linha recebida sem consultar o registro de alterações locais em voo, ao contrário de todos os outros caminhos de leitura. Um evento antigo (inclusive gerado pela própria gravação anterior) devolve o produto ao estado anterior por alguns segundos, até a próxima releitura corrigir. Esse é o "pisca-pisca" percebido.

4. **Erro na criação.** A transação recusa a gravação quando o cliente não é encontrado no ambiente ativo, quando o acordo já está quitado ou quando o usuário não tem papel interno — mas a mensagem que chega na tela é o texto cru do banco, sem explicar o motivo nem o que fazer.

## O que será feito

### 1. Criação do acordo em uma única transação (raiz do problema)
- A tela passa a enviar **a lista explícita de produtos escolhidos** junto com o acordo, em uma só chamada. A transação no banco marca esses produtos como MGMV, vincula ao acordo e desvincula os demais — tudo dentro da mesma operação, sem depender de nenhuma gravação anterior ter chegado.
- Nenhuma gravação com atraso participa mais do fluxo: o modal aguarda a confirmação do banco antes de anunciar sucesso.
- Depois de confirmar, o sistema faz uma releitura direcionada do cliente (acordo + parcelas + produtos) e só então libera a tela. O que aparece é exatamente o que está gravado.

### 2. Uma única regra de exibição
- A conversão "MGMV + Em Aberto → Resolvido" passa a ser aplicada em **um único ponto**, usado por todos os caminhos (carregamento completo, tempo real e releitura da ficha). Acaba a divergência entre telas.

### 3. Tempo real seguro
- Eventos em tempo real passam a respeitar as alterações locais em voo (mesma proteção já usada nas releituras) e a ignorar eventos mais antigos que a versão já exibida. Uma linha só substitui o que está na tela se for mais nova.
- Eventos de acordos e parcelas passam a atualizar a ficha aberta de forma direcionada, em vez de disparar recarga geral.

### 4. Criação assistida na ficha do cliente
Um painel de conferência dentro do próprio modal de criação, com verificação passo a passo antes de gravar:
- produtos selecionados ainda em aberto e sem outro acordo;
- soma das parcelas confere com o total combinado (entrada incluída);
- datas de vencimento válidas e em sequência;
- cliente sem acordo ativo ou quitado conflitante;
- permissão de gravação do usuário atual.

Cada verificação mostra OK / atenção / bloqueio, e o botão de criar só libera sem bloqueios. Depois de gravar, o painel mostra a confirmação real vinda do banco (acordo, número de parcelas e itens vinculados). A conferência com IA já existente continua opcional e separada, sem consumo de créditos na criação.

### 5. Mensagens de erro que explicam o problema
Os erros da transação passam a virar texto claro: cliente fora do ambiente ativo, acordo já quitado, sem permissão, parcelas ausentes — cada um com a ação recomendada.

### 6. Correção dos dados já inconsistentes
Uma migração de reparo vincula ao acordo do cliente os produtos que hoje estão como MGMV sem vínculo (8 linhas em produção) e limpa vínculos órfãos, sem alterar valores nem parcelas.

## Detalhes técnicos

- Banco: nova versão de `public.save_mgmv_agreement_atomic` com parâmetro adicional `_product_ids uuid[]`; quando informado, os produtos da lista recebem `financial_status='MGMV'`, `included_in_mgmv=true`, `mgmv_agreement_id` e `collection_eligible=false`, e os demais do cliente são desvinculados — mantendo os travamentos de linha, a checagem de papel interno, o escopo por `env`/`sandbox_owner` e a monotonicidade de `completed_at`. Mantém-se `SECURITY INVOKER` (RLS aplicada) e o `GRANT EXECUTE` apenas para `authenticated`/`service_role`.
- `src/lib/db-sync.ts`: `performAgreementSync` aceita e repassa `productIds`; `describeDbError` mapeia `P0002`, `55000`, `22023`, `42501`; `applyRealtimeRow` passa a usar `mutationFor` e comparação de `updated_at`.
- `src/lib/store.ts`: extrair `normalizeProductSituation` e aplicar nos quatro caminhos (hydrate, ensureDataLoaded, refreshFromDb, refreshClientData, applyRealtimeRow); novo `createMGMVAgreementConfirmed(clientId, agreement, productIds)` que substitui a sequência `updateProduct` + `setMGMVAgreementConfirmed` na criação.
- `src/components/mgmv-create-modal.tsx`: painel de pré-checagens (`src/lib/mgmv-preflight.ts`, puro e testável), submissão única aguardada, releitura direcionada e estado de confirmação vindo do banco.
- Testes: `src/lib/mgmv-preflight.test.ts` (regras de validação) e casos em `src/lib/store.test.ts` para normalização de situação e para o eco de tempo real não sobrescrever alteração local.
- Sem uso de IA no caminho de criação; nenhuma alteração de regra de negócio de valores/parcelas.
