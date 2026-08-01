## Objetivo

Além de verde (conectado) e vermelho (offline), a bolinha do avatar passa a ficar **laranja** quando a rede estiver instável (latência alta / falhas intermitentes), com um modal de aviso específico.

## O que será feito

**1. Detecção de instabilidade**
- O ping já existente a cada 30s (`src/lib/use-connection-status.ts`) passa a medir o tempo de resposta.
- Classificação:
  - **Offline** — navegador sem rede ou ping falhou.
  - **Instável** — ping demorou mais de ~1,5s, ou houve falha em uma das últimas checagens seguida de sucesso (oscilação).
  - **Conectado** — ping rápido e estável.
- Enquanto instável, o intervalo de checagem cai para ~10s para confirmar/limpar o estado mais rápido.

**2. Bolinha laranja**
- `PresenceDot` passa a receber o status (`online` | `unstable` | `offline`) em vez de um booleano: verde pulsante, laranja pulsante, vermelho.
- `title`: "Conectado" / "Rede instável" / "Offline".

**3. Modal de aviso de latência**
- Ao entrar em estado instável, abre um aviso:
  > "Você está sofrendo latência de wi-fi. Algumas ações podem não ser carregadas ao banco — verifique sua conexão antes de qualquer ação."
- Botões "Entendi" e "Abrir Modo Teste" (mesmo padrão do modal offline).
- Aparece uma vez por episódio de instabilidade e fecha sozinho quando a conexão normaliza (com toast "Conexão estável novamente"). Se a conexão cair de vez, o modal offline atual assume o lugar.

## Detalhes técnicos

- `src/lib/use-connection-status.ts`: retorna `{ status, online, checking, latencyMs }`, mantendo `online` para compatibilidade com os usos atuais.
- `src/components/online-presence.tsx`: `PresenceDot` aceita `status` (mantendo suporte ao prop `online` para não quebrar chamadas existentes) e mapeia cores por token de estado.
- `src/components/app-layout.tsx`: passa o status para a bolinha (linha ~1104) e o `OfflineNoticeModal` (linha ~1525) ganha a variante de instabilidade, com título/ícone e texto próprios.
