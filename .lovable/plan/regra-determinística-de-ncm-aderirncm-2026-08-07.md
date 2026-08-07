# Regra determinística de NCM (AderirNCM)

Hoje a classificação de NCM depende inteiramente da IA (duas passadas + auditoria), o que é lento, custa créditos e varia entre execuções. A documentação enviada define uma regra de negócio fixa — ela passa a ser a fonte principal de verdade.

## Como passa a funcionar

Para cada item (nome + plataforma), o sistema aplica em ordem:

```text
texto normalizado (sem acento, minusculo)
  1. mencao a videogame/jogo?  -> 9504.50.00  "Videogame ou jogo"
  2. boneco original?          -> 9503.00.99  "Boneco colecionavel"
  3. pop alternativo/pelucia?  -> 9503.00.31  "Boneco pelucia"
  4. figure 3D?                -> 9503.00.80  "Figure 3D"
  5. fallback                  -> 3926.40.00  "Figure"
```

Palavras-chave iniciais, conforme a documentação:
- Videogame: playstation, ps1–ps5, xbox, nintendo, switch, game boy, gameboy, wii, sega, atari, videogame, video game, console, jogo
- Boneco original: original, bandai, banpresto, good smile (company), kotobukiya, megahouse, alter, max factory
- Pop alternativo: pop alternativo, pelucia
- Figure 3D: 3d, figure 3d, impressao 3d

A busca é por palavra inteira (não casa "3d" dentro de outra palavra), igual ao MVP enviado.

## O que muda na tela (modal Produtos > Gerar NCM)

- O botão principal passa a ser **"Aplicar regra NCM"**: classifica todos os itens pendentes da plataforma escolhida instantaneamente, sem IA e sem consumo de créditos.
- Cada item classificado guarda a origem `regra` e o motivo (qual palavra acionou), visível na tabela junto ao NCM e à descrição fiscal.
- A geração por IA continua existindo como botão secundário, para conferência pontual; a regra determinística sempre tem prioridade sobre o resultado da IA.
- A descrição fiscal (Videogame ou jogo / Boneco colecionável / Boneco pelúcia / Figure 3D / Figure) passa a ser gravada junto do NCM e usada na emissão de Nota Fiscal.

## Detalhes técnicos

- Novo `src/lib/ncm-rules.ts` (puro, sem dependências): `normalizarTexto`, `encontrarPalavras`, `NCM_RULES` e `aderirNCM(entrada)` retornando `{ ncm, descricao, regra, motivo }`. Entrada = `nome + " " + plataforma`. Testes em `src/lib/ncm-rules.test.ts` cobrindo os cinco exemplos da documentação.
- `src/lib/product-ncm.server.ts`: nova `classifyByRules(items)` devolvendo `NcmResult[]` com `source: "rule"`, `confidence: 1`, `status: "ok"`. `upsertNcmRows` passa a aceitar `source` e continua tratando `manual` como travado; registros `ai` podem ser sobrescritos por `rule`.
- `src/lib/product-ncm.functions.ts`: nova server fn `applyNcmRules({ platform, limit })` que busca pendentes via RPC `product_catalog` (`_only_missing_ncm: true`) e grava direto, sem chamar o AI Gateway. `classifyNcmBatch` permanece como caminho de conferência.
- `src/components/products-catalog-modal.tsx`: botão "Aplicar regra NCM" com barra de progresso reaproveitando o loop de lotes atual; coluna de descrição fiscal e badge de origem (regra/IA/manual).
- `src/lib/nf-format.ts`: ao montar a NF, usa `aderirNCM` como fallback local quando o item ainda não está no catálogo `product_ncm`, evitando ida à IA.
- Banco: sem nova tabela; apenas passa a gravar `source = 'rule'` e a descrição fiscal na coluna `category` já existente.