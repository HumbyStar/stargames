## Objetivo

Deixar o card GitHub (Configurações) mais rápido e transparente: lista em cache controlável, erros de token explicados, branch padrão detectada sozinha e acesso rápido ao repositório.

## 1. Cache de repositórios com expiração

- Guardar a lista carregada em `localStorage` (`stargames.github.repos.cache`) junto com o timestamp e o login da conta conectada.
- TTL de 30 minutos: ao abrir o card, se o cache for válido e da mesma conta, a lista aparece instantaneamente sem chamar o GitHub.
- Rodapé indicando a origem: "Lista em cache — atualizada há X min" ou "Lista carregada agora do GitHub".
- Dois botões: **Atualizar lista** (força busca nova e regrava o cache) e **Limpar cache** (apaga o armazenamento local, zera a lista e mostra o estado "não carregado").
- Cache invalidado automaticamente quando a conta conectada muda de login.

## 2. Validação de permissões e erros detalhados

- Na resposta do GitHub, ler o cabeçalho `x-oauth-scopes` (tokens clássicos) e expor os escopos no status.
- Mapear os erros por status com mensagens em português:
  - **401** — token inválido ou expirado; instrução para gerar outro e salvá-lo novamente.
  - **403** — sem permissão / rate limit / autorização SSO da organização pendente; se houver `x-ratelimit-remaining: 0`, informar o horário de liberação.
  - **404** — repositório inexistente ou fora do alcance do token (já implementado; mantém a sugestão de nome parecido).
- Aviso quando um token clássico não tem o escopo `repo`: alerta explicando que repositórios privados não aparecerão na lista.
- Aviso de lista incompleta (mais de 5 páginas) com sugestão de usar a busca ou o campo manual.
- Todos esses avisos ficam em um bloco de diagnóstico dentro do card, não só em toast.

## 3. Branch default automática

- Cada item da lista já traz `default_branch`; ao selecionar um repositório pelo select, preencher automaticamente o campo Branch com essa branch quando o usuário ainda não tiver digitado uma branch própria.
- Para repositório digitado manualmente, buscar a branch padrão via status ao validar o repositório.
- Placeholder passa a mostrar a branch detectada; um botão pequeno "usar padrão" restaura a branch detectada caso o usuário tenha editado.

## 4. Link "Abrir no GitHub"

- Ao lado do select, botão-ícone com link externo apontando para `https://github.com/{owner}/{repo}` (usando `htmlUrl` real quando o status já validou o repositório), abrindo em nova aba.
- Desabilitado enquanto não houver repositório em formato `dono/repositório` válido.

## Detalhes técnicos

- `src/lib/github.server.ts`: `githubFetch` passa a retornar também os headers relevantes (`x-oauth-scopes`, `x-ratelimit-*`) através de uma variante `githubFetchWithMeta`, sem alterar as chamadas existentes.
- `src/lib/github.functions.ts`:
  - `listGithubRepos` retorna `{ repos, complete, total, scopes, warnings }`.
  - `getGithubStatus` inclui `scopes` e mensagens específicas para 401/403.
  - Nenhuma mudança de schema no banco; a configuração continua em `app_settings` (`id = 'github'`).
- `src/components/github-card.tsx`: estados novos para cache (`cachedAt`, origem da lista), diagnóstico e branch detectada; helpers de leitura/escrita no `localStorage` já existentes são estendidos.

Nada muda no fluxo de publicação (backup, exports, changelog) nem no sync nativo do código-fonte.
