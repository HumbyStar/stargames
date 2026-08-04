# Conclusão do MGMV ao pagar a última parcela + produtos MGMV com as mesmas ações

## Problemas atuais

1. Ao marcar a última parcela como paga, nada acontece na hora: o modal de conclusão só aparece se o usuário voltar à seção MGMV e clicar na faixa de aviso.
2. O acordo com todas as parcelas pagas continua contando como "Ativo" nos cards de resumo e no filtro, mesmo já estando quitado.
3. Os produtos incluídos no MGMV (painel expandido da seção MGMV e bloco MGMV na ficha do cliente) são apenas leitura: não dá para selecionar, marcar como Enviado/Retirado/Removido nem gerar nota fiscal, ao contrário dos produtos individuais.

## O que será feito

### 1. Modal de conclusão automático ao quitar

- Criar um observador global (montado no layout do app) que acompanha os acordos MGMV.
- Quando um acordo passa de "tem parcela em aberto" para "todas pagas" e ainda não foi concluído, o modal de conclusão abre imediatamente — não importa de onde o pagamento foi feito (seção MGMV, ficha do cliente, cobrança ou dashboard).
- O modal é o mesmo já existente, com o resumo de parcelas e produtos e os botões "Revisar parcelas" e "Concluir MGMV".
- Se o usuário fechar sem concluir, a faixa de aviso continua disponível e o modal não reabre em loop para o mesmo acordo na mesma sessão.

### 2. Status "Quitado" coerente na seção MGMV

- Acordo com todas as parcelas pagas e ainda não concluído deixa de contar como "Ativo": passa a aparecer com a etiqueta "Quitado — aguardando conclusão".
- Novo chip de filtro "Quitados" e ajuste dos contadores dos cards de resumo (Ativos deixa de incluir quitados).

### 3. Produtos do MGMV com as mesmas ações dos individuais

- Extrair a barra de ações em lote dos produtos (seleção, Pago, Enviado, Retirar, Removido, Gerar NF, Excluir) da ficha do cliente para um componente compartilhado, sem mudar o comportamento atual dos produtos individuais.
- Aplicar esse componente:
  - no bloco "Produtos incluídos" do painel expandido da seção MGMV;
  - no bloco MGMV da ficha do cliente.
- Cada produto MGMV ganha caixa de seleção, "selecionar todos", contagem de selecionados, badge de NF já emitida e o aviso de NF duplicada, exatamente como nos individuais.
- A ação "Pago" fica bloqueada para produtos ainda em MGMV (o status financeiro só muda pela conclusão do acordo); as demais (Enviado, Retirar/Retirado com o popup obrigatório, Removido, Gerar NF, Excluir) funcionam normalmente.

## Detalhes técnicos

- Novo `src/components/mgmv-completion-watcher.tsx` montado em `src/components/app-layout.tsx`, usando `isAgreementFullyPaid`/`completedAt` de `src/lib/mgmv-schedule.ts` e um ref de acordos já sinalizados.
- Novo `src/components/product-bulk-actions.tsx` com a barra de ações e os handlers hoje inline em `ClientDrawer` (`src/sections/clientes-section.tsx`), incluindo integração com `RetiradoConfirmModal` e `nf-duplicate-warning-modal`.
- `src/sections/mgmv-section.tsx`: `buildRow` passa a expor o estado quitado nos contadores/chips; a lista de produtos incluídos passa a usar o componente compartilhado e o mapa de NF já carregado.
- Sem mudanças de banco de dados.