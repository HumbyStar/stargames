## Bug 04 — Normalizar status da importação do Notion

Ajustar `src/lib/situation-normalizer.ts` para seguir a regra do PDF:

- `RETIRAR` (match exato, case-insensitive, após trim) → situação **Retirar**.
- Qualquer variação de desistência, remoção, cancelamento, expiração, abandono, retirado, devolvido, sumiço, troca, expirou etc. → situação **Removido**.
- `ENVIADO` / `PAGO` / `MGMV` / `LOTE …` continuam com o comportamento atual (fora do escopo do bug).
- Vazio / `-` continua como **Em Aberto**.

### Mudanças em `situation-normalizer.ts`

1. Regra `retirar`: passa a exigir match exato (`^retirar$` após `baseNormalize`) em vez de `^retirar\b`. Assim `RETIRAR - valor estornado` e `RETIRAR desistencia` caem na regra removido.
2. Remover regra `retirado` — todos os `RETIRADO*` passam a ser tratados como removido (adicionar `^retirado\b` na regra removido; manter o pré-processamento que separa `retiradoiran` / `retirado6` etc.).
3. Regra `abandonou` deixa de existir como bucket próprio. `abandonou`, `desistiu`, `cliente abandonou`, `desistência` etc. viram **Removido** (adicionar esses gatilhos na regra removido, ou converter no `baseNormalize` para `removido`).
4. Manter regras `pago`, `mgmv`, `enviado` intactas. Manter fallback `Em Aberto` seguro.

Não alterar o tipo `Situation` em `src/lib/store.ts` — os buckets `Retirado` e `Abandonou` continuam existindo internamente (usados por outros fluxos: retirado-confirm modal, filtros), apenas deixam de ser destino da importação do Notion.

### Testes em `situation-normalizer.test.ts`

- Mover todo o bloco `'%s' → Retirado` (RETIRADO, RETIRADO6 junho, RETIRADOIRAN, CLIENTE RETIROU NA LOJA, RETIRADO - já devolvido valor) para o bloco `→ Removido`.
- Mover o bloco `'%s' → Abandonou` (ABANDONOU, DESISTIU e variantes) para `→ Removido`.
- Ajustar o bloco `→ Retirar`: manter apenas `RETIRAR` (e talvez ` retirar `, `Retirar`). Adicionar cobertura de que `RETIRAR - valor estornado` e `RETIRAR desistencia` agora caem em **Removido**.
- Adicionar caso `RETIRAR` exato ainda vira Retirar.

### Fora do escopo

- UI da importação, preview, MGMV e demais parsers permanecem inalterados.
- Situações `Retirado`/`Abandonou` continuam existindo no domínio para uso manual em outros fluxos.

### Arquivos afetados

- `src/lib/situation-normalizer.ts`
- `src/lib/situation-normalizer.test.ts`
