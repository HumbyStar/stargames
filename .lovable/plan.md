## Objetivo

Ao gerar um backup, travar o modal de Configurações (ou o painel de backups) e mostrar um badge "Executando…" pulsante enquanto o backup não termina. Só liberar fechar o modal e demais ações quando o backup for concluído com sucesso (ou falhar).

## Comportamento

- Clicar em **Gerar backup agora** entra em estado `running`:
  - Overlay bloqueia clique fora, tecla `Esc` e botão de fechar do modal de Configurações.
  - Todas as ações do painel ficam desabilitadas: **Gerar**, **Atualizar**, **Restaurar**, **Agendamento**, **Ver resumo**, **Download**, **Excluir**.
  - Um badge fixo (canto do painel, com ícone `Loader2` girando + pulse) mostra "Backup em execução…" com o tempo decorrido em segundos.
- Enquanto `running`:
  - Poll a cada 3s via `listBackups` procurando o `id` retornado por `createBackupNow`.
  - Se `status === "completed"` → toast de sucesso, destrava tudo, abre automaticamente o `BackupSummaryModal` do backup recém-criado (já existente no fluxo).
  - Se `status === "failed"` → toast de erro com a mensagem, destrava tudo.
  - Timeout de segurança de 20 min (mesmo cap de `cleanupStaleBackups`): destrava e mostra erro.

## Mudanças

### `src/components/backups-panel.tsx`
- Estado novo: `running` continua, mas passa a controlar bloqueio global via prop callback `onRunningChange(boolean)` para o container.
- Após `createBackupNow()`, guardar `activeBackupId` e iniciar `setInterval` de polling em vez do refresh único atual.
- Renderizar badge flutuante `<div>` fixo no topo do painel quando `running`.
- Desabilitar todos os botões da tabela (`Ver resumo`, `Download`, `Excluir`) e do topo quando `running`.
- Expor prop `onRunningChange?: (running: boolean) => void`.

### `src/sections/configuracoes-section.tsx`
- Passar `onRunningChange` para `<BackupsPanel />` e guardar `backupRunning` em state local.
- Propagar para o wrapper que abre o modal de Configurações (via `useUiStore` — adicionar flag `settingsLocked` ou passar prop ao componente de modal).

### `src/lib/ui-store.ts`
- Adicionar `settingsLocked: boolean` + `setSettingsLocked(v)`.
- `closeSettings` vira no-op quando `settingsLocked === true`.

### Modal de Configurações (onde `settingsOpen` é consumido)
- Ler `settingsLocked`; quando `true`:
  - Prop `onOpenChange` ignora fechamento.
  - Esconder botão "X" (ou desabilitá-lo).
  - `onEscapeKeyDown` / `onPointerDownOutside` com `preventDefault()`.

## Detalhes técnicos

- Nenhum ajuste no backend — `createBackupNow` já retorna `{ backupId, queued }` e `listBackups` já traz `status`. O polling client-side é suficiente.
- Cleanup: `useEffect` limpa o `setInterval` no unmount e ao sair de `running`.
- Sem mudanças em rotas, migrations ou permissões.
