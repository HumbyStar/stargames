# Otimização da One Page — fluidez, navbar e navegação

Objetivo: manter a experiência de uma única rota com todas as seções, mas eliminar os pontos que hoje pesam no primeiro paint, na rolagem e na navegação via navbar.

## Diagnóstico atual

A one page monta todas as seções ao mesmo tempo, e várias delas são gigantes (linhas de código):

```
_authenticated.index.tsx      256
app-layout.tsx              1 262
clientes-section.tsx        1 341
collection-section.tsx        951
configuracoes-section.tsx   1 406
equipe-section.tsx            764
import-section.tsx          4 331   ← sozinho ~37% do bundle da rota
mgmv-section.tsx              809
dashboard-drilldown-modal      534
```

Pontos que causam travamento:

1. `page-container` usa `scroll-snap-type: y mandatory` + `.one-page-section { min-height: 100vh; scroll-snap-stop: always }`. Isso briga com `scrollIntoView({behavior:"smooth"})` da navbar (o snap "puxa" a rolagem antes de terminar) e força o navegador a recalcular snap points em cada mutação do DOM.
2. Todas as sections são renderizadas de imediato mesmo quando estão fora da viewport — inclusive `ImportSection` (4.3k linhas, tabelas grandes, formulários e workers).
3. Em `app-layout.tsx` existe um `MutationObserver` com `subtree: true` no `page-container`. Cada `setState` dentro de qualquer section dispara `observeAll()` → custa em listas grandes (MGMV, cobranças, importação).
4. O `IntersectionObserver` da navbar usa 8 thresholds (`[0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1]`) e é reconstruído a cada resize. Basta 2 (entrada/saída) para o "active section".
5. `sessionStorage.setItem` do scroll é escrito a cada frame de scroll (mesmo com rAF, é I/O síncrono por frame).
6. Cada `Section` recebe `onScrollTo` e várias seleções `useStore((s) => s.clients / s.products)` sem `useShallow`, então uma alteração em qualquer parte do store re-renderiza todas as seções montadas.
7. `scrollToSection` faz `el.scrollTo({top:0})` + `scrollIntoView` em sequência — em Chrome isso cancela o smooth scroll.
8. `ImportSection`, `DashboardDrilldownModal`, `ConciergeModal`, `AITrainingModal` estão sempre no bundle inicial da rota, mesmo abrindo sob demanda.

---

## Plano de correção

### 1. Rolagem: remover o `scroll-snap` obrigatório

Arquivo: `src/styles.css`

- Remover `scroll-snap-type: y mandatory` do `.page-container` (linha 415).
- Remover `scroll-snap-align: start` e `scroll-snap-stop: always` do `.one-page-section` (linhas 441-442).
- Trocar `min-height: 100vh` da `.one-page-section` por `min-height: auto` + manter apenas `scroll-margin-top: 84px` (para a navbar flutuante não cobrir o título ao ancorar).
- Adicionar `scroll-behavior: smooth;` no `.page-container` — permite que âncoras nativas rolem suavemente sem JS.

Resultado: fim do "puxão" ao usar a navbar, rolagem manual solta, e sections menores não precisam mais ter 100vh cada.

### 2. Renderização preguiçosa das sections pesadas

Arquivos: `src/routes/_authenticated.index.tsx`, `src/sections/*`

- Manter `DashboardSection` e `ClientesSection` como imports diretos (são o topo e o mais usado).
- Passar as demais para `React.lazy` + `Suspense`, envolvidas por um wrapper que só monta quando a section entra em ~1 viewport de distância (usando `IntersectionObserver` num placeholder `min-height: 60vh`). Fallback: skeleton simples com a mesma altura para não empurrar o layout.

Sections a preguiçar (em ordem):
- `MGMVSection`
- `CollectionSection`
- `EquipeSection`
- `ImportSection` (nunca montar antes do usuário abrir; hoje é o maior peso)

Wrapper novo: `src/components/lazy-section.tsx` — recebe `id`, `minHeight`, `loader` e renderiza o children só depois da primeira intersecção.

### 3. Modais grandes: `React.lazy` sob demanda

Arquivos: `src/routes/_authenticated.index.tsx`, `src/components/app-layout.tsx`

- `DashboardDrilldownModal`, `ConciergeModal`, `AITrainingModal`, `ImportProgressModal`, `HelpCenter`, `ListImportModal`, `ConciergeTaskConfirmModal` — trocar por `React.lazy` e só carregar quando o gatilho de abertura é acionado.
- Ao lado do gatilho, fazer `import('...')` no `onMouseEnter` para pré-buscar o chunk (padrão "warm preload"), evitando delay perceptível ao clicar.

