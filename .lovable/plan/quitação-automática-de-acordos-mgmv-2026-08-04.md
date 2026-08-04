# Quitação automática de acordos MGMV

Quando todas as parcelas de um acordo MGMV estiverem marcadas como pagas, o sistema passa a avisar o usuário e oferece dois caminhos: confirmar a quitação (encerrando o programa MGMV do cliente) ou revisar as parcelas antes.

## Comportamento

**Detecção**
- Um acordo é considerado "totalmente pago" quando todas as parcelas estão marcadas como pagas e não há saldo pendente.

**Aviso**
- Aparece uma faixa de destaque com o texto "Todas as parcelas foram pagas" em dois lugares:
  - na seção MGMV, ao expandir o cliente (e um selo na linha da lista);
  - na ficha do cliente (drawer em Clientes), quando ele tem acordo MGMV.
- A faixa traz dois botões:
  - **Revisar parcelas** — abre o editor de acordo já existente, onde é possível desmarcar pagamentos ou corrigir valores/datas.
  - **Concluir MGMV** — abre a janela de confirmação.

**Janela de confirmação**
- Resume: total do acordo, nº de parcelas pagas, valor pago e a lista dos produtos que estão no acordo.
- Explica o efeito: os produtos passam a ser individuais com status **Pago** e situação **Em Aberto**; o cliente sai do programa MGMV.
- Botões: "Revisar parcelas" (volta ao editor), "Cancelar" e "Confirmar quitação".

**Ao confirmar**
- Cada produto do cliente com status MGMV vira `Pago` / `Em Aberto`, desvinculado do acordo. Produtos já Enviados/Retirados/Removidos mantêm a situação atual, mudando só o status financeiro para Pago.
- O acordo é marcado como **Quitado** e arquivado: o cliente deixa de aparecer na lista MGMV ativa, mas o acordo continua consultável na ficha do cliente.
- O cliente volta a ser do tipo comum nas telas de Clientes e Cobrança.
- Confirmação por toast e registro no histórico de atividade.

## Detalhes técnicos

- `src/lib/mgmv-schedule.ts` (ou novo helper): `isAgreementFullyPaid(agreement)` — todas as parcelas `paid` e soma paga ≥ total.
- `src/lib/store.ts`: nova ação `completeMGMVAgreement(clientId)` que
  - grava `agreement.status = "quitado"` + `completedAt`, mantendo o acordo em `client.mgmv`;
  - define `clientType = "common"`;
  - atualiza os produtos com `financialStatus: "MGMV"` para `Pago`, limpando `includedInMgmv`/`mgmvAgreementId`, e `situation: "Em Aberto"` apenas para os que ainda estavam em aberto/resolvido;
  - enfileira os upserts existentes (`queueClientUpsert`, `queueProductUpsert`, `dbSyncAgreementForClient`).
- Novo componente `src/components/mgmv-complete-modal.tsx` com o resumo e as ações.
- `src/sections/mgmv-section.tsx`: faixa de aviso + selo na linha; filtra acordos quitados da lista ativa (com opção de vê-los pelo filtro de status já existente).
- `src/sections/clientes-section.tsx`: mesma faixa de aviso no drawer do cliente.
- Testes em `src/lib/mgmv-schedule.test.ts` para a detecção de quitação (parcelas parciais não contam).
