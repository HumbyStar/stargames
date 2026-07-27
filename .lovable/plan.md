# Plano: Dados Completos do Cliente

## Entendimento do pedido
A especificação enviada solicita um novo botão na ficha do cliente chamado **"Preencher Dados do Cliente"**. Ao clicar, abre um modal com um campo de texto livre (textarea) onde o usuário pode colar/digitar informações completas do cliente, seguindo um padrão como:

```text
Nome: ...
CPF: ...
Endereço: ...
Número: ...
CEP: ...
Complemento: ...
```

Regras importantes:
- O botão fica ao lado dos botões existentes na ficha do cliente (Editar Cliente, Adicionar Produto, etc.).
- As informações são salvas e podem ser editadas posteriormente.
- O conteúdo permanece vinculado à ficha do cliente.
- Não substitui os dados principais (nome e telefone) do cliente.
- O campo é de texto livre; não há validação estruturada obrigatória.

## Alterações propostas

### 1. Banco de dados (Lovable Cloud)
Criar migration para adicionar a coluna `customer_data` do tipo `text` na tabela `public.clients`:

```sql
ALTER TABLE public.clients ADD COLUMN customer_data text;

GRANT SELECT, INSERT, UPDATE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
```

Como a tabela `clients` já existe e já possui GRANTs, a migration será pequena e incremental.

### 2. Tipos e mapeamento
- **src/lib/store.ts**: adicionar `customerData?: string` à interface `Client`.
- **src/lib/db-sync.ts**: adicionar `customer_data` ao tipo `DbClientRow` e aos mapeamentos `rowToClient` / `clientToRow`.
- **src/integrations/supabase/types.ts**: incluir `customer_data` na tabela `clients` (se a plataforma não regenerar automaticamente após a migration).

### 3. UI — Ficha do cliente
Em **src/sections/clientes-section.tsx**, no componente `ClientDrawer`:
- Adicionar o botão **"Preencher Dados do Cliente"** ao lado dos botões existentes (Editar Cliente, Adicionar Produto, Criar acordo MGMV).
- Adicionar estado local `customerDataModalOpen` e `customerDataText`.
- Abrir um modal com textarea quando o botão for clicado.
- Ao salvar, chamar `updateClient(client.id, { customerData: customerDataText.trim() || undefined })`.
- Exibir toast de sucesso.

### 4. Componente de modal (novo arquivo)
Criar **src/components/customer-data-modal.tsx** para manter o modal separado e reutilizável, com:
- Props: `open`, `onClose`, `onSave`, `initialValue`.
- Textarea com altura generosa (ex.: `min-h-[240px]`).
- Botões "Cancelar" e "Salvar Dados".
- Placeholder sugerindo o formato padrão (Nome, CPF, Endereço, Número, CEP, Complemento).

### 5. Integração na seção
Incluir `<CustomerDataModal />` no `ClientesSection`, controlado pelo estado local, e passar os callbacks corretos.

### 6. Verificação e testes
- Verificar build/typecheck após as alterações.
- Validar no preview que:
  - O botão aparece na ficha do cliente.
  - O modal abre com textarea.
  - Salvar persiste o texto e recarrega ao reabrir.
  - Nome e telefone do cliente não são alterados.
- Adicionar teste simples em `src/lib/store.test.ts` para garantir que `customerData` pode ser salvo e lido de volta via `updateClient`.

## O que não será alterado
- Nome, telefone, observações e demais campos do cliente permanecem inalterados.
- Não haverá parsing automático de CPF, endereço, etc. — o campo é texto livre.
- Não altera o fluxo de importação de clientes; o campo começa vazio para clientes existentes.