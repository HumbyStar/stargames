## O que está acontecendo

Confirmei no banco a causa exata da divergência:

| tabela | produção | modo teste | soma |
|---|---|---|---|
| clients | 2.723 | 2.724 | **5.447** |
| products | 23.352 | 23.351 | **46.703** |

Os números da prévia do backup (5.447 clientes, 46.703 produtos) são exatamente **produção + modo teste somados**. Não é duplicação de dados nem erro do sistema local: o backup simplesmente não separa os dois ambientes.

Motivo técnico: em `src/lib/backup.functions.ts` tanto a estimativa (`estimateBackup`) quanto a exportação real (`fetchRowsForBackup`) leem as tabelas inteiras, sem aplicar o filtro `env` — que já existe e já é usado na restauração. Como o ambiente de teste é um clone completo da produção, tudo aparece em dobro.

## O que vou fazer

1. **Backup passa a ser por ambiente**
   - A prévia e a exportação passam a filtrar pelo ambiente atual do usuário (produção, ou teste quando o sandbox estiver ativo) em todas as tabelas que têm essa separação.
   - Tabelas globais (papéis, permissões, auditoria, perfis) continuam saindo inteiras, como hoje.
   - Resultado esperado: a prévia mostrará 2.723 clientes e 23.352 produtos, batendo com a tela inicial.

2. **Registro do ambiente no backup**
   - O ambiente de origem já é gravado no registro do backup; vou exibi-lo na prévia, no card do backup e no resumo, para nunca mais haver dúvida sobre "de onde veio" o arquivo.

3. **Resumo de negócio corrigido**
   - Os totais do resumo (clientes, acordos, parcelas, notas) são calculados a partir das linhas exportadas, então passam automaticamente a refletir só o ambiente correto.

4. **Correção de leitura instável (bug latente)**
   - A leitura em blocos de 1.000 linhas hoje é feita sem ordenação definida, o que pode repetir ou pular linhas em tabelas grandes. Vou ordenar por chave estável na paginação, garantindo contagem exata em cada tabela.

5. **Verificação**
   - Rodo a prévia e confiro que os números batem com o dashboard, e gero um backup de teste para confirmar que a contagem final e o resumo ficam idênticos.

## Detalhes técnicos

- `src/lib/backup.functions.ts`: resolver `env` do usuário (`resolveTargetEnv`) no início de `estimateBackup` e do fluxo de geração; aplicar `.eq("env", env)` em `fetchRowsForBackup` e na contagem `head: true` para tabelas em `ENV_SCOPED_TABLES`; adicionar `.order(<pk>, { ascending: true })` antes do `.range()`.
- UI (`backup-preview-modal`, `backups-panel`, `backup-summary-modal`): badge com o ambiente de origem do backup.
- Sem migração de banco — nada muda no esquema.
