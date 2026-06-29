## Gerenciamento de Acesso (RBAC) com criação de usuários

Adicionar, em Configurações → Segurança e Acesso, um painel completo para criar contas (e‑mail + senha), atribuir papéis com permissões por página/função e validar o login desses usuários. Cada usuário pode trocar a própria senha depois.

### 1. Modelo de dados (Lovable Cloud)

Tudo em uma migration:

- `app_role` enum: `admin`, `manager`, `operator`, `viewer`.
- `app_permission` enum (chaves de UI/feature): `dashboard.view`, `clientes.view`, `clientes.edit`, `collection.view`, `collection.edit`, `mgmv.view`, `mgmv.edit`, `import.use`, `finance.view`, `settings.view`, `users.manage`.
- `public.user_roles(user_id, role)` — papéis por usuário (separado do `profiles`, evita escalonamento de privilégio).
- `public.role_permissions(role, permission)` — quais permissões cada papel concede. Pré‑populado: `admin` recebe todas; `manager` recebe tudo menos `users.manage` e `settings.view`; `operator` recebe `*.view` + `clientes.edit`, `collection.edit`, `import.use`; `viewer` recebe apenas `*.view`.
- Função `public.has_role(_user_id uuid, _role app_role)` (SECURITY DEFINER, stable) — evita recursão de RLS.
- Função `public.has_permission(_user_id uuid, _permission app_permission)` (SECURITY DEFINER, stable) — `JOIN user_roles ↔ role_permissions`.
- RLS:
  - `user_roles`: SELECT permitido para o próprio usuário e para admins; INSERT/UPDATE/DELETE apenas admins.
  - `role_permissions`: SELECT para `authenticated`; mutações apenas admins.
- GRANTs explícitos (`authenticated`, `service_role`) em cada tabela.
- Promover o primeiro usuário cadastrado a `admin` via insert pontual no `user_roles`, baseado no e‑mail informado pelo dono atual (a confirmar com você se quiser que eu já promova o seu usuário logado).

### 2. Server functions (TanStack `createServerFn`)

Arquivo `src/lib/admin-users.functions.ts`. Toda função usa `requireSupabaseAuth` e verifica `has_role(..., 'admin')` antes de qualquer ação. `supabaseAdmin` carregado dentro do handler via `await import('@/integrations/supabase/client.server')`.

- `listUsers()` → lista usuários via `supabaseAdmin.auth.admin.listUsers()`, junta com `profiles`, `user_roles`. Retorna DTO mínimo (id, email, criado em, último login, papéis).
- `createUser({ email, password, fullName, roles[] })` → valida com Zod (e‑mail, senha mín. 8 chars), cria via `auth.admin.createUser` com `email_confirm: true`, cria `profiles`, insere papéis em `user_roles`.
- `updateUserRoles({ userId, roles[] })` → substitui papéis (delete + insert em transação RPC).
- `resetUserPassword({ userId, newPassword })` → admin redefine senha de outro usuário.
- `deactivateUser({ userId })` / `reactivateUser` → `auth.admin.updateUserById` com `ban_duration`.
- `deleteUser({ userId })` → `auth.admin.deleteUser` (cascade em `profiles` e `user_roles`).
- `changeMyPassword({ currentPassword, newPassword })` → sem `supabaseAdmin`: usa o client autenticado para reautenticar e `auth.updateUser({ password })`.
- `listRolePermissions()` → para popular a matriz de permissões na UI.

### 3. Hook de permissões no cliente

`src/lib/use-permissions.ts`:

- Busca via TanStack Query as permissões efetivas do usuário logado (`role_permissions` + `user_roles` do próprio uid via RLS).
- Expõe `hasPermission(key)` e `hasAnyPermission([...])`.
- Carregado uma vez no `__root` e injetado em React Context para uso síncrono.

### 4. UI — Painel "Gerenciar Acesso"

Trocar o botão atual "Gerenciar usuários" por abrir um `Dialog` grande (`max-w-5xl`) com `Tabs`:

- **Aba Usuários**
  - Tabela: e‑mail, nome, papéis (badges), último login, status (ativo/banido), ações.
  - Botão "Novo usuário" → form: nome, e‑mail, senha (com gerador), seleção múltipla de papéis. Validação Zod inline.
  - Ações por linha: redefinir senha, editar papéis, ativar/desativar, excluir (com confirmação).
- **Aba Papéis e permissões**
  - Matriz papel × permissão (somente leitura na primeira versão para evitar quebrar admin; toggle de edição apenas para admins, persiste via `updateRolePermissions`).
- **Aba Minha conta**
  - Form "Alterar minha senha" (atual + nova + confirmação) usando `changeMyPassword`. Disponível para qualquer usuário logado.

Botão "Alterar senha administrativa" passa a abrir a aba "Minha conta".

### 5. Gating na aplicação

- Esconder/desabilitar itens da navbar e ações conforme permissões: Importar (`import.use`), Finanças (`finance.view`), Configurações (`settings.view`), Notificações sempre visíveis, MGMV (`mgmv.view`), etc.
- Em `_authenticated`, expor `permissions` via context; rotas internas e seções continuam SPA — gating é por permissão, não por rota nova.
- Botões dentro de seções (ex.: editar cobrança, aplicar IA) checam `hasPermission` antes de executar/mostrar.

### 6. Validação de login do novo usuário

- Como `createUser` usa `email_confirm: true`, o usuário criado já loga direto em `/auth` com a senha definida.
- O `onAuthStateChange` no `__root` invalida o cache de permissões em `SIGNED_IN`/`SIGNED_OUT`, refletindo papéis na sessão recém‑aberta.
- Em caso de senha incorreta, o feedback já existe na tela de auth atual.

### 7. Segurança

- Toda ação privilegiada exige `has_role(..., 'admin')` no handler — middleware `requireSupabaseAuth` não basta.
- Validação Zod em todos os inputs (senha ≥ 8 chars, e‑mail válido, papéis ∈ enum).
- Não logar senhas/PII; mensagens de erro genéricas no cliente.
- Audit log: aproveitar `audit_log` existente para registrar criação/alteração/exclusão de usuários via trigger nas tabelas `user_roles`.

### Detalhes técnicos resumidos

```text
src/
├── lib/
│   ├── admin-users.functions.ts        # createServerFn + requireSupabaseAuth
│   ├── permissions.functions.ts        # getMyPermissions()
│   └── use-permissions.ts              # hook + Context
├── components/
│   └── access-management.tsx           # Dialog Tabs Users/Roles/Account
└── sections/configuracoes-section.tsx  # abre o novo Dialog
```

### Perguntas antes de executar

1. Devo já promover **o seu usuário logado atual** a `admin` na migration (para você poder usar o painel imediatamente)? Se sim, me confirme o e‑mail.
2. Os 4 papéis sugeridos (`admin`, `manager`, `operator`, `viewer`) e a divisão de permissões acima funcionam, ou prefere outro conjunto?
3. Quer também a aba "Papéis e permissões" **editável** já nesta primeira entrega, ou começamos só com leitura para reduzir risco?