# Produto vinculado automaticamente ao cliente aberto

Hoje, ao clicar em "Adicionar Produto" dentro da ficha do cliente, o modal já recebe o cliente correto, mas continua mostrando um seletor de "Cliente vinculado" com a lista inteira — o que confunde e permite salvar o produto no cliente errado.

## O que muda

- Quando o modal for aberto a partir da ficha de um cliente, o campo "Cliente vinculado" deixa de ser um seletor e passa a ser apenas uma informação fixa: nome e telefone do cliente aberto, sem possibilidade de troca.
- O modal também passa a garantir que os campos comecem sempre limpos e com o cliente correto ao abrir (hoje o preenchimento inicial depende de um evento que nem sempre dispara).
- Quando o modal for aberto fora da ficha de um cliente (sem cliente definido), o seletor continua aparecendo normalmente.
- Na edição de um produto existente, o cliente fica travado no dono atual do produto.

## Detalhes técnicos

Arquivo: `src/sections/clientes-section.tsx`, componente `ProductModal`.

- Adicionar um `useEffect` que, ao `state.open` virar `true`, reinicia todos os campos do formulário a partir de `state.product` e força `clientId = state.clientId ?? state.product?.clientId`, mantendo a lógica de reset que hoje só existe no `onOpenChange`.
- Renderizar condicionalmente o bloco "Cliente vinculado": se `state.clientId` (ou `state.product`) existir, mostrar um campo somente leitura com `client.name — client.phone`; caso contrário, manter o `<select>` atual.
- Nenhuma mudança em `onSave`, no store ou nas regras de MGMV/status.