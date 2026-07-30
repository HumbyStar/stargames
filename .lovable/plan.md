## Objetivo

Três entregas independentes:
1. **Modo de validação** — executar a restauração de um backup no sandbox e produzir um relatório de diferenças, sem tocar na produção.
2. **Error Boundary global** — tela amigável com botão de recarregar quando o app quebrar (inclusive em loop de render).
3. **Auditoria de importações do sandbox** — registro de cada importação/restauração feita em teste, com garantia verificável de que nada foi gravado na produção.

---

## 1. Modo de validação (dry-run + relatório de diferenças)

O restaurador já decide o ambiente no servidor (`resolveTargetEnv`) e já regenera IDs no sandbox. Falta um caminho de "validar sem aplicar" e um comparativo antes/depois.

**Backend (`src/lib/backup.functions.ts`)**
- Nova server fn `validateBackupRestore` (admin, mesma entrada de `restoreBackup` + `tables`), que:
  - exige sandbox ativo; se o usuário estiver em produção, recusa com mensagem clara ("entre no Modo Teste para validar").
  - lê o ZIP e monta, por tabela: linhas no backup, linhas hoje no sandbox, quantas seriam inseridas, atualizadas, ignoradas e removidas (no modo replace).
  - compara os indicadores de negócio (clientes, produtos, acordos, parcelas pendentes, NFs, a receber, inadimplência, recebido) entre "sandbox atual" e "sandbox projetado após restauração", reaproveitando o resumo de negócio já existente.
  - lista problemas detectados: FKs órfãs (produto sem cliente, parcela sem acordo), IDs duplicados no ZIP, colunas do ZIP que não existem na tabela, tabelas globais ignoradas em teste.
  - **não escreve nada**: nenhuma operação de escrita no caminho de validação; a decisão de ambiente continua exclusivamente no servidor.
- Opcional dentro do mesmo fluxo: "validar aplicando no sandbox" — usa o `restoreBackup` normal (já isolado) e depois gera o mesmo relatório com números reais pós-restauração.

**UI (`src/components/restore-backup-modal.tsx`)**
- Nova etapa "Validação" entre *preview* e *aplicar*: botão **Validar no sandbox (não aplica)**.
- Relatório em cards no padrão visual da OnePage: badge de destino, tabela por entidade (backup / atual / projetado / delta), bloco de alertas e um selo verde "Produção intacta — nenhuma escrita realizada".
- Botão para exportar o relatório em JSON.
- Em produção o botão de validação aparece desabilitado com a explicação.

---

## 2. Error Boundary global

Hoje só existe o `errorComponent` do TanStack, que não captura erros de render dentro da árvore de componentes (ex.: "Maximum update depth exceeded" no `AppLayout`).

- Novo `src/components/global-error-boundary.tsx`: class component com `componentDidCatch`, que reporta via `reportLovableError` e renderiza uma tela amigável em português: título, explicação simples, botões **Recarregar página** e **Voltar ao início**, e um bloco recolhível com o detalhe técnico do erro.
- Detecção específica de loop de render: se a mensagem contiver "Maximum update depth", a mensagem sugere recarregar e informa que o estado local será limpo.
- Montado em `src/routes/__root.tsx`, envolvendo o `<Outlet />` dentro do `QueryClientProvider`, com `key` reiniciável para permitir "tentar novamente" sem reload completo.
- No reload, limpa chaves de UI persistidas que possam estar causando o loop (mantendo sessão e dados).

---

## 3. Auditoria de importações do sandbox

- **Migração**: nova tabela `public.sandbox_import_audit` com usuário, tipo de origem (backup salvo / upload / lista / ZIP), nome do arquivo, modo (merge/replace/validação), tabelas afetadas, contagens por tabela, duração, resultado e uma verificação de segurança (`production_untouched`). Grants + RLS: cada usuário vê os próprios registros, admins veem tudo; ninguém edita ou apaga.
- **Registro**: `restoreBackup` e a nova `validateBackupRestore` gravam nessa tabela; os demais importadores (lista TXT, ZIP) também registram quando o usuário estiver em Modo Teste.
- **Garantia de não-escrita em produção**: antes e depois da operação em sandbox, contam-se as linhas de produção das tabelas envolvidas; se algum número mudar, o registro é marcado como falha de isolamento e a UI mostra alerta em vermelho. Em caminho normal isso confirma "produção inalterada".
- **UI**: nova aba/card em Configurações → Modo Teste com o histórico de importações do sandbox (data, origem, modo, linhas, duração, selo de isolamento) e detalhe expandível por execução.

---

## Detalhes técnicos

- Backend em `createServerFn` com `requireSupabaseAuth` + checagem de admin, seguindo o padrão do arquivo atual; `supabaseAdmin` importado dentro do handler.
- O ambiente-alvo continua resolvido no servidor via `sandbox_state`; o navegador nunca envia o ambiente.
- O relatório de diferenças reaproveita `BusinessSummary`, `fetchAllRows`, `CLONE_ORDER` e `ENV_SCOPED_TABLES` já existentes — sem duplicar regra de negócio.
- Nenhuma alteração no cálculo financeiro existente.

## Arquivos afetados

- `src/lib/backup.functions.ts` (validação + auditoria)
- `src/components/restore-backup-modal.tsx` (etapa de validação e relatório)
- `src/components/global-error-boundary.tsx` (novo)
- `src/routes/__root.tsx` (montar o boundary)
- `src/components/sandbox-settings-card.tsx` (histórico de auditoria)
- Migração de banco para `sandbox_import_audit`
