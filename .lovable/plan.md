## Objetivo
Fazer a restauração do backup no Modo Teste concluir de forma isolada, corrigindo exatamente os três erros exibidos e melhorando a validação antes da gravação.

## Diagnóstico confirmado
- `ai_training_profile` não possui coluna `id`; sua chave é composta por `user_id, env`. A rotina atual usa `select("id")` para contar e uma operação baseada em `id` para limpar, por isso falha antes da carga.
- `app_settings` usa chave composta `id, env`. O lote pode conter mais de uma linha que, após a conversão para `env = sandbox`, converge para a mesma chave e faz o mesmo `UPSERT` tentar atualizar a linha duas vezes.
- `team_punch_entries` possui uma unicidade adicional por `user_id, day, kind` que não considera `env`. Já existe na produção a batida indicada no erro; portanto, copiar a mesma identidade do usuário para o sandbox colide com a produção mesmo quando a linha recebe `env = sandbox`.

## Implementação
1. **Limpeza e contagem independentes de `id`**
   - Alterar a restauração para usar uma projeção compatível com todas as tabelas na contagem.
   - Limpar tabelas com `env` diretamente por `env = sandbox`, sem presumir a existência de `id`.
   - Manter a ordem inversa de dependências e registrar erros por tabela/etapa.

2. **Normalização e deduplicação antes dos lotes**
   - Normalizar todas as linhas para `env = sandbox` antes de gravar.
   - Deduplicar `app_settings` por `id + env` e `ai_training_profile` por `user_id + env`, preservando uma única versão determinística por chave.
   - Deduplicar as demais tabelas pela chave real de conflito antes de cada `UPSERT`, evitando que um lote afete a mesma linha duas vezes.

3. **Batidas de ponto isoladas no sandbox**
   - Tratar `team_punch_entries` pela chave de negócio `user_id + day + kind`.
   - Como a restrição atual atravessa produção e sandbox, ignorar no sandbox somente as batidas que colidirem com uma batida já existente para o mesmo usuário/dia/tipo, registrar o motivo no relatório e continuar restaurando as demais tabelas.
   - Não alterar, apagar nem atualizar a batida existente da produção.

4. **Pré-validação coerente com a gravação real**
   - Detectar no ZIP duplicidades nas chaves compostas de `app_settings`, `ai_training_profile` e `team_punch_entries`, em vez de verificar apenas `id`.
   - Mostrar avisos claros sobre linhas consolidadas ou ignoradas antes da restauração.

5. **Verificação**
   - Executar os testes seletivos do fluxo de backup/restauração.
   - Validar no preview a restauração do ZIP no Modo Teste, conferindo contagens restauradas, linhas ignoradas justificadamente, ausência dos três erros e o indicador de que a produção permaneceu intacta.