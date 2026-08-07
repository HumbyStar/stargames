# Pré-visualização em tabelas de cliente na Importação Assistida com IA

Hoje o modal mostra apenas uma tabela plana de linhas (uma linha por produto), sem agrupar por cliente. O objetivo é mostrar, antes de confirmar, exatamente o que vai subir — cada cliente com seus produtos atrelados, no mesmo formato das tabelas de clientes da onepage — e, ao confirmar, exibir um toast de carregamento que só vira "sucesso" quando os dados já estão visíveis no sistema, sem recarregar a página.

## O que muda

### 1. Nova visão "Por cliente" na pré-visualização
- Duas abas dentro da pré-visualização: **Por cliente** (padrão) e **Linhas** (a tabela atual, mantida intacta para edição/IA).
- Na visão Por cliente, um cartão/linha por cliente com:
  - nome, telefone (canônico), badge "Novo cliente" ou "Já existe" (match por telefone),
  - contagem de produtos, total, pago e restante,
  - badge de duplicidade quando aplicável.
- Cada cliente expande (accordion) mostrando a tabela dos produtos atrelados com as mesmas colunas do histórico de produtos da onepage: Produto, Plataforma, Total, Pago, Restante, Status, Situação, Data limite.
- As cores de fundo por status reutilizam `src/lib/status-tone.ts` (Pago verde, Reserva laranja/amarelo, Pendente vermelho, encerrados neutros), com a mesma legenda de status usada nas outras telas.
- Ações já existentes (editar linha, revisar com IA, ignorar) ficam disponíveis também nas linhas de produto dentro do cliente.
- Os filtros de status/grupo já existentes passam a filtrar as duas visões; o rodapé continua indicando quantos registros serão importados.

### 2. Toast de carregamento e chegada em tempo real
- Ao confirmar, abre um toast persistente "Importando… salvando no banco / confirmando exibição", atualizado por etapa.
- O toast só vira sucesso depois da confirmação de gravação e da confirmação de exibição já existentes; se falhar, vira toast de erro e o modal segue aberto.
- Após confirmar, os clientes e produtos criados entram no estado local e são reconciliados por leitura direcionada, aparecendo na onepage e no modal do cliente sem F5.
- No fim, um atalho "Ver clientes importados" leva à lista de clientes já filtrada pelos que acabaram de subir.

## Detalhes técnicos

- `src/lib/list-import-parser.ts`: estender `ListImportClientGroup` (ou adicionar um builder auxiliar) para expor as linhas completas por cliente e o telefone canônico, evitando recomputar no componente.
- `src/components/list-import-modal.tsx`:
  - novo subcomponente de pré-visualização agrupada em arquivo próprio (`src/components/list-import-client-preview.tsx`), para não engordar o modal;
  - marcação "novo/existente" via `findClientByPhone(canonicalPhone(...))` do store;
  - toast com `toast.loading` + `toast.success`/`toast.error` reutilizando o mesmo `id`.
- Fluxo em tempo real: manter `flushAllPendingUpserts` → `awaitPendingWrites` → `waitForRowConfirmation` → `waitUntilVisibleInStore`, e chamar `useStore.getState().refreshClientData` para os clientes tocados ao final, garantindo que o drawer do cliente já abra com os produtos.
- Sem mudanças de schema no banco.