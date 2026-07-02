## Objetivo

Trocar o loading atual (`AppLayout`, linhas 1206-1215 de `src/components/app-layout.tsx`):

```
[spinner circular] Carregando dados…
```

por uma tela apresentando o Concierge (SVG do mascote) com balão de fala e barra de progresso que avança conforme as mensagens giram. Reduz frustração percebida sem esconder o carregamento real.

## Comportamento

1. Enquanto `hydrated === false`:
   - À esquerda, o SVG do Concierge (`src/assets/tutorial-mascot.svg.asset.json`) entra com `animate-scale-in` e um leve `float` contínuo (keyframe já disponível ou uma classe utilitária local).
   - À direita, um balão de fala (bubble com cauda apontando para o mascote) exibe uma fila de frases com fade/slide entre elas.
   - Abaixo do balão: barra de progresso (`div` com largura interpolada) que avança em passos discretos a cada troca de frase.
2. Primeira frase (entrada, dura ~1.6s):
   - `Bem-vindo(a), {primeiroNome}! Vamos otimizar seu trabalho?`
   - Se nome indisponível, cai para `Bem-vindo(a) de volta!` sem travar a UI.
3. Frases seguintes (cada uma ~1.2s, mais curta se a hidratação terminar antes):
   - `Carregando tabelas e clientes…`
   - `Preparando cobranças em aberto…`
   - `Carregando MGMV e acordos ativos…`
   - `Sincronizando importações recentes…`
   - `Ajustando o Concierge para o seu dia…`
   - `Como está seu dia até agora?` (frase leve, humaniza)
4. Progress bar:
   - Cresce em incrementos fixos por frase (ex.: 100/N).
   - Nunca chega a 100% enquanto `hydrated` for `false`; ao hidratar, completa até 100% com transição curta (~250ms) e faz `fade-out` para o app.
   - Se a hidratação demorar mais que a fila, a última frase permanece e a barra fica em ~92% pulsando, evitando falsa promessa de conclusão.
5. Acessibilidade:
   - `role="status"` + `aria-live="polite"` no balão.
   - `aria-label` no progress com `aria-valuenow`/`aria-valuemax`.
   - Respeita `prefers-reduced-motion`: sem float, sem slide — só troca instantânea de texto.

## Nome do usuário

- Buscar antes/junto da hidratação, sem bloquear:
  - `supabase.auth.getUser()` → `user.user_metadata.full_name` (padrão usado em `admin-users.functions.ts`).
  - Fallback: `profiles.display_name` via `supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()` (padrão já usado em `team.functions.ts`, `punch.functions.ts`).
  - Fallback final: `user.email?.split("@")[0]`.
- Extrair primeiro nome: `fullName.trim().split(/\s+/)[0]`.
- Cache leve em `sessionStorage` (`sg_display_name`) para eliminar flicker em navegações subsequentes.

## Arquivos

- **Novo** `src/components/hydration-splash.tsx`
  - Props: `progress?: number` (opcional, default calculado internamente), `userName?: string | null`.
  - Contém: mascote (`<img src={mascotAsset.url} alt="Concierge" />`), balão com fila de frases, progress bar semântica, listener de `prefers-reduced-motion`.
  - Timer com `setInterval` limpa em unmount; passo mínimo garantido mesmo se hidratação terminar imediatamente.
- **Edição** `src/components/app-layout.tsx` (linhas 1199-1215)
  - Remover markup do spinner atual.
  - Chamar hook local `useHydrationUserName()` (definido no mesmo `hydration-splash.tsx`) que resolve o nome de forma assíncrona sem bloquear o render inicial.
  - Renderizar `<HydrationSplash userName={name} />` no lugar.
- **Sem alterações** em `src/integrations/supabase/client.ts` (auto-gerado) nem em `tutorial-mascot.svg.asset.json`.

## Estilo

- Segue tokens semânticos existentes (`bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`).
- Balão: `rounded-2xl bg-card border border-border shadow-lg` com cauda via `::before` triangular apontando para o mascote.
- Mascote: `size-40 md:size-48`, com filtro sutil (`drop-shadow`) para destacar.
- Animações: usa `animate-fade-in` / `animate-scale-in` já disponíveis; float feito com uma classe utilitária local (`@keyframes float` inline em `<style>` do próprio componente para não poluir `styles.css`).

## Detalhes técnicos

- `HydrationSplash` recebe `hydrated` via prop opcional? Não — o `AppLayout` já decide se renderiza o splash; o splash apenas conduz a barra até ~92% e completa quando desmontar (o próprio unmount é o sinal de sucesso; a animação de saída fica no `AppLayout` com `animate-fade-out` de wrapper condicional durante ~250ms antes de trocar).
- Para evitar flash de sub-100ms sem experiência: se `hydrated` virar `true` em <400ms, ainda mostrar a saudação por 400ms mínimos antes de sumir (evita “piscada”). Não fica preso: usa `Math.max(0, 400 - elapsed)`.
- Nenhuma chamada de server fn nova. Reutiliza cliente supabase existente.

## Verificação

- Build (`tsgo`), abrir preview, forçar reload — confirmar mascote + saudação com nome real.
- Testar com `prefers-reduced-motion: reduce` no DevTools.
- Testar signed-out: cai no fallback `Bem-vindo(a) de volta!` sem erro.
