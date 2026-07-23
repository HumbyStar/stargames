## Entendimento
Na importação em lista/TXT, uma reserva nunca pode ficar com `data limite` igual à `data de cadastro`. Para qualquer item com status `Reserva`, o limite deve ser sempre `cadastro + 30 dias`, para permitir cobrança depois de 30 dias.

## O que encontrei
- O modal novo de lista (`ListImportModal`) já calcula `+30 dias` para `Reserva` no caminho principal.
- Ainda existe outro fluxo de importação TXT/manual em `src/sections/import-section.tsx` que monta linhas com `dueDate: null` e, em alguns casos, reutiliza `r.dueDate` sem forçar novamente a regra.
- Como há mais de um caminho salvando produtos, a correção precisa ficar em uma função comum/defensiva na hora de confirmar a importação, não só na prévia.

## Plano de correção
1. Criar/usar um helper local para vencimento de importação que receba `status`, `registerDate` e `dueDate` informado.
2. Para `Reserva`, ignorar qualquer `dueDate` vazio, igual ao cadastro ou menor/igual ao cadastro, e gravar obrigatoriamente `registerDate + 30 dias`.
3. Aplicar essa regra nos pontos de confirmação que chamam `addProduct` nos fluxos de lista/TXT/CSV/Excel/HTML dentro de `import-section.tsx` e manter a regra já existente no `list-import-modal.tsx` alinhada.
4. Adicionar teste cobrindo o caso: cadastro `17/07/2026` + status `Reserva` → limite `17/08/2026`, garantindo que nunca fique `17/07/2026`.
5. Verificar com teste seletivo do parser/importação para confirmar que a regra não quebrou `Pago`/`Pendente`.