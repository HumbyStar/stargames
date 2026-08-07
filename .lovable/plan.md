# Revisão dos 14 problemas ignorados de segurança

Verifiquei no banco as políticas RLS reais de todas as 26 tabelas antes de classificar. Resultado: **todas as tabelas têm RLS ativa e nenhuma tem política aberta a visitantes (anon)**. Os achados "críticos" da lista de ignorados descrevem um estado antigo do projeto e não correspondem mais ao banco atual.

## Classificação

### Críticos — não precisam de correção (já resolvidos no banco)
- Dados pessoais de clientes (nomes, telefones): `clients` só é lida por `has_any_internal_role` + isolamento de ambiente.
- Dados financeiros de clientes: `products` / `mgmv_installments` / `nf_invoices` seguem a mesma regra.
- Histórico de importação público: `import_history` exige papel interno.
- Configurações do app graváveis: `app_settings` só permite INSERT/UPDATE/DELETE para admin e admin master.

Ação: manter ignorados, apenas registrar na memória de segurança que já foram verificados nesta data.

### Avisos que vale a pena corrigir agora (sem impacto no uso do sistema)
1. **Função SECURITY DEFINER executável por qualquer usuário logado** (achado ativo no scan de hoje, além dos ignorados). Revogar `EXECUTE` de `authenticated` nas funções internas que só devem ser chamadas por triggers ou pelo servidor, mantendo permissão nas funções realmente usadas pela interface.
2. **`user_roles` – leitura ampla**: hoje a política de SELECT usa `has_role(..., 'admin')` sem incluir `admin_master` de forma explícita e permite que um admin liste todos os papéis. Ajuste pontual: leitura própria + admin/admin_master, deixando explícito e consistente com as políticas de escrita.
3. **Filtros salvos legíveis/modificáveis**: já restrito a dono ou admin. Sem mudança; ignorar definitivamente.

### Avisos que NÃO devem ser "corrigidos" (são regras de negócio)
- Registros de ponto (`team_punch_entries`) não podem ser corrigidos após 30 min — imutabilidade intencional.
- Registros de acesso (`notion_html_access_log`, `audit_log`, `sandbox_import_audit`) sem UPDATE/DELETE — trilha de auditoria imutável, correto assim.
- `mgmv_installments` sem política de escrita própria — na verdade tem INSERT/UPDATE/DELETE por papel interno.
- Notas fiscais sem UPDATE/DELETE — já revisado antes: edição é feita com trilha de auditoria.
- "Nenhum problema crítico encontrado" — item informativo.

## Detalhes técnicos
- Migração 1: `REVOKE EXECUTE ... FROM authenticated` nas funções `SECURITY DEFINER` apontadas pelo linter que não são chamadas pelo cliente; validar antes com `pg_proc` + busca no código para não quebrar nenhuma chamada de RPC existente.
- Migração 2: recriar a política `users read own roles` como `user_id = auth.uid() OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'admin_master')`.
- Depois: rodar o linter e o scan novamente, marcar como corrigidos apenas os itens tratados, manter os demais ignorados e atualizar a memória de segurança com a justificativa de cada risco aceito.
- Sem alterações de frontend; nenhuma tela muda de comportamento.
