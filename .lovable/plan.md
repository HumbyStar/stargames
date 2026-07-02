# Padronização do campo "Situação"

Baseado no PDF `Padronizacao_Situacao_Notion_1.pdf` e na lista completa de variações, vou criar um normalizador único usado em toda a importação (ZIP/Notion, HTML, colada, IA) para converter qualquer texto bruto em um dos status oficiais do sistema.

## Situações oficiais alvo

O sistema hoje tem `Situation = "Em Aberto" | "Enviado" | "Retirado" | "Removido" | "Desistiu" | "Abandonou" | "Resolvido"` e `FinancialStatus = "Pago" | "Reserva" | "Pendente" | "MGMV"`.

Adiciono **`"Retirar"`** ao enum `Situation` (item pendente de retirada). Mantenho o resto como está — o mapeamento consolida todas as variações em 5 buckets:

| Bucket oficial | Situation | FinancialStatus (quando aplicável) |
|---|---|---|
| Enviado | `Enviado` | preserva o financeiro atual |
| Retirado | `Retirado` | preserva |
| Retirar | `Retirar` (novo) | preserva |
| Removido | `Removido` | preserva |
| MGMV / LOTE | `Em Aberto` | força `MGMV` |
| Pago / LOTE PAGO | `Enviado` | força `Pago` |

## Regras de normalização

Antes de bater no dicionário:
- `trim` + colapsar espaços
- `toLowerCase`
- remover acentos (`normalize("NFD").replace(/\p{Diacritic}/gu, "")`)
- remover markdown tachado `~~...~~`
- descartar sufixos livres depois do primeiro token/marcador reconhecido (datas `dd/mm/aaaa`, nomes entre parênteses, observações após " - ", asteriscos, "NF gerada …", etc.)
- normalizar erros comuns: `envaido|enviad0|enviadonf|enviadomateus|enviadonão` → `enviado`; `removdo|removid0` → `removido`; `desisitiu|desistencia|desitiu|deisitiu|desisistiu` → `desistiu`.

Match por **prefixo** dos tokens já normalizados, para absorver naturalmente variações como "ENVIADO - M -", "ENVIADO 05/03/2025", "RETIRADO6 junho", "REMOVIDO desistência".

Dicionário de raízes (após normalizar):
- `enviado`, `entregue`, `enviou` → **Enviado**
- `pago`, `lote pago` → **Enviado** + FS `Pago`
- `retirado`, `cliente retirou`, `retirouna loja` → **Retirado**
- `retirar` → **Retirar**
- `removido`, `cancelado`, `devolvido`, `expirado`, `item expirado`, `itens removidos`, `item removido`, `desistiu`, `desistencia`, `desistiu do item`, `cliente desistiu`, `deu erro`, `nao funcionou`, `quer trocar`, `perdeu`, `sumiu`, `cliente sumiu`, `saiu do grupo`, `deixou de credito`, `valor devolvido`, `de volta ao estoque`, `taxa item nao pago`, `taxa paga`, `credito usado`, `preferiu ficar de credito`, `item repetido`, `reserva expirou` → **Removido**
- `mgmv`, `lote 1`, `lote ` + número → **Em Aberto** + FS `MGMV`
- entrada vazia / `-` → **Em Aberto** (mantém financialStatus atual)

Qualquer valor que não bater retorna `{ situation: null, unknown: true, raw }` e é registrado num log (console + `sessionStorage.setItem("import.situation.unknown", …)`) para revisão futura, como pede o PDF.

## Arquivos

**Novos**
- `src/lib/situation-normalizer.ts` — função pura `normalizeSituation(raw, currentFinancialStatus?)` retornando `{ situation, financialStatusOverride?, unknown, matchedRule }`, mais `SITUATION_ALIASES` exportado para testes.
- `src/lib/situation-normalizer.test.ts` — cobre toda a lista de 90+ variações que o usuário mandou, garantindo bucket correto para cada uma.

**Alterados**
- `src/lib/store.ts` — adicionar `"Retirar"` ao union `Situation`. Ajustar `isResolvedSituation` (Retirar é ainda em aberto → não resolvida) e `getSituationStyle`/labels correspondentes.
- `src/lib/list-import-parser.ts` — usar `normalizeSituation` quando a linha trouxer coluna de situação (ainda que hoje não seja obrigatória; só afeta linhas onde o parser identificar um token de situação além de PAGO/RESERVA/PENDENTE).
- `src/lib/list-import-ai.functions.ts` e `src/lib/list-ai-analyze.functions.ts` — passar `situation` da IA pelo normalizador antes de gravar, em vez de aceitar o texto cru.
- `src/lib/db-sync.ts` e/ou o pipeline de importação ZIP/Notion — chamar o normalizador para o campo Situação vindo do CSV/HTML do Notion antes de salvar em `products.situation`.
- `src/sections/clientes-section.tsx`, `collection-section.tsx`, `mgmv-section.tsx`, `configuracoes-section.tsx` — se houver rótulos/filtros em UI, incluir "Retirar" como opção (só onde já existe seletor de situação).

**Fora de escopo**
- Backfill retroativo em produtos já salvos com strings livres. Fica opcional em segunda rodada (posso adicionar um botão "Padronizar situações antigas" na seção Configurações se quiser).

## Verificação

- `bunx vitest run src/lib/situation-normalizer.test.ts src/lib/list-import-parser.test.ts`
- `tsgo --noEmit`
- Colar uma amostra da lista no importador em modo preview e conferir a coluna Situação já normalizada.

## Perguntas de decisão (rápidas)

1. Adicionar `"Retirar"` como situação nova está OK? (o PDF pede, mas o enum atual não tem.)
2. Quer que eu já rode um **backfill** nos produtos existentes na primeira importação/carga (botão em Configurações), ou deixo só para dados novos?
