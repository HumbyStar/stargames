
## Objetivo

1. Permitir restaurar dados a partir de um `.zip` de backup direto pela tela de Configurações (sem sair do sistema).
2. Mostrar em cada backup um **resumo de negócio** (clientes, MGMV, produtos, pendências, financeiro) para que você compare rapidamente se os números do backup batem com a realidade atual antes de restaurar.

---

## Parte 1 — Resumo de negócio no backup

Hoje o `manifest.json` só guarda contagem bruta por tabela (`rowCounts`). Vamos adicionar um bloco `businessSummary` calculado no momento da geração.

### 1.1 `src/lib/backup.functions.ts` — enriquecer o backup
- Nova função `computeBusinessSummary(admin)` que roda em paralelo pequenas queries agregadas (usa dados já lidos do backup, sem custo extra):
  - `clients`: total, com ficha completa, sem ficha, com produtos ativos.
  - `products`: total, por `situation` (Em aberto, Enviado, Retirado, Cancelado etc.), por `financial_status` (Pago, Pendente, Parcial), com/sem NF emitida (via `nf_invoices.product_ids`).
  - `mgmv`: acordos ativos/concluídos/`needs_review`, parcelas pagas/pendentes/vencidas, valor total acordado, valor pago, saldo restante.
  - `financeiro`: total recebido, total a receber, inadimplência (parcelas MGMV vencidas + produtos pendentes com `due_date < now`).
  - `nf_invoices`: total emitido, valor total em centavos.
  - `team`: tarefas por status, batidas de ponto no mês.
- Escrever esse objeto em `manifest.json` e também em `summary.json` separado (útil para leitura rápida).
- Persistir o resumo como coluna nova `business_summary jsonb` em `public.system_backups` (migração).

### 1.2 Migração
```
ALTER TABLE public.system_backups ADD COLUMN business_summary jsonb NOT NULL DEFAULT '{}'::jsonb;
```
(sem novas policies; herda RLS existente).

### 1.3 UI — `src/components/backups-panel.tsx`
- Substituir a coluna "Arquivos" pesada por um botão **"Ver resumo"** por linha que abre um pequeno drawer/modal com os cards:
  - Clientes • MGMV • Produtos • Pendências • Financeiro • NFs.
- Mostrar comparação lado-a-lado com o **estado atual** (chama `getCurrentBusinessSummary`, uma nova server fn que roda a mesma agregação no banco vivo). Delta em verde/vermelho por métrica.
- Após "Gerar backup agora", abrir automaticamente esse resumo do backup recém-criado.

---

## Parte 2 — Importar via backup

### 2.1 Server function `restoreFromBackup`
Arquivo: `src/lib/backup-restore.functions.ts` (novo, client-safe wrapper `.functions.ts`).

- Entrada: `{ backupId?: string, uploadedZipBase64?: string, mode: "merge" | "replace", tables?: string[], includeStorage: boolean, dryRun: boolean }`.
  - `backupId`: restaura de um backup já existente no bucket `system-backups`.
  - `uploadedZipBase64`: usuário sobe um `.zip` externo (mesmo formato Star Games) — validado via `manifest.json`.
- Middleware: `requireSupabaseAuth` + `assertAdmin` (somente admin/admin_master).
- Fluxo:
  1. Baixar ZIP (do bucket ou do upload), abrir com `jszip`, validar `manifest.schemaVersion === 1`.
  2. **Dry-run**: só devolve `businessSummary` do backup + diff contra o banco atual, sem escrever nada. Sempre executado antes da confirmação.
  3. Restauração real:
     - `mode = "merge"`: `upsert` por PK em cada tabela (ordem de dependência já definida em `BACKUP_TABLES`).
     - `mode = "replace"`: `DELETE FROM` (em ordem reversa) e depois `insert` — protegido por confirmação com texto "REPLACE" digitado.
     - Filtro opcional por `tables[]` (permite restaurar só MGMV, só clientes, etc.).
     - `includeStorage`: reenvia arquivos de `storage/notion-html-originals/` via `supabaseAdmin.storage.upload(..., { upsert: true })`.
  4. Nunca toca em `auth.users`, `user_roles`, `profiles` do usuário logado (guarda contra lockout). Registrar `import_history` com `source = "backup-restore"`.
  5. Após sucesso, disparar `app:reset` (via server fn devolvendo flag, e o painel emite o CustomEvent no cliente) para o realtime recarregar todas as sessões sem F5.

### 2.2 UI — nova opção no card "Importação e Exportação"
Arquivo: `src/sections/configuracoes-section.tsx` (bloco linhas 871-916).

- Adicionar dois botões novos ao grid:
  - **"Importar via backup do sistema"** → abre modal `RestoreFromBackupModal` com lista dos backups existentes.
  - **"Importar ZIP externo"** → mesmo modal, aba "Upload".

### 2.3 Novo modal — `src/components/restore-backup-modal.tsx`
Fluxo em 3 passos:
1. **Origem**: escolher backup existente (dropdown com data/tamanho) ou fazer upload de `.zip`.
2. **Preview (dry-run)**: mostra `businessSummary` do backup e diff contra o banco atual (verde = ganho, vermelho = perda). Checkboxes de tabelas e toggle "Incluir arquivos originais (storage)". Toggle **Merge (upsert)** vs **Substituir tudo** (esse último exige digitar "REPLACE").
3. **Execução**: barra de progresso por tabela + log; ao terminar, botão "Ver resumo pós-restauração" que reabre o painel com os números atualizados.

---

## Detalhes técnicos

- **Compatibilidade retroativa**: backups antigos sem `businessSummary` seguem restauráveis; painel mostra "Resumo não disponível (backup gerado antes desta feature)".
- **Segurança**: toda a lógica de restauração roda em `createServerFn` com `supabaseAdmin` dentro do handler (nunca no bundle client). Upload de ZIP externo tem limite de 200 MB e valida checksum do `manifest.json` antes de aplicar.
- **Não altera**: parser Notion existente, importação por CSV/lista, esquema atual de tabelas.
- **Idempotência**: `upsert` por PK garante que restaurar duas vezes o mesmo backup não duplica dados.
- **Ordem de restauração**: mantém `BACKUP_TABLES` (independentes → dependentes). Em `replace`, deleta na ordem reversa.
