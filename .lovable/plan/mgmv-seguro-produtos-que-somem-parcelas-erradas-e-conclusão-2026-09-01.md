# MGMV seguro: produtos que somem, parcelas erradas e conclusão só por confirmação

## O que eu confirmei no seu banco agora

- Existem **11 produtos com status "MGMV" que não pertencem a nenhum acordo ativo**. Eles contam no card "Produtos" no topo da ficha, mas não aparecem em nenhuma das duas tabelas: a lista de Individuais esconde tudo que é "MGMV", e a tabela "Itens incluídos no MGMV" só é exibida quando existe acordo ativo. É exatamente o "produto fantasma" que você descreveu.
- Ao criar um acordo, o sistema salva o acordo **antes** de marcar os produtos como MGMV. Nessa janela, o vínculo do produto com o acordo pode não ser gravado — gerando mais órfãos.
- Ao adicionar um produto novo a um cliente que já é MGMV, o item entra sem vínculo com o acordo; dependendo da ordem das gravações ele fica invisível mesmo com o banco confirmando a linha.
- Há divergência entre o contador de parcelas pagas do acordo e as linhas reais de parcelas (ex.: cliente William, acordo diz 1 paga, existem 2 linhas pagas).
- Na regra de pagamento, quando o valor pago cobre todo o saldo restante, as demais parcelas pendentes são recalculadas para valor zero — o que faz o acordo aparecer como quitado por inteiro logo após a primeira parcela.

## O que vou fazer

### 1. Nenhum produto pode ficar invisível
- Regra nova: todo produto do cliente aparece em alguma tabela, sempre.
- Produto com status MGMV sem acordo ativo passa a aparecer na lista de Individuais com um aviso "Sem acordo vinculado" e um botão "Corrigir status" (vira Pago ou Pendente conforme o valor pago).
- O card "Produtos" no topo passa a ser calculado a partir das listas exibidas + arquivados; se sobrar qualquer item, aparece um aviso clicável em vez de um número que não bate.
- Correção dos 11 itens já existentes, revisada por você antes de aplicar.

### 2. Cadastro de produto em cliente MGMV
- No modal de adicionar produto de um cliente com acordo ativo, escolha explícita: **entra no acordo** ou **item individual**.
- Se entrar no acordo: o produto é criado, confirmado no banco e vinculado ao acordo (marcação de inclusão + id do acordo) na mesma operação, com recálculo do acordo. Se qualquer etapa falhar, o item não fica em estado intermediário e a mensagem de erro é clara.
- Na criação do acordo, inverto a ordem: primeiro os produtos são marcados, depois o acordo é gravado uma única vez, aguardando confirmação.

### 3. Atualização em tempo real sem sumiço
- A proteção da linha recém-criada só é liberada quando uma releitura já enxerga o item (hoje é liberada antes, e uma leitura atrasada consegue apagá-lo da tela).
- Acordos e parcelas passam a ser atualizados em tempo real na ficha, como já acontece com clientes e produtos.
- A gravação de parcelas deixa de ser "apagar tudo e reinserir" e passa a ser uma atualização transacional, eliminando o instante em que o acordo aparece sem parcelas.

### 4. Parcelas: nada de quitação indevida
- Parcela pendente nunca pode ficar com valor zero por redistribuição; o saldo é distribuído respeitando um valor mínimo e o restante real do acordo.
- Quitação passa a exigir duas condições ao mesmo tempo: todas as parcelas marcadas como pagas **e** soma efetivamente paga igual ao total do acordo.
- Correção da divergência entre o contador do acordo e as linhas de parcelas, com recontagem a partir das parcelas reais (fonte única).
- Testes cobrindo: pagar a 1ª parcela de um acordo novo, pagamento parcial curto, pagamento que cobre todo o saldo.

### 5. Conclusão do MGMV só por confirmação
- A conclusão continua acontecendo **apenas** pelo botão da ficha ou pelo painel de confirmação — nunca automática.
- Novo painel "MGMV quitados aguardando confirmação" na seção MGMV, com contador no menu, listando os acordos com todas as parcelas pagas e ainda não concluídos. Fechar o aviso não perde o acordo: ele continua nessa lista.
- Antes de concluir, o sistema exige que os itens do acordo estejam carregados e mostra quantos produtos serão convertidos em Pago/Em Aberto. Se a leitura dos itens falhar, a conclusão fica bloqueada (já é assim, mantenho e deixo a mensagem explícita).

### 6. Verificação
- Uma checagem de integridade MGMV (produtos órfãos, parcelas divergentes, acordos quitados sem confirmação) exibida em Configurações, para você conferir a qualquer momento.

## Detalhes técnicos

- `src/lib/store.ts`: `addProduct` (liberação da marca local só após releitura confirmar), `registerPayment`/`applyMGMVPartialPayment` (piso de valor, quitação por soma paga), `completeMGMVAgreement` (mantém RPC atômica `complete_mgmv_agreement`).
- `src/lib/db-sync.ts`: `dbSyncAgreementForClientAsync` passa a usar upsert transacional de parcelas (nova função no banco) em vez de delete+insert; `buildAgreementRow` recalcula `paid_installments`/`paid_value` a partir das parcelas.
- `src/sections/clientes-section.tsx`: fallback de exibição para produtos MGMV órfãos, contador derivado das listas, botão "Corrigir status".
- `src/components/mgmv-create-modal.tsx`: ordem produtos → acordo, com espera de confirmação.
- `src/components/mgmv-completion-watcher.tsx` + seção MGMV: painel de quitados aguardando confirmação.
- Realtime: incluir `mgmv_agreements` e `mgmv_installments` nas assinaturas já existentes (respeitando o modo ocioso, para não voltar a subir consumo).
- Migração de dados: normalizar os 11 produtos MGMV órfãos e recontar parcelas dos acordos divergentes.
