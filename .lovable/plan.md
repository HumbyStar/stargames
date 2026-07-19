## Problema

`reprocessMGMVFromNotes` (usado pelo botão "Reprocessar MGMV por observações" e chamado automaticamente após imports) re-extrai o acordo direto das `notes` do cliente e sobrescreve `c.mgmv`. Ele só preserva `paid`/`paidAt` das parcelas — qualquer edição manual (valor da parcela, vencimento, número de parcelas, `totalDebt`, `paidAmount`, redistribuição por pagamento parcial, ajustes da IA) é perdida, porque as `notes` continuam com os dados antigos da importação. Resultado: alguns clientes "voltam ao estado anterior" ao reprocessar.

O tipo `MGMVAgreement` já tem `reviewStatus` (`"manually_reviewed" | "ai_reviewed" | "review_required" | "none"`) e `aiReviewed`, mas o reprocessador ignora esses sinais.

## Solução

Fazer o reprocess respeitar acordos que já foram tocados pelo usuário / IA, e nunca destruir edições manuais.

### 1. `src/lib/mgmv-reprocess.ts` — pular acordos "bloqueados"

Considerar um acordo bloqueado (skip total, sem chamar `setMGMVAgreement`) quando qualquer uma for verdadeira:

- `c.mgmv.reviewStatus === "manually_reviewed"`
- `c.mgmv.reviewStatus === "ai_reviewed"` ou `c.mgmv.aiReviewed === true`
- `c.mgmv` tem qualquer parcela com sinal de edição/pagamento manual: `paid`, `paidAmount != null`, `manualPartial`, `shortPaid`, `recalculatedAt`
- `totalDebt` do acordo atual difere do `parsed.totalDebt` (indica ajuste manual do total)
- número de parcelas difere de `parsed.installments.length`

Nesses casos: `continue` sem tocar no acordo.

Para acordos não bloqueados, manter o merge atual de `paid`/`paidAt` (proteção mínima) — comportamento inalterado para clientes recém-importados sem edição.

### 2. Marcar edições manuais como `manually_reviewed`

Auditar os pontos onde o usuário edita o acordo diretamente na UI e garantir que gravem `reviewStatus: "manually_reviewed"` no `setMGMVAgreement`:

- `src/sections/clientes-section.tsx` e `src/sections/mgmv-section.tsx`: edição inline de parcela (valor, vencimento, marcar/desmarcar paga, pagamento parcial), edição de `installmentsCount`, `paidInstallments`, `totalDebt`.
- `src/components/mgmv-agreement-editor.tsx` (se editar campos do acordo).
- `applyMGMVPartialPayment` em `src/lib/store.ts` já muta parcelas — garantir que o wrapper que grava no store também setar `reviewStatus: "manually_reviewed"`.

Isso torna o "bloqueio" acima confiável para edições futuras, além dos heurísticos por parcela.

### 3. UI: aviso opcional no botão

No botão "Reprocessar MGMV por observações" (seção MGMV), após rodar, mostrar toast com contagem: "X acordos atualizados, Y ignorados (edição manual / IA preservada)". Sem modal novo — apenas melhorar a mensagem existente.

## Fora do escopo

- Não alterar o parser `extractMGMVAgreementFromNotes`.
- Não mexer no fluxo de import em si (auto-reprocess continua rodando; só passa a respeitar bloqueio).
- Não adicionar opção "forçar reprocesso" agora — se quiser depois, adicionamos um segundo botão "Reprocessar forçado" que ignora o bloqueio.

## Arquivos afetados

- `src/lib/mgmv-reprocess.ts` (lógica principal + retorno com `{updated, skipped}`)
- `src/sections/mgmv-section.tsx` (toast do botão)
- `src/sections/clientes-section.tsx`, `src/sections/mgmv-section.tsx`, `src/components/mgmv-agreement-editor.tsx`, `src/lib/store.ts` (marcar `manually_reviewed` nas edições)
