## Contexto

O bug relata que "não existe opção para editar" o acordo MGMV. Investigando:

- `MgmvAgreementEditor` (`src/components/mgmv-agreement-editor.tsx`) **já existe** e cobre tudo pedido no bug: editar Nº de parcelas, valor mínimo/reduzido, recalcular saldo, redistribuir, aumentar parcelas, remover parcelas e remover produtos.
- Ele **só está exposto na seção MGMV** (`src/sections/mgmv-section.tsx`, linha 872).
- A tela do PDF vem do **modal de detalhes do cliente** (`src/sections/clientes-section.tsx`, Card "Acordo MGMV — {status}" em ~L1113), onde **não há botão para abrir o editor**. Por isso o usuário conclui que a edição não existe.

## Correção

Expor o editor no modal do cliente, reutilizando o componente existente — sem lógica nova.

### 1. `src/sections/clientes-section.tsx`
- Importar `MgmvAgreementEditor`.
- Adicionar estado local `mgmvEditOpen` no componente que renderiza o Card "Acordo MGMV".
- No header do Card, adicionar botão **"Editar acordo"** (ícone `Pencil`), habilitado quando `client.mgmv` existe.
- Ao abrir, renderizar `<MgmvAgreementEditor clientId={client.id} agreement={client.mgmv} products={mgmvProducts} onClose={...} />` logo acima (ou substituindo) o bloco tabela de parcelas + itens, no mesmo padrão da MGMV section.
- Enquanto aberto, esconder a tabela de "Marcar como paga" para evitar duas UIs conflitantes; ao fechar, volta ao estado atual.

### 2. Verificação
- Abrir cliente com acordo MGMV → botão "Editar acordo" aparece no Card.
- Alterar Nº de parcelas / valor mínimo → "Recalcular parcelas" redistribui saldo.
- Adicionar/remover parcela pendente funciona.
- Remover produto do acordo (Trash na lista de produtos do editor) muda `financialStatus` para Pendente.
- Salvar persiste via `setMGMVAgreement`, fecha o editor e mostra os novos valores no Card.

## Arquivos afetados

- `src/sections/clientes-section.tsx` — importar editor, adicionar toggle e botão, renderizar componente.

Nenhum novo componente, nenhuma mudança de store/regra de negócio: só discoverability.
