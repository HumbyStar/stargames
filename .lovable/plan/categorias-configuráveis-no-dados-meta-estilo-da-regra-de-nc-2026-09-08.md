# Categorias configuráveis no Dados Meta (estilo da regra de NCM)

## Como eu entendi seu pedido

Hoje o seletor novo só oferece "Todos os produtos" e as categorias que já existem no banco. Você quer o mesmo estilo do modal de produtos/regra de NCM: uma tela onde **você cria as categorias** (principal e subcategorias, em qualquer profundidade) e **escolhe quais plataformas entram em cada uma**, aplicando em massa. Depois disso, o filtro de categoria no Dados Meta passa a somar as compras conforme essa árvore.

Além disso, na etapa "Produtos & status" a lista de plataformas está incompleta (hoje ela corta em 400 nomes e só mostra plataformas dos clientes já carregados), e você quer ver todas.

## O que muda

### 1. Botão "Gerenciar categorias" na aba Dados Meta

Ao lado do seletor "Categoria de produtos", um botão abre um painel (mesmo componente já usado na Segmentação de clientes) com:

- Árvore de categorias com criar/excluir, escolhendo dentro de qual categoria a nova entra.
- Lista de **todas** as plataformas existentes, com contagem de produtos, busca por nome, filtro "somente sem categoria", seleção múltipla e "selecionar visíveis".
- Botão "Aplicar" que vincula todas as plataformas selecionadas à categoria escolhida (ou desvincula).

Ao fechar o painel, o Dados Meta recarrega as categorias e recalcula os valores automaticamente.

### 2. Subcategorias em qualquer nível

O painel hoje só permite criar dentro de uma categoria principal. Passa a permitir escolher qualquer categoria como "pai", exibindo o caminho completo (Brinquedos › Figures › Anime). O filtro já soma todos os descendentes, então a hierarquia profunda funciona de imediato.

### 3. Filtro de plataformas completo

A lista de plataformas na etapa "Produtos & status" deixa de ser cortada em 400 e passa a usar a lista real de plataformas da base (a mesma consulta de plataformas usada pelo painel de categorias), com busca dentro do seletor.

## Detalhes técnicos

- `src/sections/dados-meta-section.tsx`: carregar `listCategoryTree` / `listPlatformStats` de `src/lib/segmentation.functions.ts`; botão + `Dialog` com `<ProductCategoriesPanel>`; `onChanged` refaz a consulta de categorias e plataformas; remover o `.slice(0, 400)` das opções de plataforma e alimentar `options.platforms` a partir de `platformStats`.
- `src/components/product-categories-panel.tsx`: no select "Dentro de", listar todas as categorias com caminho completo (não só as raízes).
- Sem migração de banco: `product_categories` e `platform_categories` já existem, com RLS/GRANT.
- `src/lib/meta-export-format.ts` e a agregação `byCategory` permanecem como estão.
