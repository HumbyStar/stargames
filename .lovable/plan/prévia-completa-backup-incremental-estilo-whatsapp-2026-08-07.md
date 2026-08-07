# Prévia completa + backup incremental (estilo WhatsApp)

## Respondendo sua dúvida primeiro
Sim: **hoje cada backup lê linha por linha, do zero, todas as tabelas** — mesmo que quase nada tenha mudado. Não existe nenhum reaproveitamento do backup anterior, e é isso que faz cada execução ser longa e arriscada por tempo limite.

## O que será feito

### 1. Prévia do backup mostra todas as tabelas
- A caixa "Maiores tabelas" vira "Todas as tabelas", em ordem decrescente de linhas, com rolagem interna e o total de linhas de cada uma.
- Nada mais fica escondido atrás do corte de 8 itens.

### 2. Botão "Atualizar backup" (incremental)
- O painel passa a ter dois botões:
  - **Atualizar backup** — padrão quando já existe um backup daquele ambiente.
  - **Refazer do zero** — backup completo, para quando você quiser recomeçar.
- Como a atualização funciona:
  1. Lê o backup atual do ambiente (o único guardado) e a data/hora em que ele foi gerado.
  2. Busca em cada tabela **apenas** as linhas criadas ou alteradas depois dessa data.
  3. Descobre o que foi **excluído** desde então pelo registro de auditoria e tira essas linhas do pacote.
  4. Aplica as mudanças por cima do conteúdo existente (mesmo registro substitui, registro novo entra).
  5. Copia só os arquivos originais que ainda não estavam no pacote.
  6. Grava por cima do backup anterior — continua **um único backup por ambiente**, agora com a data da última atualização.
- Se o backup atual estiver ausente, corrompido, incompleto ou em formato antigo, o sistema avisa e cai automaticamente para backup completo — nunca sobra um pacote inconsistente.
- O agendamento (10 em 10 horas / diário / semanal) passa a usar a atualização incremental, com um backup completo automático a cada 7 dias para garantir integridade.

### 3. Transparência no painel
- Cada backup mostra: "Completo" ou "Atualizado em …", quantas linhas entraram e saíram na última atualização e quando foi o último backup completo.

## Detalhes técnicos
- `src/lib/backup.functions.ts`:
  - manifesto ganha `mode` ("full" | "incremental"), `baseGeneratedAt`, `lastFullAt` e `incrementalRuns` (schema version +1, restauração retrocompatível);
  - nova rotina `runIncrementalBackup`: baixa o ZIP atual, indexa os `.jsonl` por chave primária, aplica o delta e regrava o pacote;
  - delta por tabela: `updated_at > base` quando a coluna existe, senão `created_at > base`; tabelas append-only (`audit_log`, logs) usam só `created_at`;
  - exclusões: consulta `public.audit_log` com `action='DELETE'` e `changed_at > base`, mapeando `table_name`/`row_id`; tabela sem cobertura de auditoria no período força reexportação completa daquela tabela;
  - tabelas pequenas sem coluna de data confiável (ex.: `role_permissions`, `app_settings`) são sempre reexportadas inteiras;
  - novo server fn `updateBackupNow`, reaproveitando o fluxo em etapas/retomada já existente; retenção segue `BACKUP_RETENTION_COUNT = 1`.
- `src/components/backups-panel.tsx`: prévia com lista completa rolável, novos botões e rótulos de modo.
- `src/routes/api/public/hooks/backup-run.ts`: execução agendada chama a atualização incremental, com fallback para completo semanal.