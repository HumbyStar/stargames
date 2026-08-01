## O que verifiquei agora no banco

Contagens reais por ambiente:

| Tabela | Produção | Teste |
|---|---|---|
| clients | 2.729 | 2.728 |
| products | 23.456 | 23.428 |
| mgmv_agreements | 77 | 77 |
| mgmv_installments | 508 | 508 |
| team_punch_entries | 36 | 0 |
| audit_log | 69.821 (tabela sem coluna de ambiente) | — |

**Sobre os "números duplicados":** o backup filtra `env` corretamente — não soma produção + teste. Os números parecem repetidos porque o Modo Teste é um **clone da produção**, então as contagens são quase idênticas de propósito. A única exceção real é `audit_log` (69.821 linhas): essa tabela **não tem coluna de ambiente**, então ela sai inteira nos dois backups. É o único ponto que hoje mistura histórico dos dois ambientes.

**Sobre o timeout:** hoje o backup inteiro (~97 mil linhas + espelho de storage + compactação) roda numa única execução de servidor, que tem tempo limitado. Ele é marcado como travado após 5 minutos. Por isso ele para sempre "na compactação".

## O que será feito

### 1. Backup em etapas, sem timeout (meta: 200 mil linhas)
- O backup passa a rodar com **orçamento de tempo por execução** (~60s): exporta o quanto der, salva o progresso (tabela e posição atual) no registro do backup e **se reagenda sozinho** para continuar de onde parou.
- Cada bloco exportado é gravado como parte do pacote, sem acumular o ZIP inteiro em memória; a compactação final só ocorre quando todas as tabelas terminaram.
- Retomada automática: nada de "Tentar novamente" manual. Se uma execução cair, a próxima continua da mesma posição.
- **Capacidade**: com esse modelo o limite deixa de ser tempo e passa a ser memória do pacote final. O teto será configurado em **300 mil linhas por tabela e 1 milhão no total**, com folga confortável para os 200 mil que você pediu (hoje o sistema todo tem ~170 mil linhas). Se algum teto for atingido, o backup avisa explicitamente em vez de falhar em silêncio.

### 2. Retenção passa de 10 para 3
- Mantém sempre os **3 backups concluídos mais recentes** por ambiente; os mais antigos são apagados do armazenamento e do histórico automaticamente ao final de cada backup novo.
- Backups falhos continuam sendo limpos após 7 dias.

### 3. Separação total produção × teste
- `audit_log` passa a ser separada por ambiente no pacote: o backup de produção leva só o histórico de produção. Como a tabela não tem coluna de ambiente, a separação será feita por migração (nova coluna `env` preenchida como produção no histórico existente).
- O resumo do backup passa a exibir o ambiente de origem em cada número, para que nunca reste dúvida sobre de onde veio o dado.
- Conferência final: gerar um backup de cada ambiente e comparar tabela a tabela com as contagens do banco.

### 4. Camada de verificação com I.A. (sim, é possível)
Será adicionada como etapa opcional ao final de cada backup:
- A I.A. recebe o **relatório do backup** (contagens esperadas x gravadas, tabelas puladas, tempo por etapa, erros) — nunca os dados dos clientes.
- Ela aponta: tabela faltando, contagem divergente, etapa anormalmente lenta, teto atingido.
- **Correção automática permitida** apenas para ações seguras e reversíveis: reexecutar a exportação de uma tabela que falhou e disparar a retomada quando detectar backup parado. Qualquer coisa além disso vira apenas recomendação na tela, exigindo sua aprovação.
- Resultado aparece como selo no card do backup: "Verificado por I.A. — íntegro" ou "Atenção: X divergências".

## Detalhes técnicos
- `src/lib/backup.functions.ts`: orçamento de tempo por execução, cursor de progresso persistido em `system_backups`, auto-reagendamento via `/api/public/hooks/backup-run`, `BACKUP_RETENTION_COUNT` 10 → 3, tetos por tabela/total, filtro de `env` em `audit_log`.
- Migração: coluna `env` em `audit_log` (default produção) + índice de apoio; `audit_change()` passa a gravar o ambiente atual.
- Nova função de verificação por I.A. (Lovable AI, sem chave extra) recebendo só o relatório do backup.
- `src/components/backups-panel.tsx`: barra de progresso por tabela, selo de verificação da I.A. e aviso de retenção 3.
