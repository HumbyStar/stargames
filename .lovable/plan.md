# Atualização em tempo real ao importar e ao excluir produtos

## O que foi confirmado no código

- As telas de Clientes/Produtos leem do store (Zustand), e as ações locais já atualizam a tela na hora (`deleteProducts` remove o item do store antes de ir ao banco; a importação cria o cliente com `addClient`).
- As gravações, porém, saem atrasadas e em lote: `queueProductUpsert`/`queueClientUpsert` só enviam ao banco depois de 250 ms (`FLUSH_DELAY_MS`), em blocos de 200 linhas.
- Ao mesmo tempo, qualquer evento do Realtime dispara `refreshFromDb()`, que faz uma releitura completa e paginada do banco (`loadSnapshot`) e sobrescreve as listas do store.
- Não existe barreira entre as duas coisas. Uma releitura iniciada antes de a gravação chegar ao banco devolve o estado antigo e sobrescreve o que a tela já mostrava: o item importado some, ou o produto excluído reaparece. Só depois de recarregar a página (leitura limpa) o estado correto aparece.
- O mesmo `loadSnapshot` pode voltar `partial` (timeout) em bases grandes, o que também deixa a tela sem refletir a mudança.

## Correções

### 1. Barreira de escrita antes de qualquer releitura
Toda releitura disparada por Realtime/reset passa a esperar as gravações pendentes (`flushAllPendingUpserts`) e a conclusão de deletes/imports em andamento antes de ler o banco. Nunca mais uma leitura corre na frente da própria escrita do usuário.

### 2. Marcação de mutações locais recentes (anti-sobrescrita)
Cada id criado, alterado ou excluído localmente entra num registro de "mutações recentes" com carimbo de tempo. Ao aplicar um snapshot do banco:
- ids excluídos há pouco não voltam, mesmo que apareçam na leitura;
- ids criados/alterados há pouco só são substituídos quando a versão do banco for mais nova.
A marca é liberada assim que o banco confirmar o mesmo estado (ou após poucos segundos).

### 3. Atualização direcionada em vez de releitura total
Para eventos vindos do próprio fluxo (importação concluída, exclusão de produtos, edição de produto), o app relê apenas os registros afetados (por cliente/por ids), em vez de recarregar toda a base. A tela fica correta em milissegundos e o risco de timeout some. A releitura completa continua existindo, mas só como reconciliação de fundo e mais espaçada.

### 4. Confirmação real na exclusão e na importação
- "Sucesso" só aparece depois que o banco confirmou a gravação/exclusão. Se falhar, o item volta para a lista e aparece um erro claro em vez de um falso positivo.
- Ao final da importação, o app aguarda o flush e faz a releitura direcionada dos clientes/produtos criados, garantindo que apareçam sem recarregar.

### 5. Eventos de outras abas/usuários
O canal Realtime passa a usar o payload do evento (linha nova/alterada/removida) para aplicar a mudança pontual no store, caindo para a releitura completa apenas quando o payload não for suficiente.

## Detalhes técnicos

- `src/lib/db-sync.ts`: adaptar `FLUSH_DELAY_MS`; expor `awaitPendingWrites()`; novo registro `recentMutations` (Map id → {op, at}); `subscribeRealtimeSnapshot` passa o `payload` ao callback; `loadProductsByIds` e reuso de `loadProductsForClient` para releitura direcionada.
- `src/lib/store.ts`: `refreshFromDb` chama `awaitPendingWrites()` antes de `loadSnapshot`; a aplicação do snapshot passa por um reconciliador que respeita `recentMutations`; `deleteProducts` marca os ids como excluídos e só limpa a marca após confirmação; novas ações `applyRealtimeRow` e `refreshClientData(clientId)`.
- `src/components/app-layout.tsx`: a assinatura Realtime encaminha o payload e usa atualização pontual; releitura completa vira fallback com debounce maior.
- `src/sections/clientes-section.tsx`, `src/components/mgmv-products-panel.tsx`, `src/components/list-import-modal.tsx`, `src/sections/import-section.tsx`: toast de sucesso somente após confirmação e reversão do estado local em caso de erro.
- Testes em `src/lib/db-sync.test.ts` / `src/lib/store.test.ts`: snapshot antigo não ressuscita produto excluído, snapshot antigo não remove cliente recém-importado, releitura direcionada por cliente.