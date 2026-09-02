# Segmentação de Clientes por Valor Gasto e Categoria

Nova aba dentro da página **Dados Meta** já existente, chamada **Segmentação**, para achar grupos de clientes por quanto gastaram e em qual categoria de produto — e exportar esses contatos para campanhas.

## Onde fica

A página Dados Meta passa a ter dois modos no topo:

```text
[ Dados Meta (wizard atual) ]   [ Segmentação de clientes ]
```

O wizard atual continua intocado. "Segmentação" é uma tela única (sem passos), com filtros no topo e resultado abaixo.

## Categorias configuráveis

Hoje o produto só tem "plataforma" (texto livre, mais de 2.000 valores). Para existir Brinquedos > Figures / Pops / Action Figures:

- Nova tabela de categorias com hierarquia (categoria principal + subcategorias), editável.
- Nova tabela de vínculo plataforma → subcategoria.
- Painel **Categorias** (dentro da própria aba Segmentação, botão "Gerenciar categorias"): lista todas as plataformas existentes com contagem de produtos, e permite arrastar/selecionar a categoria de cada uma em massa (selecionar várias plataformas e aplicar categoria).
- Uma árvore inicial já vem criada: Brinquedos (Figures, Pops, Action Figures, Colecionáveis), Games (PS5, PS4, PS3, PS2, Xbox, Nintendo), Outros. As plataformas mais óbvias (PS5, Xbox, Nintendo…) já vêm pré-vinculadas; o resto começa em "Sem categoria" e você ajusta.
- Selecionar a categoria principal soma automaticamente todas as subcategorias; selecionar a subcategoria soma só ela.

## Filtros

- **Categoria / Plataforma**: Todos os produtos, uma categoria principal, uma subcategoria ou uma plataforma específica.
- **Valor gasto**: mínimo (obrigatório para buscar, pode ser 0) e máximo (opcional).
- **Base de cálculo** (configurável na própria tela, com o padrão "Valor total dos produtos válidos"):
  - Valor total dos produtos (exclui cancelados/devolvidos)
  - Somente valor efetivamente pago
  - Valor total sem exclusões
  - Lista de situações/status a excluir, com checkboxes (cancelado, devolvido, estornado…), preenchida com as situações que realmente existem na base.
- **Ordenação**: maior/menor valor gasto, maior/menor nº de produtos, nome A-Z / Z-A. Padrão: maior valor gasto.

## Resultado

- Contadores: clientes encontrados, valor total movimentado do grupo, ticket médio.
- Tabela: Cliente | Telefone | Nº de produtos | Valor gasto (já respeitando a categoria filtrada) | seta de expandir.
- Uma linha por cliente, sem duplicatas.
- Expandir mostra os produtos que compõem o valor: nome, plataforma, categoria, data, situação, valor.
- Paginação de 20 em 20 com "carregar mais".

## Seleção e exportação

- Checkbox por linha + "Selecionar todos os resultados" (todos os registros do filtro, não só a página visível), com possibilidade de desmarcar individuais.
- Botão **Exportar clientes** com:
  1. **Exportação completa** (CSV/XLSX): nome, telefone, e-mail, nº de produtos, valor gasto, categoria do filtro.
  2. **Exportação para marketing** (CSV/TXT): nome, telefone normalizado 5511999999999, e-mail quando houver.
- Reaproveita o hash SHA-256 opcional e o registro de auditoria de exportação já existentes no Dados Meta.

## Detalhes técnicos

- Migração: `product_categories` (id, nome, parent_id, ordem, env/sandbox_owner) e `platform_categories` (platform_key único por ambiente → category_id), ambas com GRANT + RLS no mesmo padrão das demais tabelas; seed da árvore inicial e dos vínculos óbvios.
- `src/lib/segmentation.functions.ts` (server fn com `requireSupabaseAuth`): agregação SQL por cliente (`clients` + `products` + vínculo de categoria) aplicando categoria, faixa de valor, base de cálculo e ordenação; devolve página + totais do grupo, e o conjunto completo só no momento do export. Um endpoint separado devolve os produtos de um cliente ao expandir.
- Categorias: `src/lib/product-categories.functions.ts` (CRUD da árvore e dos vínculos) e painel `src/components/product-categories-panel.tsx`.
- UI: `src/sections/segmentacao-section.tsx`, montada como aba em `src/sections/dados-meta-section.tsx` (mesmo padrão visual, sem alterar o wizard atual).
- Formatação/export puros em `src/lib/segmentation-format.ts`, reaproveitando `toE164`, `toCsv`, `exportFileName` de `meta-export-format.ts`; XLSX pelo mesmo caminho já usado no Dados Meta.
- Índices de apoio em `products(client_id)` e no vínculo de plataforma para manter a consulta rápida com ~25 mil produtos. Nenhum uso de IA, nenhum crédito de IA consumido.
- Testes unitários para agregação por categoria (os 3 exemplos do documento), normalização de telefone e geração de CSV.