### 4. Navbar: observer mais barato + preload no hover

Arquivo: `src/components/app-layout.tsx`

- `IntersectionObserver` da navbar: reduzir thresholds para `[0, 1]` e manter `rootMargin: "-45% 0px -45% 0px"`. Já é suficiente para decidir a section ativa.
- Remover o `MutationObserver` sobre o `page-container` inteiro (linhas 845-853). Trocar por: reobservar quando uma section for lazy-montada — a section chama um callback exposto via contexto (`useSectionRegistry`) ao entrar no DOM. Custo passa de "toda mutação do app" para "uma vez por section".
- `scrollToSection`: eliminar o `el.scrollTo({top:0, behavior:'auto'})` inicial. Usar apenas:
  ```ts
  container.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  ```
  Isso convive com o `scroll-behavior: smooth` do CSS e evita o cancelamento em Chrome.
- Ao passar o mouse num item da navbar que aponte para uma section lazy, disparar o `import()` do chunk (mesmo mecanismo do item 3).

### 5. Persistência de scroll e seção ativa

Arquivo: `src/components/app-layout.tsx`

- Persistir `scrollTop` no `visibilitychange` / `beforeunload` em vez de a cada frame.
- Persistir `activeSection` num `useEffect` com debounce de 300 ms (hoje escreve a cada troca).

### 6. Store: seleções com `useShallow`

Arquivos: `src/routes/_authenticated.index.tsx`, `src/sections/*`

- Nos pontos que hoje fazem `useStore((s) => s.clients)` + `useStore((s) => s.products)`, migrar para `useStore(useShallow((s) => ({ clients: s.clients, products: s.products })))` e memoizar derivações com `useMemo` sobre entradas primitivas (contadores) em vez de arrays inteiras.
- No `DashboardSection`, mover o cálculo dos KPIs (`stats`) para um seletor externo memoizado que produza um objeto estável — evita recomputar em toda montagem/rolagem.

### 7. Import section: split interno

Arquivo: `src/sections/import-section.tsx` (4 331 linhas)

- Extrair o parser AI (`extractPaymentDate`, regras MGMV, wizard de importação) para módulos separados carregados sob demanda (`import()` dentro dos handlers). O JSX de UI segue no arquivo principal, mas as libs pesadas saem do bundle inicial.
- Já com a section em `React.lazy` (item 2), o custo cai duplamente.

### 8. Detalhes de qualidade

- `Dialog` (`src/components/ui/dialog.tsx`): usar `hideClose` + `onOpenAutoFocus` para não puxar scroll ao abrir.
- Adicionar `content-visibility: auto; contain-intrinsic-size: 100vh` em `.one-page-section` — o navegador pula pintura/layout de sections fora da viewport, gratuito.
- `will-change: transform` na `.floating-navbar` só quando `data-anim="on"` para reduzir composição em telas ociosas.

---

## Ordem sugerida de implementação

1. CSS: remover scroll-snap + adicionar `content-visibility` e `scroll-behavior`. (baixo risco, ganho imediato)
2. `scrollToSection` unificado usando `container.scrollTo` — corrigir a briga com o snap.
3. Navbar observer: thresholds reduzidos + remoção do MutationObserver global + registry de sections.
4. `LazySection` wrapper + migração de MGMV/Collection/Equipe/Import para `React.lazy`.
5. Modais → `React.lazy` + preload no hover.
6. `useShallow` nos seletores das sections principais.
7. Split interno do `import-section` (parser AI para módulos lazy).
8. Persistência de scroll/seção em eventos ao invés de frame.

## Como validar

- Lighthouse na `/`: TBT esperado cair para < 200 ms; LCP < 1,5 s em desktop.
- Bundle: chunk inicial da rota `/` sem `import-section`, sem `dashboard-drilldown-modal`, sem `concierge-modal`. Conferir via `vite build --debug` + `dist/assets/*.js`.
- Perfil "Performance" no Chrome durante rolagem contínua: sem long tasks > 50 ms; nenhum `MutationObserver` disparado em `page-container` durante digitação em MGMV.
- Clicar em cada item da navbar: rolagem única e suave, sem "puxão" do snap; scroll manual entre sections livre.
- Ao dar reload no meio da lista de MGMV, a página restaura scroll e section ativa sem flicker.

## Impacto esperado

- Bundle inicial da rota: ~ –55% (retirando import-section e modais).
- Tempo até interação (TTI): ~ –40% em rede rápida, muito mais em 3G/notebook fraco.
- Rolagem manual/da navbar: sem cancelamentos, animação em 60 fps.
- Nada da UI ou fluxo de trabalho muda para o usuário — só fica mais rápido.
