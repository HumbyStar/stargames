# Backup único rotativo (estilo WhatsApp)

## Objetivo
Manter **apenas 1 backup armazenado por ambiente** (produção e teste), que é sobrescrito a cada execução — agendada de 10 em 10 horas, diária, ou manual no momento que você quiser.

## O que encontrei hoje
- A retenção atual guarda **3 backups por ambiente** (até 1 GB) e só roda **depois** que um novo backup termina com sucesso — ou seja, o espaço antigo continua ocupado durante a geração.
- Hoje existem 3 backups completos de produção (~157 MB no total) e 1 cancelado que nunca foi limpo, porque a limpeza de cancelados só apaga registros com mais de 7 dias.
- Observação honesta: 157 MB é pouco, então o tamanho acumulado provavelmente **não é a única causa** das falhas — as falhas anteriores foram por tempo de execução. Mesmo assim, a rotação única reduz espaço, custo e o risco de acúmulo, e vou verificar o log da última falha durante a implementação.

## O que será feito

### 1. Retenção: 1 backup por ambiente
- Passar a manter somente o backup completo mais recente de cada ambiente.
- Executar a limpeza **antes** de iniciar um novo backup (apagando arquivos de execuções falhas/canceladas e backups antigos na hora), e novamente depois que o novo backup for concluído — o backup anterior só é apagado após o novo ficar pronto, para nunca ficar sem cópia.
- Apagar imediatamente registros com status "falhou"/"cancelado" e seus arquivos, sem esperar 7 dias.
- Limpar arquivos órfãos no armazenamento que não têm registro correspondente.

### 2. Agendamento a cada 10 horas
- Adicionar a frequência "a cada 10 horas" às opções existentes (desligado / diário / semanal), com horário inicial configurável.
- Manter o botão de backup manual funcionando a qualquer momento.

### 3. Interface
- No painel de backups: indicar claramente que só existe **um backup atual** por ambiente, mostrando data/hora, tamanho e a próxima execução agendada.
- Ajustar textos que hoje mencionam "últimos 3 backups".

## Detalhes técnicos
- `src/lib/backup.functions.ts`: `BACKUP_RETENTION_COUNT` = 1; `enforceBackupRetention` passa a receber uma fase (`before` | `after`); nova chamada de limpeza no início de `runBackup`; remoção imediata de `failed`/`cancelled`; varredura de órfãos no bucket.
- Migração: atualizar `public.set_system_backup_schedule` para aceitar `every_10h` (cron `M H/10 * * *`) e `get_system_backup_schedule` continuar interpretando o cron corretamente.
- `src/lib/backup.functions.ts` (schema Zod de agendamento) e `src/components/backups-panel.tsx`: nova opção no seletor de frequência e textos de retenção.
