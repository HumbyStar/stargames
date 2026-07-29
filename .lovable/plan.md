## Diagnóstico

Os logs do servidor mostram o backup **rodando com sucesso** (05:18:52 → 05:19:33+, chegou a `zip:generate`) enquanto o cliente já tinha recebido `Internal server error` às 05:19:34. Ou seja, o processo em background continua vivo, mas a resposta HTTP inicial do `createBackupNow` estoura o tempo do Worker antes de responder. Causas encadeadas:

1. Em `createBackupNow` (`src/lib/backup.functions.ts`) o handler faz `if (!deferWithWorkerContext(started)) { await started; }`. Quando o runtime não expõe `waitUntil`, a request espera o backup inteiro (~40s+), e o Cloudflare/edge devolve 500 genérico — o `.catch` interno não impede porque o problema é do runtime, não do JS.
2. Mesmo com `waitUntil` disponível, a request única precisa fazer: `cleanupStaleBackups` + insert + `runBackup` (todas as tabelas + mirror + zip + upload). É pesado demais para caber com folga em uma invocação do Worker.
3. Quando o Worker morre no meio, a linha `pending/running` só é marcada como `failed` depois de 20 min por `cleanupStaleBackups`. Isso deixa o usuário sem retorno claro e obriga a começar do zero.

## Objetivo

- `createBackupNow` sempre responde rápido, mesmo sem `waitUntil`.
- Backup executa em passos idempotentes; se o Worker for morto no meio, a UI consegue **retomar** de onde parou sem recriar a linha.
- Log/erros exibidos no modal continuam detalhados e distinguem falha real de "worker recortado".

## Mudanças

### 1. `src/lib/backup.functions.ts`
- `createBackupNow`:
  - Continuar inserindo a linha `pending` e devolvendo `{ id, storagePath, queued: true }` **sem `await`** — se `deferWithWorkerContext` devolver `false`, disparar `runBackup(...).catch(...)` mesmo assim (fire-and-forget) e registrar um `debug_log` inicial dizendo `waitUntil unavailable`.
  - Adicionar guarda: se já existir backup `pending/running` recente do mesmo usuário, reutilizar a linha em vez de criar outra (evita duplicatas quando o usuário clica de novo).
- Nova server fn `resumeBackup({ id })`:
  - Admin-only, valida id, carrega a linha; se `status in ('pending','running')` **e** `updated_at` > `STALE_BACKUP_MS`, chama `runBackup({ existing })` novamente em background usando `deferWithWorkerContext` (mesmo padrão do create). Se estiver `completed/failed`, retorna estado atual sem reprocessar.
  - Retorna `{ id, status, queued }`.
- `runBackup`:
  - Persistir `updated_at` a cada passo (já usa `persistBackupDebug` com patch — garantir que sempre inclua `debug_log`, mesmo em `pending`, pra a UI ver progresso).
  - Ao começar, checar se `debug_log` já tem entradas por tabela concluída e **pular** essas tabelas (idempotência simples). Para tabelas já exportadas em run anterior morto, buscar de novo é aceitável porque o resultado é o mesmo — mas pular tabelas já registradas encurta o tempo do resume.
  - Encurtar `STALE_BACKUP_MS` para 5 min (o suficiente para uma retomada normal) e usar essa mesma constante em `cleanupStaleBackups` e no `resumeBackup` para decidir "está travado".
- Melhorar `error_details` quando o erro vem do runtime: se `runBackup` sair via `throw`, incluir `phase` real do último passo. Sem mudança de schema.

### 2. `src/components/backups-panel.tsx`
- Após `create()`, iniciar poll a cada 3s buscando a linha por `activeBackupId` (já faz). Adições:
  - Se a linha ficar `pending/running` sem novos entries no `debugLog` por **>30s**, chamar `resumeBackup({ id })` automaticamente uma vez, logando toast discreto "Retomando backup…".
  - Botão manual "Retomar" ao lado de cada linha `pending/running` (admins) que chama `resumeBackup`.
  - Ajustar o fluxo de erro imediato: se `create()` lançar mas o servidor tiver criado a linha, tentar `list()` e, se houver linha `pending` do mesmo usuário, mudar do "erro-imediato" para poll normal + auto-resume em vez de abrir o modal de falha.

### 3. Sem mudanças em schema
- Colunas usadas (`debug_log`, `error_details`, `updated_at`) já existem.
- Nada muda em RLS, permissões, rotas públicas ou cron.

## Detalhes técnicos

- `deferWithWorkerContext` continua sendo a via preferida; a novidade é que a request **nunca** espera o backup terminar.
- Idempotência: cada retomada refaz o export das tabelas restantes e reconstrói o ZIP do zero — não tentamos persistir chunks parciais no bucket, o que manteria complexidade. Como cada Worker novo tem tempo cheio para ~10s de export + mirror pequeno + upload, o resume tende a completar em uma invocação.
- Sem novas dependências.
- Testes manuais: (1) gerar backup — deve responder <2s e concluir em background; (2) simular kill (matar dev server no meio) — recarregar página e ver botão "Retomar" na linha `pending`; ao clicar, backup conclui.
