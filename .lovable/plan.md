## Objetivo

Deixar visível, em qualquer lista de produtos do cliente, quais já tiveram nota fiscal gerada — e impedir geração acidental de NF duplicada, com um aviso claro e confirmação reforçada quando o usuário quiser forçar.

## O que já existe

- A tabela de notas guarda quais produtos entraram em cada NF, então dá para saber exatamente quais já foram emitidos.
- O selo "NF" já aparece **apenas** na lista de "Histórico de Produtos — Individuais" do cliente.
- O botão "Gerar Formato NF" hoje aceita qualquer seleção, inclusive produtos que já têm nota.

## O que será feito

### 1. Selo de NF em todas as listas de produtos
O mesmo selo verde "NF" (com quantidade e data da última emissão no tooltip) passa a aparecer também em:
- **Itens incluídos no MGMV** (dentro da ficha do cliente)
- **Produtos retirados/arquivados** (histórico do cliente)
- **Produtos incluídos** na tela MGMV, ao expandir um acordo (a lista de notas do cliente é carregada quando o acordo é aberto)

Assim, em qualquer lugar que o produto apareça, dá para identificar de imediato se ele já gerou nota.

### 2. Aviso de duplicidade ao gerar NF
Ao clicar em "Gerar Formato NF" com uma seleção que contém produtos já emitidos:

- Abre um **modal de aviso** listando, nome a nome, os produtos que já têm nota (com data da última emissão) e, separadamente, quantos produtos estão livres.
- Botões:
  - **"Gerar só com os demais"** — segue para o modal de NF apenas com os produtos que ainda não têm nota. Fica desabilitado se todos os selecionados já tiverem nota (nesse caso o texto explica que não sobrou nenhum produto elegível).
  - **"Gerar mesmo assim"** — não age direto: ao clicar, o próprio modal troca para um estado de reforço, com o texto de que isso vai criar uma **segunda nota para o mesmo produto** e um botão final **"Confirmar e gerar duplicado"**, além de "Voltar" para desistir.
  - **Cancelar** — fecha sem gerar nada.

Se nenhum produto da seleção tiver nota, nada muda: o modal de NF abre direto, como hoje.

### 3. Sinalização na barra de seleção
Quando a seleção contiver produtos já emitidos, a barra de ações mostra um aviso curto ("X já têm NF"), para o usuário perceber antes mesmo de clicar.

## Detalhes técnicos

- Novo componente `src/components/nf-duplicate-warning-modal.tsx` com o fluxo de dois estágios (aviso → reforço).
- `src/sections/clientes-section.tsx`: o clique em "Gerar Formato NF" passa por uma checagem contra o mapa de NFs já existente (`nfProductMap`); o selo é reaproveitado nas listas de MGMV e arquivados.
- `src/sections/mgmv-section.tsx`: carrega as notas do cliente ao expandir o acordo (função de listagem já existente) para exibir o selo.
- Nenhuma mudança de banco: a informação de quais produtos já têm nota já está registrada.
