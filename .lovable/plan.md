# Corrigir erro ao marcar parcela como paga (cliente Miguel Brandão) e humanizar os avisos

## O que está acontecendo

Ao salvar uma parcela, o app chama a rotina de gravação do acordo MGMV no banco. Hoje existem **duas versões dessa mesma rotina** convivendo: a antiga (sem a opção de recomeçar um acordo quitado) e a nova (com essa opção). Quando a chamada não informa a opção nova, o banco não consegue decidir qual das duas usar e devolve o erro técnico que apareceu no pop-up.

Isso não é um problema do cadastro do Miguel Brandão: acontece em qualquer pagamento de parcela feito sem reiniciar acordo.

## O que será feito

### 1. Remover a versão antiga da rotina no banco
Fica apenas a versão nova (com a opção de recomeçar), que já atende os dois casos. Com uma única versão, a ambiguidade desaparece e marcar parcela como paga volta a funcionar.

### 2. Sempre informar a opção explicitamente
A gravação passa a enviar sempre o parâmetro de "recomeçar acordo" (verdadeiro só na criação de um acordo por cima de um quitado, falso nos demais casos), em vez de omiti-lo.

### 3. Mensagens de erro em linguagem humana
O pop-up deixa de exibir texto técnico do banco. Passa a mostrar frases como:

- "Não foi possível salvar a parcela agora. Tente novamente em instantes; se continuar, avise o suporte."
- "Sem permissão para gravar esta alteração. Peça acesso a um administrador."
- "Sem conexão com o banco. A alteração não foi salva."

O detalhe técnico continua registrado no console para diagnóstico, mas nunca aparece para o usuário. Qualquer erro não reconhecido cai numa mensagem genérica amigável em vez de repassar o texto cru do banco.

## Detalhes técnicos

- Migração: `DROP FUNCTION public.save_mgmv_agreement_atomic(uuid, jsonb, jsonb, jsonb, uuid[])` (assinatura de 5 parâmetros), mantendo a de 6 com `_restart`; manter `REVOKE ... FROM PUBLIC, anon` e `GRANT EXECUTE TO authenticated, service_role`.
- `src/lib/db-sync.ts`: em `performAgreementSync`, enviar sempre `_restart: !!restart` (hoje é omitido quando falso).
- `src/lib/db-sync.ts` (`describeDbError`): tratar `PGRST203`/"Could not choose the best candidate function" e demais códigos desconhecidos com mensagem genérica amigável; nunca retornar `error.message` bruto — logar via `logErr` apenas.
- Regenerar os tipos do banco após a migração (a união de overloads em `types.ts` some).
