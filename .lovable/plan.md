# Quitação do MGMV: modal por cima da ficha e produtos direto no histórico individual

## Problemas confirmados no código

1. O modal de conclusão é aberto por um observador global (`mgmv-completion-watcher`), mas a ficha do cliente é um diálogo em tela cheia com o mesmo nível de empilhamento (`z-50`) e fundo opaco. Quando a ficha está aberta, o modal de quitação fica atrás dela — por isso "não aparece".
2. Dentro da ficha do cliente existem hoje duas apresentações dos itens do MGMV: a tabela informativa "Itens incluídos no MGMV" e, logo abaixo, um segundo painel com seleção e ações em lote (`MgmvProductsPanel`). Isso duplica a tabela e conflita com o pedido de tratar seleção/ações só no histórico individual.

## O que será feito

### 1. Modal de quitação sempre por cima
- O modal de conclusão passa a ser exibido acima de qualquer ficha/diálogo aberto (camada própria de empilhamento, acima do diálogo do cliente).
- A detecção deixa de depender só da "transição" de estado: se o acordo está com todas as parcelas pagas e ainda não concluído, o modal abre assim que a última parcela é marcada — inclusive com a ficha do cliente aberta, e independentemente de onde o pagamento foi feito (MGMV, ficha, cobrança, dashboard).
- Fechar sem concluir continua não reabrindo em loop na mesma sessão; a faixa "Todas as parcelas foram pagas" segue disponível.

### 2. Uma única tabela de seleção: Histórico de Produtos — Individuais
- Remover da ficha do cliente o painel de seleção/ações dos produtos MGMV. Enquanto o acordo está ativo, os itens aparecem apenas na tabela informativa "Itens incluídos no MGMV" (sem checkbox e sem ações em lote).
- Toda a seleção, ações em lote (Enviado, Retirar, Removido, Gerar NF, Excluir) e filtros continuam apenas na tabela "Histórico de Produtos — Individuais".

### 3. Ao confirmar a quitação, os itens migram na hora
- Ao confirmar no modal, os produtos do acordo viram individuais imediatamente: status **Pago**, valor pago igual ao total, situação **Em Aberto** (itens já Enviado/Removido/Retirado mantêm a situação atual) e datas preservadas.
- A ficha passa a mostrar esses itens já na tabela de individuais, com as mesmas ações dos demais; o bloco "Itens incluídos no MGMV" some para esse cliente.
- O cliente volta a ser tratado como cliente comum (sai do programa MGMV) e o acordo fica arquivado como quitado.
- Se os filtros salvos de status/situação estiverem escondendo os itens recém-convertidos, a ficha ajusta a exibição para que eles apareçam logo após a conclusão (sem "Nenhum produto" enganoso como no anexo).

## Detalhes técnicos

- `src/components/mgmv-completion-watcher.tsx`: abrir com base no estado atual (todas pagas e sem `completedAt`), não apenas na transição; passar uma classe de z-index maior para o conteúdo do modal.
- `src/components/mgmv-complete-modal.tsx`: aceitar `contentClassName` (ou z-index fixo mais alto) no `DialogContent`.
- `src/sections/clientes-section.tsx`: remover o uso de `MgmvProductsPanel` e o import associado; após a conclusão, garantir que os filtros persistidos não escondam os itens convertidos.
- `src/lib/store.ts`: `completeMGMVAgreement` já converte e persiste na ordem correta — sem mudança de regra, apenas verificação.
- Sem mudanças no banco de dados.
