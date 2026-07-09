Plano de correção:

1. Criar uma regra única de cálculo financeiro por cliente
- Centralizar em um helper reutilizável os valores oficiais:
  - Total comprado
  - Valor pago
  - Valor restante / a receber
  - Inadimplência real
- Para cliente comum: somar produtos do cliente.
- Para cliente MGMV: somar o total do acordo MGMV uma única vez, sem duplicar os produtos já incluídos no acordo, e somar também produtos fora do acordo quando existirem.
- Pagamentos parciais de parcelas MGMV serão descontados corretamente do restante.

2. Alinhar o modal do cliente com essa regra
- O card “Total Comprado” do cliente continuará mostrando o valor oficial.
- “Valor Pago” e “Valor Restante” usarão a mesma base matemática, sem cálculo paralelo.

3. Alinhar o modal de finanças com a mesma regra
- “Faturamento Total” passará a ser a soma do total comprado oficial de todos os clientes.
- “Recebido”, “A Receber” e “Inadimplência” serão derivados da mesma função usada no cliente.
- “Top devedores” usará o saldo restante oficial.
- “Top compradores” usará o total comprado oficial dos clientes sem pendência, não um valor calculado de forma diferente.

4. Corrigir inadimplência falsa
- Inadimplência só contará valores vencidos e realmente em aberto.
- Não contará produto pago.
- Não contará produto já consolidado em MGMV.
- Não contará vencimento histórico de produto que virou acordo MGMV.
- Cliente em dia deve mostrar R$ 0 de inadimplência.

5. Garantir atualização ao vivo
- Como a tela já reage ao estado global de clientes/produtos, ao trocar produto, pagamento, parcela ou revisão de IA, todos os cards e modais recalcularão automaticamente sem precisar recarregar a página.
- O objetivo é remover cálculos duplicados espalhados pelo sistema, que hoje causam diferenças grandes entre as telas.

6. Validar com o cenário atual
- Conferir o cliente único importado: o valor do modal de finanças deve bater exatamente com o “Total Comprado” do cliente.
- Confirmar que a inadimplência fica zerada quando não houver parcela/produto vencido em aberto.