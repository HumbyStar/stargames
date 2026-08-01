## Objetivo

Indicador de presença para **todos os usuários** do sistema: uma bolinha verde/vermelha sobre o avatar da navbar (só visual, sem clique) e, dentro do modal do Concierge, uma lista minimalista de quem está conectado agora.

## O que será feito

**1. Bolinha no avatar (sem clique)**
- Ponto no canto inferior direito do avatar/mascote na navbar, puramente indicativo (`pointer-events-none`), sem popover — o clique continua abrindo o Concierge normalmente.
  - Verde pulsante = conectado (navegador online + heartbeat da sessão respondendo).
  - Vermelho = offline ou backend sem resposta.
- `title` com o estado ("Conectado" / "Offline") para acessibilidade.

**2. Lista de conectados no Concierge (minimalista)**
- No topo do modal do Concierge, uma linha discreta: pequenos pontos verdes + nome/e-mail dos usuários com sinal nos últimos ~2 minutos, com "você" marcado, e contagem tipo "3 conectados".
- Sem tabela, sem cards — apenas uma faixa enxuta que se atualiza a cada 30s enquanto o modal estiver aberto.
- Se ninguém além de você estiver online, mostra "Somente você conectado".

**3. Modal de modo offline**
- Ao perder a conexão, abre um aviso:
  > "Você está em modo offline. A conexão com o sistema caiu — nada será salvo na nuvem agora. Use o Modo Teste se precisar importar algo para validar."
- Botões "Entendi" e "Abrir Modo Teste"; aparece uma vez por queda e fecha sozinho quando a conexão volta (com toast de "Conexão restabelecida").

## Detalhes técnicos

- Novo hook `src/lib/use-connection-status.ts`: combina `isOnline()` de `src/lib/local-mode.ts` (eventos `online`/`offline`) com o resultado do heartbeat já existente em `src/lib/session-guard.functions.ts`.
- Nova server fn `listOnlineUsers` (com `requireSupabaseAuth`) lendo `public.active_sessions` filtrando `last_seen > now() - 2 min`, cruzando com `profiles.display_name`; retorna apenas id, nome/e-mail e último sinal.
- Como as políticas de `active_sessions` hoje são por usuário, a leitura coletiva passa por uma função `security definer` restrita a quem tem papel interno (`has_any_internal_role`), sem expor dados sensíveis.
- O heartbeat atual (30s, em `src/components/session-guard.tsx`) já alimenta a tabela para todos os usuários, então a presença funciona para o time inteiro sem código extra por usuário.
- Bolinha adicionada no bloco do avatar em `src/components/app-layout.tsx` (~linha 1089); faixa de conectados em `src/components/concierge-modal.tsx`; modal de offline renderizado uma vez no layout.
