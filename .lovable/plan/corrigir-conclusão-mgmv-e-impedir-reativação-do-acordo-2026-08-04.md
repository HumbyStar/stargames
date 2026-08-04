# Corrigir conclusão MGMV e impedir reativação do acordo

## Diagnóstico confirmado

- O histórico do banco mostra que a conclusão funcionou inicialmente: o produto foi convertido de `MGMV` para `Pago`, o cliente mudou para `common` e recebeu `completedAt`.
- Minutos depois, uma sincronização atrasada gravou novamente a versão antiga do cliente, removendo `completedAt` e restaurando `client_type = mgmv`. Isso reativou visualmente um acordo já quitado.
- Como o produto já estava corretamente convertido para `Pago`, a tentativa seguinte de concluir não encontrou produtos com status `MGMV` e exibiu o bloqueio incorreto visto no pop-up.
- Existem outros acordos quitados no banco com a mesma inconsistência: cliente ainda classificado como MGMV; um deles ainda conserva produtos MGMV e os demais já têm produtos convertidos.

## O que será feito

### 1. Conclusão transacional no banco

- Criar uma função protegida no banco para concluir um acordo em uma única transação.
- A função validará usuário interno, ambiente atual, proprietário do sandbox e existência do acordo.
- Dentro da mesma transação ela irá:
  - converter todos os produtos vinculados ao acordo para `Pago`, preencher o valor pago e remover os vínculos MGMV;
  - preservar situações finais como Enviado, Retirado e Removido, usando `Em Aberto` para os demais;
  - manter o acordo arquivado como `Quitado`;
  - definir o cliente como `common` e registrar a conclusão no JSON legado usado pela interface.
- O retorno informará quantos produtos foram convertidos e permitirá conclusão idempotente: se os produtos já tiverem sido convertidos, a função apenas consolida o cliente como inativo sem gerar o falso erro de “0 produtos”.

### 2. Remover a corrida de sincronização

- Substituir a cadeia atual de gravações assíncronas da conclusão por uma única chamada transacional.
- Só atualizar definitivamente a interface após sucesso; em falha, preservar o estado anterior e mostrar uma mensagem clara.
- Impedir que sincronizações antigas de um acordo ativo sobrescrevam uma conclusão já gravada no banco.
- Ajustar a reconstrução do snapshot para reconhecer `status = Quitado` como acordo concluído, mesmo em registros antigos sem `completedAt` relacional.

### 3. Estado visual consistente

- Tratar acordo quitado como inativo em todas as derivações da interface, não apenas quando existe `completedAt` no estado local.
- Após confirmação, remover imediatamente a área “Acordo MGMV” e “Itens incluídos no MGMV” da ficha; os produtos aparecem somente no histórico individual como `Pago / Em Aberto`.
- Manter acordos totalmente pagos, mas ainda não confirmados, visíveis em “Quitados aguardando confirmação”.
- Quando um acordo antigo já estiver quitado e os produtos já tiverem sido convertidos, não exigir novamente produtos MGMV para consolidar o cliente comum.

### 4. Reparar os dados inconsistentes existentes

- Aplicar uma migração corretiva restrita aos acordos já marcados como `Quitado`:
  - converter qualquer produto que ainda esteja em MGMV;
  - remover vínculos residuais;
  - mudar o cliente para `common`;
  - registrar a conclusão no estado legado.
- Não alterar acordos ativos, pendentes ou de outro ambiente/proprietário.

### 5. Validação

- Cobrir em testes: conclusão normal, repetição idempotente, produto já convertido, situações finais preservadas, falha sem estado parcial e snapshot de acordo quitado.
- Validar no modo produção e no sandbox individual: pagar a última parcela, abrir o modal, confirmar, verificar a migração para produtos individuais e recarregar a página para confirmar que o cliente continua inativo.

## Detalhes técnicos

- Migration com função `SECURITY DEFINER`, `search_path` fixo, validação de `auth.uid()`, grants somente para `authenticated`/`service_role` e `EXECUTE` revogado de `anon`/`public`.
- `src/lib/db-sync.ts`: wrapper da operação transacional, proteção do sincronizador contra regressão de acordo quitado e leitura do status relacional.
- `src/lib/store.ts`: conclusão assíncrona baseada na operação transacional, sem fila concorrente de cliente/produto/acordo.
- `src/components/mgmv-completion-watcher.tsx`, `src/sections/clientes-section.tsx` e `src/sections/mgmv-section.tsx`: espera do resultado e derivação consistente de ativo/inativo.
- `src/lib/mgmv-complete.test.ts`: cenários de regressão e idempotência.