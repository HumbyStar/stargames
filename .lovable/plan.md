## Objetivo

Tornar todos os modais responsivos (mobile = full-screen, sem overflow horizontal, conteúdo empilhado) e reformatar o modal de **Configurações** em um layout operacional baseado em cards, com Importação/Dados e Usuários/Responsabilidades em destaque, cards secundários e diagnóstico rápido.

## Estratégia em camadas

Aplicar a correção no nível mais alto possível (componente base) e refinar caso a caso só onde o modal tem layout próprio.

### Camada 1 — Base `DialogContent` (resolve ~80% dos modais)

Arquivo: `src/components/ui/dialog.tsx`

Trocar o atual `max-w-lg max-h-[90vh]` por classes responsivas:

```text
mobile  (<768): inset-0, w-screen, h-[100dvh], max-w-none, rounded-none, p-4, overflow-y-auto, overflow-x-hidden, sem translate
sm/md   (≥768): comportamento atual centralizado, max-w-lg (override por className continua valendo), max-h-[90vh], rounded-lg
```

Implementação:
- Substituir as classes do `DialogPrimitive.Content` por um conjunto base que usa `max-sm:` para o full-screen e mantém o desktop intacto.
- `DialogHeader` ganha `sticky top-0 bg-background z-10 -mx-4 px-4 py-3 border-b max-sm:block sm:static sm:bg-transparent sm:border-0` para virar header sticky no mobile.
- `DialogFooter` ganha `sticky bottom-0 bg-background z-10 -mx-4 px-4 py-3 border-t max-sm:flex max-sm:flex-col` para virar barra de ação sticky no mobile, com botão principal `w-full`.
- Botão fechar (`DialogPrimitive.Close`) já existe; aumentar área para ≥44px (`p-2`) e manter no canto superior direito.

Resultado: todos os modais que usam `DialogContent` herdam o comportamento full-screen no mobile sem alterações individuais.

Mesma estratégia para `src/components/ui/alert-dialog.tsx` (`AlertDialogContent`) — mantém centralizado pequeno também no mobile, mas adiciona `max-w-[calc(100vw-2rem)]` e `max-h-[90dvh] overflow-y-auto` para nunca estourar.

### Camada 2 — Modais largos que sobrescrevem `max-w`

Ao usar `max-w-2xl/3xl/4xl/5xl/6xl` em `DialogContent`, o `sm:` do base é o que vale no desktop. No mobile o base já força full-screen porque usa `max-sm:`. Auditar e ajustar apenas grids internos que precisam empilhar:

- `src/components/dashboard-drilldown-modal.tsx` — qualquer `grid-cols-2/3/4` vira `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Tabela de detalhe vira lista de cards no mobile (`<table>` escondida `max-sm:hidden`, lista de cards `sm:hidden`).
- `src/components/list-import-modal.tsx` (max-w-6xl, preview de importação) — preview vira `grid-cols-1 lg:grid-cols-2`; tabela com `overflow-x-auto` no wrapper e `min-w-[640px]` apenas dentro do scroll.
- `src/components/mgmv-ai-review-modal.tsx` — colunas lado-a-lado empilham no mobile (`grid-cols-1 md:grid-cols-2`).
- `src/components/import-progress-modal.tsx` — métricas em `grid-cols-2 sm:grid-cols-4`.
- `src/sections/clientes-section.tsx` (detalhe do cliente, max-w 1200px) — header `grid-cols-[minmax(0,1fr)_auto]` no mobile; resumo + dados + ações empilhados; produtos viram cards no mobile.
- `src/components/concierge-modal.tsx` — listas de tarefas em cards de coluna única no mobile; remover paddings horizontais grandes.
- `src/components/concierge-task-confirm-modal.tsx`, `src/sections/equipe-section.tsx`, `src/sections/collection-section.tsx`, `src/sections/import-section.tsx` (preview/confirm), `src/components/team-punch.tsx`, `src/components/access-management.tsx` — auditoria pontual: grids para `grid-cols-1 sm:grid-cols-N`, botões de ação `w-full sm:w-auto`, qualquer tabela com wrapper `overflow-x-auto`.

Regra aplicada em todos: nada de `whitespace-nowrap` em títulos longos sem `truncate`, todo container de texto em flex/grid leva `min-w-0`, ícones `shrink-0`.

### Camada 3 — Novo modal de Configurações (operacional, com cards)

Arquivo: `src/sections/configuracoes-section.tsx` (rebuild da view dentro do modal; manter a API e os subcomponentes existentes — `NavbarSettingsCard`, `NotificationsPrefsCard`, `AccessManagement`, etc. — reusados como detalhes).

Estrutura nova (substitui a lista atual):

```text
[Header sticky]  Configurações
[Diagnóstico rápido]  badges de alertas (só aparece se houver algo)

