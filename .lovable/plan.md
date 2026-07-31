## Situação atual (verificada no código)

O que **já funciona**: quando você gera um backup, o sistema descobre no servidor se você está em Produção ou no Modo Teste e copia apenas as linhas daquele ambiente. As tabelas com marcação de ambiente (clientes, produtos, acordos MGMV, parcelas, notas, tarefas, ponto, configurações, etc.) já saem filtradas — não há soma dos dois ambientes dentro de um mesmo arquivo.

O que **ainda não está separado**:
1. O **histórico de backups** lista os dois ambientes misturados na mesma tabela.
2. O **arquivo salvo** vai para a mesma pasta (`ano/mês/`) com o mesmo padrão de nome, sem indicar o ambiente.
3. O **manifesto interno** do ZIP não registra de qual ambiente ele veio, então na hora de restaurar nada avisa se você está prestes a jogar dados de teste na produção.
4. O backup do Modo Teste ainda espelha os arquivos originais (acervo HTML), que são compartilhados e somente leitura no teste — peso desnecessário.

## O que será feito

### 1. Histórico separado por ambiente
- A lista de backups passa a mostrar apenas os backups do ambiente em que você está.
- Um seletor no card permite ver "Produção" ou "Modo teste" quando quiser conferir os dois.
- O contador e o botão "Gerar backup" continuam agindo somente sobre o ambiente atual.

### 2. Arquivos separados no armazenamento
- Caminho passa a ser `producao/ano/mês/...` e `sandbox/ano/mês/...`.
- O nome do arquivo ganha o prefixo do ambiente (`stargames-producao-...zip` / `stargames-teste-...zip`), então nunca há dúvida ao baixar.
- Backups antigos continuam funcionando (leitura pelo caminho já gravado no registro).

### 3. Manifesto e proteção na restauração
- O manifesto do ZIP passa a gravar o ambiente de origem.
- Ao restaurar, se a origem do arquivo for diferente do ambiente atual, aparece um aviso claro exigindo confirmação explícita ("este arquivo veio do Modo Teste — confirmar aplicação em Produção?").
- A regra atual continua valendo: o destino é sempre decidido no servidor pelo seu estado de sandbox, nunca pelo navegador.

### 4. Backup do Modo Teste mais leve
- No Modo Teste, o espelhamento dos arquivos originais é ignorado (o acervo é único e só de leitura lá), reduzindo drasticamente tamanho e tempo.
- O manifesto registra que os arquivos não foram incluídos, para não parecer perda de dados.

### 5. Verificação após implementar
- Conferir por consulta ao banco a contagem de linhas por ambiente e comparar com o `row_counts` gravado no backup gerado, garantindo que nenhum registro do outro ambiente entrou.

## Detalhes técnicos

- `src/lib/backup.functions.ts`: `storagePathFor` e `formatFilename` recebem o ambiente; `manifest` ganha o campo `env`; `listBackups` aceita e filtra por `env`; `mirrorBucket` é pulado quando `backupEnv === "sandbox"`; `readManifest` expõe o `env` de origem.
- `src/components/backups-panel.tsx`: seletor de ambiente na listagem e aviso de origem divergente no fluxo de restauração.
- Tabelas globais (perfis, papéis, permissões, responsabilidades, logs de auditoria e de acesso) não possuem coluna de ambiente e continuam presentes nos dois backups — elas são únicas do sistema, não pertencem a um ambiente.
- Sem alteração de schema: nada de migração necessária.
