# Card "Produtos" em Configurações

Um novo card em Configurações que abre um modal com o catálogo completo de produtos, filtros, relatórios e geração de NCM em lote.

## Catálogo

- Lista agregada por **produto + plataforma** (não linha a linha), com: nome, plataforma, quantidade total, quantidade paga, quantidade em aberto, valor total e valor pago.
- Busca por nome, filtro por plataforma (usando a mesma lista já existente do sistema) e ordenação: A–Z, Z–A, mais vendidos, maior valor.
- Paginação server-side (o banco tem ~23 mil produtos, então nada é carregado inteiro no navegador).
- Respeita o ambiente atual: produção mostra produção, modo teste mostra apenas o sandbox do próprio usuário.

## Relatórios

Duas abas de relatório dentro do modal, cada uma com duas colunas lado a lado — **Pagos** e **Em aberto**:

- **Top plataformas**: ranking por quantidade e por valor.
- **Top produtos**: ranking dos 20 itens mais vendidos, por quantidade e por valor.

## Geração de NCM

- Botão "Gerar NCM" processa **todos os itens únicos** (nome + plataforma) do catálogo em lotes, com barra de progresso, contagem restante e opção de pausar/retomar. Se a página for fechada, ao voltar ele continua de onde parou (nada já classificado é reprocessado).
- Cada lote é classificado pela IA com um prompt fiscal reforçado e **verificação dupla**: a resposta passa por uma segunda checagem que confirma se o NCM tem 8 dígitos válidos, se está entre os capítulos plausíveis para o segmento (jogos, consoles, acessórios, colecionáveis) e se é coerente com a plataforma. Itens que não passam na verificação ficam marcados como "revisar" em vez de receber um NCM inventado.
- Cada NCM salvo guarda: código, categoria fiscal, nível de confiança, justificativa curta e data. Fica visível na tabela e é editável manualmente (edição manual trava o registro contra sobrescrita da IA).
- O catálogo de NCM é reutilizado automaticamente na emissão de Nota Fiscal: itens já classificados não vão mais para a IA na hora de gerar a NF.
- Exportação CSV do catálogo com NCM.

## Detalhes técnicos

**Banco**
- Nova tabela `public.product_ncm`: `name_key`, `platform_key`, `name`, `platform`, `ncm`, `category`, `confidence`, `rationale`, `source` (`ai`/`manual`), `verified_at`, `env`, `sandbox_owner`. Chave única por `(env, sandbox_owner, name_key, platform_key)`. GRANTs para `authenticated`/`service_role`, RLS com `env_row_visible(env, sandbox_owner)` + `has_any_internal_role`, triggers `sandbox_owner_guard` e `touch_updated_at`.
- Nova função `public.product_catalog(...)` (SECURITY DEFINER, checagem de papel interno como em `count_env_rows`) retornando o catálogo agregado paginado com busca/filtro/ordenação, já com o NCM associado — evita os timeouts que a contagem exata sofria com RLS por linha.
- Nova função `public.product_reports(...)` para os rankings (top plataformas / top produtos, separados por pago e em aberto).
- Índices auxiliares: `products (env, sandbox_owner, platform)` e índice de expressão em `lower(name)`.

**Servidor**
- `src/lib/products-catalog.functions.ts`: `listProductCatalog`, `getProductReports`, `saveProductNcm` (edição manual) — todos com `requireSupabaseAuth`.
- `src/lib/product-ncm.functions.ts`: `classifyNcmBatch` (lote de ~25 itens) usando o AI Gateway com prompt fiscal estrito + segunda passada de verificação; retorna apenas itens aprovados e a lista dos reprovados. Reaproveita o estilo já usado em `nf-format.functions.ts`.

**Cliente**
- `src/components/products-catalog-modal.tsx`: modal com abas Catálogo / Relatórios, usando `useServerTable` para paginação e `useQuery` para relatórios.
- `src/components/products-card.tsx`: card em Configurações que abre o modal (visível para papéis internos com permissão de configurações).
- Registro do card em `src/sections/configuracoes-section.tsx`.
- `src/lib/nf-format.ts` / fluxo de NF: consulta o catálogo `product_ncm` antes de chamar a IA.
