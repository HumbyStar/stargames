## Refator navbar ↔ one-page: navegação e scroll travados

O splash de hidratação **não pré-aquece nada** além do nome do usuário. Quando ele some, `MGMV` e `Collection` ainda estão como placeholders de `80vh` e o chunk lazy nem foi baixado. Clicar num item da navbar dispara `container.scrollTo` para o placeholder vazio, o `IntersectionObserver` do `LazySection` só então libera o mount, o chunk baixa, o React monta a seção e a viewport pula porque o `min-height:80vh` vira a altura real. Enquanto isso, a navbar tem um listener de `window scroll` sem throttle que chama `setNavSize`/`setNavBottom` em cada frame, re-renderizando o `_FloatingNavbarImpl` (1289 linhas) inteiro. Junto, dão exatamente a sensação de "clico e trava, rolo e trava".

O plano tem quatro frentes, todas em conjunto — a ideia é que, ao fim do splash, todas as seções já estejam montadas, o chunk baixado, e a navbar não emita mais nenhum trabalho por frame de scroll.

### 1. Splash como pré-aquecimento real (não só decoração)

`src/components/hydration-splash.tsx` + `src/components/app-layout.tsx`:

- Enquanto `!hydrated`, além de girar as frases, disparar em paralelo:
  - `import("@/sections/mgmv-section")`
  - `import("@/sections/collection-section")`
  - `import("@/components/dashboard-drilldown-modal")`
  - `import("@/sections/import-section")` e `@/sections/equipe-section` (modais lazy)
- Aguardar `Promise.all([hydrate(), Promise.all(prefetches)])` antes de considerar hidratação completa; ao terminar, marcar `warm=true` num novo estado local do `AppLayout`.
- O splash só desmonta quando `hydrated && warm`. Assim as frases refletem trabalho real, e o unmount coincide com "todas as seções prontas para montar".
- Se qualquer prefetch demorar > 4s, mantém-se o comportamento atual (desmonta assim que `hydrated=true`) para não travar em rede ruim.

### 2. `LazySection` deixa de ser IntersectionObserver e passa a montar em cascata pós-splash

`src/components/lazy-section.tsx`:

- Novo modo padrão `strategy="post-hydration"`: monta assim que a store hidrata **+** um `requestIdleCallback` (fallback `setTimeout(0)`). Nenhum `IntersectionObserver`, nenhum `minHeight:80vh`.
- A cascata é ordenada: `mgmv` monta primeiro, depois `collection`, cada um em `requestIdleCallback` separado — não bloqueia o main thread num único frame.
- Deixa o modo antigo `strategy="viewport"` disponível como opt-in, mas o `_authenticated.index.tsx` passa a usar `strategy="post-hydration"`.
- O wrapper mantém o `id` no DOM sempre, então o scroll continua funcionando. Como as seções já vêm montadas quando o usuário chega, o offset é o real desde o primeiro clique — sem pulo.

### 3. Navbar sem listener de scroll por frame + subcomponentes memoizados

`src/components/app-layout.tsx`:

- Remover `window.addEventListener("scroll", update)` (linhas 683–687 e 717–724 do handler de resize/scroll do pill). Manter apenas o `ResizeObserver` no `<nav>` — a geometria do pill só muda quando o próprio nav muda de tamanho, não a cada scroll. `navBottom` deixa de ser estado; se algum consumidor precisa da posição vertical, ler on-demand via ref no momento do evento.
- O `IntersectionObserver` para `scrolled` (sentinel no topo) já existe e é suficiente para o efeito de "navbar dimmed" — o listener de scroll é redundante.
- Extrair da monolítica `_FloatingNavbarImpl` três subcomponentes memoizados:
  - `NavPill` (SVG do path + wrapper) — só re-renderiza quando `navSize`/`navProgress`/`navDimmed` mudam.
  - `NavItems` (map dos `navItems` com `NavLink`) — só re-renderiza quando `activeSection` ou `visibleIds` mudam.
  - `NavRightIcons` (search/notifications/theme/settings) — só re-renderiza quando `unreadCount`/`isDark`/`searchOpen` mudam.
- Envolver `NavLink` e `RightNavIcon` em `React.memo` com props estáveis (callbacks via `useCallback`).
- Consolidar `scrollToSection` num único util em `src/lib/scroll-to-section.ts`, usado tanto pela navbar quanto pelo `_authenticated.index.tsx` — hoje há duas cópias divergentes.

### 4. Reduzir subscriptions caras da one-page

`src/routes/_authenticated.index.tsx`:

- `DashboardSection` hoje faz `useStore(s => s.clients)` + `useStore(s => s.products)` — qualquer alteração incremental (ex.: `updateClient` durante import) re-computa `computeDashboardAggregates`. Trocar por selector combinado com comparação shallow:  `useStore(s => [s.clients, s.products], shallow)` e memoizar aggregates com base nas *lengths + revs* já expostos pelo store, caindo para recomputação só quando as coleções realmente mudam. Se o store não expõe rev, usar `useMemo` já existente mas garantir que a dependência é o array e não uma nova instância recalculada.
- Passar callbacks estáveis (`onScrollTo`) via contexto simples ou props memoizadas — já é o caso, apenas confirmar após split.

### Fora do escopo (não mexer nesta rodada)

- Virtualização de listas dentro de `clientes-section` e `mgmv-section` (é onde o scroll interno pode travar em bases grandes; assunto separado).
- Estratégia de cache / SSR.
- Redesign visual da navbar.

### Verificação

- Recarregar: splash cobre até `hydrated && warm`; ao sumir, dev-tools Performance mostra apenas 1 layout inicial, sem novos `first paint` ao clicar em MGMV/Collection.
- Clique em cada item da navbar rola direto para a seção correta, sem placeholder ou "salto" de altura.
- `Performance > Main` durante scroll: nenhum callback JS por frame originado da navbar (apenas o `IntersectionObserver` de active-section, que dispara raro).
- `tsgo` e `bunx vitest run` continuam passando.

### Arquivos afetados

- `src/components/app-layout.tsx` — remove scroll listener, splita navbar, usa util compartilhado.
- `src/components/hydration-splash.tsx` — sem mudanças estruturais; apenas continua até `warm`.
- `src/components/lazy-section.tsx` — nova estratégia `post-hydration` como default.
- `src/routes/_authenticated.index.tsx` — usa nova estratégia; selector combinado com `shallow`; consome util de scroll.
- `src/lib/scroll-to-section.ts` — novo util compartilhado.
