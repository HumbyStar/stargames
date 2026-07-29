## Objetivo

Três ajustes na feature "Gerar Formato NF":
1. Remover o prefixo `Cliente:` do cabeçalho — mostrar só o nome.
2. Trocar o botão **Copiar** por **Confirmar Nota** no modal de geração — a ação passa a salvar a nota no histórico (sem copiar).
3. Novo botão **Notas Fiscais** ao lado de **Abrir Ficha do Cliente** no card do cliente, que abre um modal com o histórico de NFs geradas para aquele cliente. Só nesse histórico existe o botão **Copiar** (por nota).

---

## Mudanças

### 1. Cabeçalho sem "Cliente:"
- `src/lib/nf-format.ts` → `buildFiscalHeader`: primeira linha vira apenas `f.fullName` (sem `"Cliente: "`).
- `src/lib/nf-format.test.ts`: atualizar o snapshot/asserção que verifica a primeira linha.

### 2. Persistência do histórico de NFs

Nova tabela `public.nf_invoices` (Lovable Cloud):

```text
id uuid pk
client_id uuid fk → clients(id) on delete cascade
generated_by uuid null (auth.uid())
content text not null          -- texto final da NF (editado no modal)
total_cents integer not null   -- soma dos lotes
product_ids text[] not null    -- ids dos produtos incluídos
created_at timestamptz default now()
```

- GRANTs para `authenticated` (SELECT/INSERT/DELETE) e `service_role` (ALL); sem `anon`.
- RLS: `authenticated` pode ler/inserir/deletar qualquer linha (mesmo padrão das outras tabelas internas do sistema — usuários internos operam sobre todos os clientes).
- Índice em `(client_id, created_at desc)` para o histórico.

Camada de acesso:
- Novo `src/lib/nf-history.functions.ts` com server functions autenticadas:
  - `saveNfInvoice({ clientId, content, totalCents, productIds })`
  - `listNfInvoices({ clientId })`
  - `deleteNfInvoice({ id })`

### 3. `nf-format-modal.tsx` — Confirmar Nota
- Trocar o botão `Copiar` por `Confirmar Nota` (ícone check).
- Ao confirmar: calcular `total_cents` a partir dos `groups` já montados, chamar `saveNfInvoice`, mostrar toast de sucesso e fechar o modal. Não copiar para o clipboard.
- Manter o textarea editável — o texto salvo é o que estiver na hora do clique.

### 4. Novo modal de histórico
- `src/components/nf-history-modal.tsx`:
  - Lista as NFs do cliente (mais recentes primeiro): data/hora, total formatado, quantidade de produtos e prévia (primeiras linhas).
  - Cada item: botão **Copiar** (copia o `content` para o clipboard, toast) e **Excluir** (com confirmação leve).
  - Estado vazio: "Nenhuma nota fiscal gerada ainda."
  - Usa `useServerFn` para as três funções acima; refetch após confirmar/excluir.

### 5. Integração no card do cliente
- `src/sections/clientes-section.tsx`: ao lado do botão **Abrir Ficha do Cliente / Preencher Dados do Cliente**, adicionar botão **Notas Fiscais** (ícone `FileText` ou `Receipt`).
  - Sempre visível para o cliente (mesmo sem ficha) — abre o `NfHistoryModal` daquele cliente.
  - Estado local `nfHistoryClient` no mesmo padrão dos outros modais da seção.

---

## Detalhes técnicos

- Tabela nova → seguir estrutura de migração padrão (CREATE TABLE → GRANTs → ENABLE RLS → POLICIES) em uma única `supabase--migration`.
- Após migração aprovada, os `Database` types são regenerados; só então implementar `nf-history.functions.ts` e componentes.
- `total_cents` calculado no cliente a partir de `groups.reduce((s,g)=>s+g.subtotal,0)` * 100 arredondado — evita drift de ponto flutuante ao reexibir.
- Nenhuma mudança em `customer-data-modal.tsx`, `ficha-parse.ts` ou nas outras seções.
- Nenhuma quebra na Feature I (ficha) ou no restante do fluxo NF — só o rótulo/ação do botão final muda e o cabeçalho perde o prefixo.
