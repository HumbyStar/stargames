# Recuperação automática de "Failed to fetch dynamically imported module"

## O que aconteceu

O build atual está OK. O erro que apareceu na sua tela é de **versão desatualizada**: a aba estava aberta com a versão antiga do sistema, o sistema foi atualizado e o pedaço de código que a aba tentou baixar (`_authenticated`) não existe mais com aquele endereço. Resultado: a tela "Algo travou por aqui".

Hoje isso obriga o usuário a clicar em "Recarregar página" manualmente. Como o app fica aberto o dia todo (e agora ainda mais, com o modo ocioso), isso vai se repetir a cada publicação.

## O que vou fazer

1. **Detectar esse tipo específico de erro** (mensagens como "Failed to fetch dynamically imported module", "error loading dynamically imported module", "Importing a module script failed").
2. **Recarregar sozinho, uma única vez**, quando ele acontecer — sem mostrar tela de erro. Marco no `sessionStorage` que já houve uma tentativa, para nunca entrar em loop de reload.
3. Se acontecer **duas vezes seguidas** (sinal de problema real de rede), aí sim mostro uma tela amigável específica: "Nova versão disponível / conexão instável" com botão "Atualizar agora".
4. Aplicar a mesma detecção no boundary de erro da rota raiz, para cobrir os casos em que a falha é capturada pelo router antes do boundary global.
5. Ao voltar do modo ocioso / aba reaberta, nenhuma mudança de comportamento adicional — o reload único já cobre.

Nada de dados, tabelas, permissões ou regras de negócio muda.

## Detalhes técnicos

- Novo utilitário `src/lib/chunk-reload.ts`: `isChunkLoadError(error)` e `recoverFromChunkError()` (guarda `sg:chunk-reload` em `sessionStorage`, limpo após um carregamento bem-sucedido).
- `src/components/global-error-boundary.tsx`: em `componentDidCatch`, se `isChunkLoadError` e ainda não houve tentativa, chama `window.location.reload()`; caso contrário renderiza a variante "nova versão disponível".
- `src/routes/__root.tsx`: `ErrorComponent` usa a mesma checagem antes de renderizar a tela genérica.
- Limpeza do marcador no `RootComponent` via `useEffect` no primeiro render bem-sucedido.
