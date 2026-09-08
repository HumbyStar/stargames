# Regras de categoria por palavras-chave (estilo da regra de NCM), com prévia antes de aplicar

## Como eu entendi seu pedido

Hoje, em "Gerenciar categorias" (Dados Meta), você precisa marcar plataforma por plataforma. Como existem muitos nomes diferentes que são a mesma coisa (PSP, PS Vita, PlayStation Portable, Xbox 360, Switch Lite…), você quer o mesmo estilo da regra de NCM: uma lista de regras em ordem, cada uma com palavras-chave, apontando para uma categoria. O sistema varre todas as plataformas da base, aplica a primeira regra que casar e mostra **uma prévia na tela**: quais plataformas seriam vinculadas, a qual categoria, e quais ficariam sem categoria. Nada é gravado até você confirmar.

## Como vai funcionar

### 1. Nova aba "Regras" dentro de Gerenciar categorias

Painel com duas abas: **Plataformas** (a tela atual, manual) e **Regras** (a nova).

Cada regra tem: nome, categoria de destino (qualquer nível da sua árvore), lista de palavras-chave (separadas por vírgula) e ordem. Você cria, edita, reordena e exclui regras. A ordem importa: vence a primeira regra que casar, igual ao fluxograma do NCM.

Regras iniciais sugeridas já vêm prontas para você revisar (pode editar tudo):
- Videogame: playstation, ps1, ps2, ps3, ps4, ps5, psp, ps vita, vita, psone, xbox, 360, series x, series s, nintendo, switch, wii, ds, 3ds, game boy, gameboy, mega drive, sega, dreamcast, saturn, atari, neo geo, console, jogo, game
- Figures/Colecionáveis: figure, bandai, banpresto, good smile, kotobukiya, megahouse, nendoroid, funko, pop, action figure, pelucia, 3d

A comparação ignora acentos, maiúsculas e pontuação, e casa por palavra contida no nome da plataforma.

### 2. Prévia obrigatória antes de gravar

Botão **Simular regras**. O resultado aparece na própria tela:

```text
Resumo:  1.842 plataformas analisadas
         1.210 receberiam categoria   |   180 mudariam de categoria
           452 continuariam sem categoria
```

Abaixo, uma tabela com filtros (só novas / só mudanças / só sem categoria) mostrando: plataforma, nº de produtos, categoria atual, categoria proposta, regra que casou. Cada linha tem um checkbox — por padrão todas marcadas — para você desmarcar o que não quiser.

Opções: "não alterar plataformas que já têm categoria" (ligado por padrão) e busca por nome dentro da prévia.

Só o botão **Aplicar selecionadas (N)** grava, reaproveitando o vínculo em massa que já existe. Depois disso, o filtro de categoria do Dados Meta recalcula sozinho.

## Detalhes técnicos

- `src/lib/category-rules.ts` (puro, testável): tipo `CategoryRule { id, nome, categoryId, palavras[] }`, `normalizeText()` (lowercase + remoção de acentos), `matchCategoryRule(platform, rules)` → primeira regra que casa, e `buildCategoryPlan(platforms, rules, { skipAssigned })` → linhas `{ platformKey, platform, productsCount, currentCategoryId, proposedCategoryId, ruleId }` + contadores.
- Persistência das regras: `app_settings.rules` (jsonb já existente) sob a chave `categoryRules` — sem migração de banco.
- `src/components/product-categories-panel.tsx`: `Tabs` Plataformas/Regras; editor de regras e tela de prévia (tabela virtualizada por "carregar mais", como hoje).
- Aplicação: `setPlatformCategories` já existente, chamado em lotes (ex.: 300 plataformas por chamada) com barra de progresso; sem novo endpoint.
- Testes unitários em `src/lib/category-rules.test.ts` cobrindo PSP/PS Vita/Xbox 360, prioridade de regra e `skipAssigned`.
