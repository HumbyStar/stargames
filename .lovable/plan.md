## Bug 02 — Editor completo do acordo MGMV

Hoje o acordo MGMV só permite ajustar `totalDebt` e o valor uniforme das parcelas via pincel na linha (`RowEditPencil` / `RowEditActions` em `src/sections/mgmv-section.tsx`). Não há como mudar quantidade de parcelas, redistribuir saldo após pagamento parcial, ou remover um produto do acordo. Esse plano fecha esses gaps sem introduzir modal — todos os controles ficam no painel de detalhes expansível ("Detalhes") que já existe.

### O que muda no painel de detalhes (linha expandida do acordo)

Novo bloco no topo do painel: **"Editar acordo"** (colapsado por padrão, botão "Editar acordo" abre inline). Enquanto aberto:

1. **Cabeçalho editável do acordo**
   - Nº de parcelas (input numérico, mín. 1, máx. 60).
   - Valor mínimo/reduzido da parcela (opcional — se preenchido, é usado como base; senão o sistema calcula).
   - Dia de vencimento das parcelas pendentes (mantém o dia atual como default).
   - Botão **Recalcular parcelas** — pega o saldo restante (`totalDebt - pago - parcial`) e distribui uniformemente pelas `N` parcelas pendentes, respeitando o piso mínimo se informado. Se o piso mínimo força `N` a crescer, o sistema aumenta o número de parcelas automaticamente e avisa via toast.
   - Prévia (read-only, tabular) do novo cronograma antes de confirmar.

2. **Lista de parcelas — edição por linha**
   - Cada parcela pendente vira editável: valor e vencimento. Parcela paga fica travada (mantém `paidAt`, `paidAmount`).
   - Ao alterar o valor de uma parcela individual, um badge "Personalizada" aparece; o botão "Recalcular parcelas" volta a distribuir uniformemente (limpa personalizações se o usuário confirmar).
   - Ação por linha: **Remover parcela** (só permitida em parcelas pendentes; recalcula total).
   - Ação global: **Adicionar parcela** (append no fim, valor = valor médio das pendentes, vencimento = última pendente + 1 mês via `addMonthsClampDay`).

3. **Produtos incluídos — remover do acordo**
   - Cada linha de produto ganha ação **Remover do MGMV** (ícone X). Confirmação inline (mini-popover "Remover?"). Efeito:
     - `updateProduct(id, { financialStatus: undefined })` — volta ao status financeiro anterior (default "Em Aberto").
     - Recalcula `totalDebt` sugerido = soma dos `(totalValue - paidValue)` dos produtos que continuam no acordo.
     - Mostra aviso "Total do acordo diverge da soma dos produtos" quando aplicável e oferece botão **Ajustar total para os produtos restantes**.

4. **Confirmação**
   - Botão **Salvar alterações** grava tudo de uma vez via `setMGMVAgreement`, preservando `startDate`, parcelas pagas (com `paidAt`, `paidAmount`), e `reviewStatus` (se soma bate → mantém/`none`; se não bate → `review_required`).
   - Botão **Cancelar** descarta o rascunho local (nenhum estado persistido).

### Regras de recálculo (função pura nova em `src/lib/mgmv-schedule.ts`)

Adicionar `rebalanceAgreement(current, opts)`:

- `opts.targetInstallmentsCount` (opcional) — nova quantidade total de parcelas.
- `opts.minInstallmentValue` (opcional) — piso da parcela pendente.
- `opts.newProductsRemainingTotal` (opcional) — quando total do acordo é ajustado por remoção de produto.
- Mantém intactas as parcelas pagas (número, `paidAt`, `paidAmount`, `dueDate`).
- Calcula `remaining = totalDebt - paidValue - partialPaidAmount`.
- Se `minInstallmentValue` for informado e `remaining / N < min`, aumenta N até `ceil(remaining / min)` e emite flag `bumpedInstallments`.
- Preserva o dia de vencimento (usa `addMonthsClampDay` a partir da última paga ou `startDate`).
- Retorna `MGMVAgreement` novo + metadata para o toast.

Cobre a redistribuição do exemplo do bug (5×100 com pagamento parcial de R$ 50 → 10×50).

### Store / persistência

- Nenhuma mudança de schema. Continua tudo via `setMGMVAgreement(clientId, agreement)` (já sincroniza com Supabase em `db-sync.ts`).
- `updateProduct(id, { financialStatus: undefined })` (já existe) cobre a remoção do produto do MGMV.

### Testes

- Adicionar `src/lib/mgmv-schedule.test.ts`:
  - Redistribui saldo restante uniformemente entre parcelas pendentes.
  - Piso mínimo aumenta a contagem de parcelas quando necessário (exemplo do bug: 5×100 com 1 parcial de 50 → 10×50).
  - Preserva parcelas pagas (paidAt, paidAmount, dueDate).
  - Ajusta total do acordo quando um produto é removido.
- Rodar suite existente para garantir zero regressão.

### Fora do escopo

- Nenhum modal novo.
- Sem mudanças na UI de criação de MGMV (`mgmv-create-modal.tsx`).
- Sem mudanças no fluxo de revisão IA / import.
- Sem mudanças na sessão de Clientes.

### Arquivos afetados

- `src/lib/mgmv-schedule.ts` — nova função `rebalanceAgreement`.
- `src/lib/mgmv-schedule.test.ts` — novo.
- `src/sections/mgmv-section.tsx` — novo bloco "Editar acordo" no painel expansível; ações Remover parcela / Adicionar parcela / Remover produto do MGMV; substituição do pincel inline atual pelo novo painel (mantém pincel só para edição rápida de total, ou remove — decisão: **manter** o pincel atual para edição rápida em uma linha e usar o painel expandido para edição completa).
