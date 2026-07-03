# Plano — Fluxo Abandonou → Retirar → Retirado + Edição por lápis

## 1. Unificação Desistiu → Abandonou (UI apenas)

Mantém `"Desistiu"` no union type `Situation` em `src/lib/store.ts` para não quebrar dados persistidos. A UI para de oferecer o valor e passa a exibi-lo como `Abandonou`.

**`src/sections/clientes-section.tsx`:**
- Remover o botão `Desistiu` (linhas 1043–1049) e o chip `desistiu` (linhas 189, 275).
- Fundir o chip `abandonou` para casar com `Desistiu OR Abandonou`.
- Remover `<option>Desistiu</option>` dos selects (linhas 445, 1306).
- No `<Tag>{p.situation}</Tag>` (linha 1013), aplicar helper `displaySituation(p.situation)` que converte `"Desistiu"` → `"Abandonou"`.

**`src/lib/situation-normalizer.ts`:** a regra `removido` que hoje captura `^desistiu` passa a produzir `situation: "Abandonou"` (em vez de `Removido`); remover as normalizações que apontavam para `Desistiu`. Ajustar `src/lib/situation-normalizer.test.ts` no que quebrar.

**`src/lib/store.ts`:** manter `Desistiu` no union e nas funções `isResolvedSituation` (já cobre os dois casos). Adicionar helper `displaySituation(s: Situation): Situation` que mapeia `Desistiu → Abandonou`, exportado para uso na UI.

## 2. Fluxo Abandonou → Retirar → Retirado (apenas Clientes)

Sem novas tabelas — reutiliza os valores existentes do union `Situation` (`Abandonou`, `Retirar`, `Retirado`). "Estoque central" hoje não é uma entidade separada no banco; portanto "voltar ao estoque" = remover o produto da lista ativa do cliente, mantendo o produto no histórico via novo flag `archivedAt` + `archivedReason: "retirado"`. Isso é escopo de UI/estado, sem migração.

**`src/lib/store.ts`** — pequenas extensões (mantidas retrocompatíveis):
- Campo opcional em `Product`: `archivedAt?: string`, `archivedReason?: "retirado"`, `abandonedAt?: string`, `pickupRequestedAt?: string`.
- `productCollectionStatus`: já classifica `Abandonou`, `Retirar`, `Retirado` como neutros — mantém "não cobrar" em Collection. Reforçar `isResolvedSituation` para `Retirar` também retornar `true` (hoje só resolve `Retirado`), garantindo que Collection não puxe produtos "pendentes de retirada".
- Novo action `archiveProductAsRetirado(productId, actor)` que faz o efeito final (marca `archivedAt`, mantém no histórico do cliente, remove da lista ativa via filtro nas seções — não deletar).
- Nas seções (Clientes/Collection), filtrar a lista ativa por `!p.archivedAt`; o histórico do cliente (drawer) continua exibindo tudo, ordenado por data.

**`src/sections/clientes-section.tsx`** — botões por linha (área "Ações"):
- Produto em aberto: mostrar `Abandonou`.
- Produto com `situation === "Abandonou"`: exibir badge "Aguardando retirada" e botão `Retirar` (abre confirmação inline simples — "Marcar produto para retirada?" com Cancelar / Confirmar retirada).
- Produto com `situation === "Retirar"`: exibir badge "Pendente de retirada" e botão `Retirado`.
- Produto com `situation === "Retirado"` e `archivedAt` presente: some da lista ativa; aparece no histórico do drawer com timestamps.

Cada transição chama `setProductSituation` e grava `abandonedAt`/`pickupRequestedAt`/`archivedAt` conforme etapa; toasts explicativos.

## 3. Popup central obrigatório para Retirado

Novo componente `src/components/retirado-confirm-modal.tsx` usando `Dialog` do shadcn:
- Título: `Confirmar produto retirado?`
- Mensagem exigida no spec.
- Blocos com: nome do cliente, produto, plataforma, valor, situação atual e o aviso "voltará para o estoque central".
- Configurar `<Dialog onOpenChange>` para **não** fechar em clique fora nem em Esc: no `DialogContent`, `onPointerDownOutside={(e) => e.preventDefault()}`, `onEscapeKeyDown={(e) => e.preventDefault()}`, `onInteractOutside={(e) => e.preventDefault()}`. O X do header do modal (se existir) fecha sem confirmar.
- Botões `Cancelar` (fecha sem alterar) e `Confirmar como retirado` (executa `archiveProductAsRetirado` + audit log).
- Só o handler do botão principal dispara a ação e o log final.

Integração no `clientes-section.tsx`: `useState<{ product, client } | null>` para o modal; o botão `Retirado` da linha apenas abre esse modal — nunca aplica a transição direto.

## 4. Collection e MGMV

- **Collection** (`src/sections/collection-section.tsx`): já usa `productCollectionStatus`/`isOpenSituation`. Após incluir `Retirar` em `isResolvedSituation`, `Abandonou`/`Retirar`/`Retirado` deixam de aparecer como cobrança ativa. Nenhuma outra mudança.
- **MGMV** (`src/sections/mgmv-section.tsx`): não mostra Retirar/Retirado. Ajustar apenas rótulos de situação exibida via `displaySituation` (converte `Desistiu → Abandonou`).