[Cards principais — grid-cols-1 lg:grid-cols-2]
  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ Importação e Dados      │  │ Usuários e Resp.        │
  │ resumo: clientes, prod, │  │ resumo: ativos, admins, │
  │ última importação, cache│  │ sem responsabilidade    │
  │ [Abrir importação]      │  │ [Gerenciar usuários]    │
  │ [Limpar cache] [Diag.]  │  │ [Definir resp.] [Perm.] │
  └─────────────────────────┘  └─────────────────────────┘

[Cards secundários — grid-cols-1 sm:grid-cols-2 lg:grid-cols-3]
  Tema e aparência | Concierge Operacional | Cobrança e prazos
  MGMV             | Notificações          | WhatsApp manual
  Backup/Auditoria | Segurança             | Navbar

[Estado vazio quando sem alertas]
```

Cada card secundário: `ícone + título + descrição curta + status/resumo + ação principal`. Clicar no card abre um subpainel (drawer/aba interna no próprio modal) com o conteúdo atual já existente (ex.: tema continua reusando o toggle de tema; navbar reusa `NavbarSettingsCard`; usuários reusa `AccessManagement`; notificações reusa `NotificationsPrefsCard`).

Padrão de navegação interna do modal: state `view: 'home' | <cardId>` — `home` mostra os cards, qualquer card abre detalhe com breadcrumb e botão "Voltar". Mantém URL/rotas inalteradas.

Diagnóstico rápido: deriva dos dados já no store (`useStore`) e do hook `usePermissions` — calcular:
- preview temporário ativo? (flag em `useUiStore`/`store`)
- usuários sem responsabilidade (consulta a `profiles` via server fn já existente em `admin-users.functions.ts`, reusar)
- erros de importação pendentes (campo já exposto no estado)
- cache antigo (>7 dias)

Cada alerta vira chip clicável que abre o card correspondente já filtrado.

### Camada 4 — CSS utilitário

Em `src/styles.css`, adicionar utilitários só se necessário (preferir Tailwind):
- garantir que o `body { overflow: hidden }` continua, e que o conteúdo do modal usa `100dvh` em vez de `100vh` para evitar a barra do Safari mobile.

## Arquivos a editar

```text
src/components/ui/dialog.tsx                      (base responsiva — chave)
src/components/ui/alert-dialog.tsx                (base responsiva)
src/sections/configuracoes-section.tsx            (rebuild visual do modal)
src/sections/clientes-section.tsx                 (grids do detalhe)
src/sections/collection-section.tsx               (grids dos modais)
src/sections/equipe-section.tsx                   (3 modais)
src/sections/import-section.tsx                   (preview + confirm)
src/components/dashboard-drilldown-modal.tsx      (tabela→cards no mobile)
src/components/list-import-modal.tsx              (preview lado-a-lado)
src/components/mgmv-ai-review-modal.tsx           (colunas empilham)
src/components/import-progress-modal.tsx          (métricas)
src/components/concierge-modal.tsx                (listas)
src/components/concierge-task-confirm-modal.tsx   (grid de ações)
src/components/team-punch.tsx                     (campos)
src/components/access-management.tsx              (tabela de usuários)
```

Arquivos NÃO editados: store de dados, regras de MGMV/financeiro/importação/permissões, navbar, dashboard, parser de importação.

## Riscos e mitigações

- Sticky header/footer pode quebrar modais que rolam o body inteiro: usar `position: sticky` dentro de `overflow-y-auto` no `DialogContent`. Já é a estrutura padrão.
- `100dvh` em browsers antigos: fallback `100vh` via `min-h-[100vh] min-h-[100dvh]`.
- Cards de Configurações reusando subcomponentes pode mudar onde o usuário encontra cada opção; manter o nome dos cards próximo do que existia para não desorientar.

## Validação

- Playwright headless 390×800 abrindo cada modal: nenhum scroll horizontal, conteúdo empilhado, ações visíveis.
- Playwright 1280×900 para conferir que o desktop continua idêntico.
- Modo claro e escuro com snapshot do modal de Configurações.

## Critério de pronto

Atende os 15 itens da seção 22 do briefing: zero overflow horizontal mobile, modal de Configurações com cards (Importação/Dados e Usuários/Responsabilidades no topo), diagnóstico rápido funcional, desktop preservado, regras operacionais intactas.
