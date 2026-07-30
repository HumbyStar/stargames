## Objetivo
Eliminar o loop em “Inicialização”, garantir que o backup completo termine e possa ser baixado, e controlar o armazenamento sem apagar a versão mais recente válida.

## Diagnóstico confirmado
- Os backups manuais recentes são registrados, mas o log persistido informa **“Runtime sem waitUntil — job disparado sem garantia de continuidade”**; por isso a execução morre antes da primeira tabela e fica pendente até o timeout de 5 minutos.
- O único backup concluído tem aproximadamente **94 MB** e terminou em cerca de **67 segundos**, provando que o processo de extração/ZIP/upload funciona quando a execução permanece viva.
- A retenção atual só roda após sucesso e mantém 14 backups concluídos; não há limite total por bytes nem limpeza completa de falhas/arquivos órfãos.

## Implementação

### 1. Execução manual confiável
- Remover o modelo manual “disparar e esquecer” que depende do contexto de background indisponível.
- Fazer o backend manter a requisição de geração ativa até concluir ou falhar, persistindo o progresso entre todas as etapas.
- Impedir duas execuções simultâneas com aquisição atômica do job; cliques repetidos passam apenas a acompanhar o mesmo backup.
- Manter cancelamento seguro, mas verificar o pedido também durante lotes longos e antes do upload.
- Quando houver job antigo parado em `pending/running`, marcá-lo como falho antes de iniciar um novo, sem reutilizar estado parcial inconsistente.

### 2. Progresso e recuperação sem loop
- Ajustar a UI para acompanhar a execução real sem tentar reiniciar automaticamente o mesmo job várias vezes.
- Polling continuará exibindo tabela/fase/percentual, mas uma parada real será apresentada como falha acionável, não como ciclo infinito de “retomar”.
- “Tentar novamente” criará uma execução limpa, preservando o diagnóstico da tentativa anterior.
- Tratar navegação/atualização da tela: ao reabrir, a UI reassume o acompanhamento pelo registro persistido.

### 3. Retenção segura de armazenamento
- Executar retenção **somente depois** que o novo ZIP estiver carregado, verificado e marcado como concluído.
- Preservar sempre o backup concluído mais recente e nunca considerar `pending/running` para exclusão.
- Aplicar política combinada: manter os backups concluídos mais recentes dentro de um teto de quantidade e espaço total; ao exceder, excluir primeiro o concluído mais antigo.
- Usar como padrão inicial **até 10 backups concluídos ou 1 GB**, o que for atingido primeiro, mantendo no mínimo o último backup válido.
- Excluir na ordem correta: arquivo antigo do armazenamento, confirmar a remoção e só então apagar o registro; se a remoção falhar, registrar o erro e preservar o metadado.
- Limpar arquivos parciais de jobs falhos/cancelados e registros de falha antigos sem tocar nos backups válidos.

### 4. Verificação e transparência
- Após o upload, conferir existência e tamanho do arquivo antes de declarar sucesso e liberar download.
- Mostrar no painel: espaço usado pelos backups concluídos, limite da retenção e qual backup está protegido como “mais recente”.
- Validar o fluxo completo: gerar, avançar pelas etapas, concluir, baixar, cancelar e gerar backups suficientes para comprovar a exclusão do mais antigo sem remover o mais novo.

## Arquivos principais
- `src/lib/backup.functions.ts` — execução, exclusividade, verificação e retenção.
- `src/components/backups-panel.tsx` — acompanhamento sem auto-retomada em loop e informações de armazenamento.
- Backend/database apenas se for necessário um mecanismo atômico adicional para adquirir o job.