## 5. Audit log

O projeto já tem trigger `audit_change` em várias tabelas. Como as ações Abandonou/Retirar/Retirado chamam `updateProduct`/`setProductSituation` (que persistem em `public.products`), o audit já registra automaticamente `old_data` → `new_data`. Nenhuma migração é necessária — apenas garantir que cada transição atualiza colunas persistidas (`situation`, `archived_at` etc.) via as actions da store (que sincronizam com o banco). Popup cancelado ⇒ nenhum update ⇒ nenhum log.

## 6. Edição por lápis nas tabelas operacionais

Novo hook e componente compartilhado:

**`src/lib/use-row-edit.ts`** — hook genérico:
```ts
useRowEdit<T>() → {
  editingRowId, draftValues, originalValues, hasUnsavedChanges,
  startEdit(id, values), setField(k, v), confirm(onSave), close()
}
```
Regras:
- `startEdit` bloqueia troca de linha se `editingRowId != null && hasUnsavedChanges` — toast "Existe uma edição pendente. Confirme ou feche antes de editar outra linha."
- `setField` só altera `draftValues`.
- `confirm` valida (Zod schema por tabela) → chama callback `onSave(draft)` → limpa estado.
- `close` descarta draft, restaura original.
- Clique fora: **não** faz nada (nem cancela nem salva).

**`src/components/row-edit-controls.tsx`** — botões `Confirmar` (ícone check) + `Fechar` (ícone X) reutilizáveis, além do ícone de lápis (`Pencil` do lucide) para acionar a edição.

**Tabelas afetadas** (aplicar padrão em cada uma):
- Clientes (`clientes-section.tsx` — tabela principal): editar nome, telefone, e-mail, pasta.
- Produtos do cliente (mesma seção, drawer): editar nome, plataforma, total, pago, situação (respeitando fluxo), data limite. Recalcular `financialStatus` no `confirm` conforme spec (`Pendente/Reserva/Pago`).
- Collection (`collection-section.tsx`): editar valor pago, nota, próxima data.
- MGMV (`mgmv-section.tsx`): editar campos permitidos apenas; se a edição gerar inconsistência (soma parcelas ≠ total, etc.), marcar `reviewStatus = "review_required"` em vez de bloquear, e toast informando.
- Parcelas MGMV: editar valor/vencimento por parcela; travar campos que quebrariam o acordo consolidado.
- Preview de importação (`import-section.tsx`): editar linhas antes de confirmar (já existe fluxo de edição — apenas garantir que segue o mesmo padrão de "só salva no Confirmar").

**Fora do escopo do lápis:** históricos, audit_log, campos `id/created_at/updated_at/import_batch_id/source_file/raw_import_data` e derivados (renderizados como texto somente leitura no modo edição).

**Validações no `confirm`** (Zod schemas em `src/lib/row-edit-schemas.ts`):
- Cliente: `name` obrigatório, `phone` regex simples, `email` opcional válido.
- Produto: `name` obrigatório, `platform` obrigatória, `totalValue > 0`, `paidValue ≤ totalValue`, `situation` válida.
- Financeiro: recalcular via helper existente `calculateFinancialStatus`.
- MGMV: bloquear alterações que reduzam `paidValue` abaixo do já pago ou quebrem `installments.length`.

## 7. Testes

Adicionar/atualizar:
- `src/lib/situation-normalizer.test.ts` — `desistiu` normaliza para `Abandonou`.
- `src/lib/store.test.ts` — `isResolvedSituation` inclui `Retirar`; helper `displaySituation` mapeia `Desistiu→Abandonou`.
- Novo `src/lib/use-row-edit.test.ts` — bloqueia troca com pendente, `close` descarta, `confirm` valida e salva.
- Novo `src/components/retirado-confirm-modal.test.tsx` — clique fora / Esc **não** confirmam; só `Confirmar como retirado` chama o handler.
- Novo `src/sections/clientes-section.retirar-flow.test.tsx` — fluxo Abandonou → Retirar → Retirado (popup) → produto sai da lista ativa mas continua no histórico do drawer.

## Arquivos

- `src/lib/store.ts` — extensões de `Product`, `displaySituation`, `archiveProductAsRetirado`, `isResolvedSituation` inclui `Retirar`.
- `src/lib/situation-normalizer.ts` + `.test.ts` — remapear para `Abandonou`.
- `src/sections/clientes-section.tsx` — botões, chips, selects, badges, integração do modal e do lápis.
- `src/sections/collection-section.tsx` — herda o filtro; adicionar lápis.
- `src/sections/mgmv-section.tsx` — `displaySituation` + lápis.
- `src/sections/import-section.tsx` — padronizar edição de linha.
- `src/components/retirado-confirm-modal.tsx` — novo.
- `src/components/row-edit-controls.tsx` — novo.
- `src/lib/use-row-edit.ts` + `.test.ts` — novo.
- `src/lib/row-edit-schemas.ts` — novo.
- Testes novos listados acima.

## Fora do escopo

- Migração de dados históricos `Desistiu → Abandonou` (mantido sinônimo em runtime).
- Criação de tabela `estoque_central` — usar `archivedAt`/`archivedReason` no produto existente.
- Alterações em Dashboard, layout geral, notificações, importação MGMV ou concierge.
