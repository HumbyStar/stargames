# MGMV consistente, rápido e sem regressão visual

## Objetivo
Tratar alterações de clientes MGMV como operações prioritárias e indivisíveis: a interface atualiza imediatamente, aguarda confirmação real do banco e nunca reaplica um estado antigo enquanto a gravação está em andamento.

## Diagnóstico confirmado
- Ao pagar uma parcela, o estado local é alterado e o sucesso é exibido imediatamente, mas a sincronização do acordo é disparada sem ser aguardada.
- A gravação atual salva primeiro o resumo do acordo e depois as parcelas, em chamadas separadas.
- Cada uma dessas alterações pode disparar uma releitura em tempo real. Uma releitura entre as duas etapas encontra as parcelas antigas e sobrescreve temporariamente a ficha; a releitura seguinte encontra as novas e faz a parcela “voltar”. Isso corresponde ao comportamento relatado.
- A barreira geral de escritas acompanha clientes/produtos, mas não protege integralmente a sincronização relacional de acordos e parcelas MGMV.

## Implementação

### 1. Gravação atômica do acordo MGMV
- Criar uma operação transacional no banco para salvar, em uma única transação:
  - resumo do acordo;
  - estado completo das parcelas;
  - remoção de parcelas excedentes;
  - vínculos e flags dos produtos MGMV.
- Validar usuário interno e ambiente ativo dentro da operação, preservando o isolamento individual do Sandbox.
- Manter a conclusão do MGMV monotônica: uma gravação atrasada nunca poderá reabrir um acordo já concluído.

### 2. Fila serial por cliente
- Centralizar todas as mutações MGMV em uma fila por `clientId`.
- Pagamentos consecutivos, edição do acordo, inclusão/remoção de produto e importação do mesmo cliente serão executados na ordem em que ocorreram.
- Uma versão mais antiga nunca poderá terminar depois e sobrescrever uma alteração mais nova.

### 3. Confirmação real e estado otimista protegido
- Transformar pagamento integral e parcial em ações assíncronas confirmadas.
- Atualizar a tela imediatamente, bloquear apenas a parcela/ação envolvida e mostrar estado de salvamento.
- Exibir sucesso somente depois da transação confirmada e de uma releitura direcionada do acordo.
- Em falha real, restaurar o último estado confirmado e mostrar uma mensagem clara; sem falso sucesso.

### 4. Realtime sem aplicar snapshots intermediários
- Enquanto houver mutação MGMV pendente para um cliente, eventos de acordo/parcelas desse mesmo cliente serão acumulados, não aplicados sobre o estado otimista.
- Ao concluir a fila, fazer uma única releitura direcionada de cliente, acordo, parcelas e produtos.
- Manter o refresh global apenas como reconciliação de segurança, sem permitir que ele substitua uma alteração local mais recente.

### 5. Unificar os fluxos conectados
Aplicar a mesma operação coordenada a:
- marcar parcela como paga ou registrar pagamento parcial;
- criar e editar acordo MGMV;
- adicionar/remover produto pela ficha;
- adicionar/remover produto no editor do acordo;
- importação em lista com cliente/produto/acordo MGMV.

Para importações em lote, preservar a ordem cliente → produtos → acordo e só concluir quando todos os registros estiverem confirmados e visíveis.

### 6. Experiência na ficha
- Impedir clique duplicado durante a gravação.
- Manter modal/ficha mostrando o estado recém-salvo ao fechar e reabrir.
- Recalcular totais, parcelas pagas, saldo e produtos vinculados a partir do mesmo resultado confirmado.
- Não recarregar a base inteira para uma ação individual; usar consultas direcionadas ao cliente para manter rapidez e reduzir consumo.

## Testes e validação
- Testes de concorrência: pagar duas parcelas rapidamente e confirmar que ambas permanecem pagas.
- Teste de corrida: emitir evento em tempo real entre gravação do acordo e das parcelas e garantir que não haja regressão visual.
- Testes de falha de rede/permissão com rollback e sem mensagem falsa de sucesso.
- Testes de criação/edição, pagamento parcial, inclusão de produto e importação em lista.
- Verificação no navegador: pagar duas parcelas, fechar/reabrir imediatamente a ficha e confirmar estabilidade antes e depois do evento em tempo real.
- Validar produção e Sandbox separadamente, sem alterar ou apagar dados existentes.

## Detalhes técnicos
- A operação transacional substituirá o fluxo sequencial atual de `mgmv_agreements` e `mgmv_installments`.
- A leitura direcionada passará a buscar também acordo e parcelas; hoje ela relê cliente e produtos, mas o MGMV oficial é reconstruído das tabelas relacionais.
- A fila MGMV será integrada à barreira de escritas existente para que refresh, foco da janela e Realtime aguardem a operação correta.
