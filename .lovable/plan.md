## Diagnóstico
- No upload de ZIP, o arquivo inteiro é convertido em **base64 no navegador** (`fileToBase64` em `src/components/restore-backup-modal.tsx`) e enviado como um único campo de texto (`uploadedZipBase64`) para `previewBackupRestore` / `restoreBackup`.
- Um backup real do sistema tem ~94 MB → vira uma string de ~125 MB, que ainda é serializada na chamada RPC e depois decodificada com `atob` no servidor (`loadBackupZip`, `src/lib/backup.functions.ts`), gerando outra cópia em memória.
- É por isso que o erro do tipo “cannot fit …” aparece **na etapa de analisar/prévia** e apenas no upload de ZIP: o payload não cabe no limite de memória/corpo de requisição do runtime. Confirmado também que a auditoria do Modo Teste (`sandbox_import_audit`) está vazia — a execução nunca chega à restauração.

## Solução: parar de trafegar o ZIP em base64
O arquivo passa a ir direto para o armazenamento e o servidor lê de lá.

### 1. Envio direto para o armazenamento
- Nova função de servidor (somente admin) que devolve uma **URL assinada de upload** para um caminho temporário no bucket de backups, ex.: `uploads/<user>/<timestamp>-<nome>.zip`.
- O modal envia o arquivo binário direto para essa URL (com barra de progresso real), sem base64 e sem passar pelo servidor da aplicação.
- Em vez de `uploadedZipBase64`, o modal passa apenas o **caminho** do arquivo enviado.

### 2. Prévia, validação e restauração lendo do armazenamento
- `loadBackupZip` ganha um terceiro caminho de entrada: `uploadedPath`, baixando o ZIP do bucket como bytes (mesmo mecanismo já usado para “backup salvo”, que hoje funciona).
- `previewBackupRestore`, `validateBackupRestore` e `restoreBackup` aceitam esse caminho; o base64 continua aceito apenas para arquivos pequenos (limite baixo, ex. 8 MB), como compatibilidade.
- Após concluir (ou falhar), o arquivo temporário do upload é removido do bucket; sobras antigas de `uploads/` são limpas junto com a retenção de backups.

### 3. Isolamento do Modo Teste preservado
- Nenhuma mudança nas regras de isolamento: destino continua decidido no servidor, o ambiente de teste continua sendo zerado antes da carga, ids são regerados, tabelas globais nunca são tocadas e a auditoria com contagens de produção antes/depois continua sendo gravada.

### 4. Mensagens de erro úteis
- Erros de leitura do ZIP passam a exibir a causa real (arquivo inválido, manifesto ausente, falha de download) em vez de estourar um erro de memória genérico.
- Estados claros no modal: “Enviando arquivo… x%”, “Analisando backup…”, “Restaurando…”.

## Verificação
- Enviar um backup completo real (~94 MB) no Modo Teste: upload conclui, prévia mostra tabelas e resumo, restauração termina com sucesso.
- Conferir que os dados aparecem nas seções em modo teste e que as contagens de produção antes/depois no registro de auditoria ficam idênticas.
- Repetir com um ZIP pequeno e com a opção “usar backup salvo” para garantir que os dois caminhos continuam funcionando.

## Arquivos principais
- `src/lib/backup.functions.ts` — URL assinada de upload, `loadBackupZip` por caminho, limpeza do temporário.
- `src/components/restore-backup-modal.tsx` — upload direto com progresso, sem base64.
