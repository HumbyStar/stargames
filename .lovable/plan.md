# MGMV: gravação confirmada, produtos visíveis e acesso liberado

## O que foi confirmado no código e no banco

- O papel `viewer` (1 usuário) só tem permissões de leitura. As regras de acesso do banco exigem `clientes.edit` para gravar clientes/produtos e `mgmv.edit` para acordos MGMV. Ou seja, esse usuário tem toda gravação recusada pelo banco.
- Quando a gravação é recusada, o app apenas registra o erro no console (`logErr`) e segue: a tela já mostrou o item e o toast de sucesso. Na releitura seguinte o banco devolve o estado antigo e "desfaz" tudo — exatamente o comportamento relatado.
- O modal "Criar acordo MGMV" mostra `Acordo MGMV criado` imediatamente, sem esperar confirmação: a gravação do acordo (`dbSyncAgreementForClient`) é disparada sem aguardar resultado.
- A sincronização do acordo tem várias etapas (acordo, parcelas, marcação dos produtos). Cada etapa que falha só é logada; se a marcação dos produtos falha, o produto fica sem vínculo com o acordo e some da tabela de itens do MGMV.

## Correções

### 1. Todos os usuários internos podem fazer tudo (dados operacionais)
Todo papel interno passa a ter as permissões de operação: clientes, produtos, cobrança, MGMV, importação, envio, finanças e dashboard. Isso resolve de imediato as gravações recusadas em silêncio. Gestão de usuários/papéis continua exclusiva de admin e admin master (a liberação é de dados, não de administração de acessos).

### 2. Sucesso só depois da confirmação do banco
Criar/editar acordo MGMV, incluir produto no acordo e concluir MGMV passam a aguardar a resposta do banco. Só então aparece o toast de sucesso. Se falhar, o estado local volta ao que era e aparece um erro com o motivo em português (inclusive "sem permissão"), em vez de um falso positivo.

### 3. Erro de gravação nunca mais fica invisível
As falhas de gravação em fila (clientes/produtos) e de sincronização do acordo deixam de ser apenas log: viram aviso na tela, com opção de tentar de novo. O que não gravou não é descartado — continua na fila até confirmar.

### 4. Produto do MGMV sempre aparece
Ao vincular produtos a um acordo, a operação é confirmada e relida do banco antes de fechar o fluxo. O produto aparece na ficha (na tabela de itens do acordo quando marcado como MGMV, ou na lista de produtos comuns quando não estiver), sem depender de recarregar a página.

## Detalhes técnicos

- Migração: inserir em `public.role_permissions` todas as permissões operacionais (`dashboard.view`, `clientes.view/edit`, `collection.view/edit`, `mgmv.view/edit`, `mgmv.register_product`, `import.use`, `finance.view`, `settings.view`, `team.*`, `punch.clock`, `shipping.mark_sent`) para os papéis `manager`, `operator`, `viewer`, `gerente`, `supervisor`, `funcionario`, `envio`, `mgmv`, com `ON CONFLICT DO NOTHING`. `users.manage` fica só em `admin`/`admin_master`. Nenhuma política RLS é afastada — apenas as permissões passam a existir.
- `src/lib/db-sync.ts`: `dbSyncAgreementForClientAsync` passa a lançar erro nas etapas críticas (upsert do acordo, parcelas, marcação de produtos) em vez de apenas logar; `flushPendingClientUpserts`/`flushPendingProductUpserts` expõem o erro por um callback de notificação além do log.
- `src/lib/store.ts`: `setMGMVAgreement` ganha versão assíncrona que aguarda `flushAllPendingUpserts()` + `dbSyncAgreementForClientAsync` e faz rollback do estado local em falha; `updateProduct` para status MGMV entra no mesmo caminho confirmado.
- `src/components/mgmv-create-modal.tsx`, `src/components/mgmv-agreement-editor.tsx`, `src/components/mgmv-complete-modal.tsx`, `src/components/mgmv-products-panel.tsx`: `await` do resultado, toast de sucesso só na confirmação, mensagem de erro traduzida e botão em estado de carregamento até confirmar.
- Releitura direcionada por cliente (`refreshClientData`) após confirmação, passando por `reconcileWithLocalMutations`, para o item aparecer na hora.
- Testes: em `src/lib/store.test.ts`, falha de gravação do acordo não deixa o estado local "aplicado"; produto marcado como MGMV permanece visível na ficha após a releitura.
