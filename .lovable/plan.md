## Problema

O `FinanceDashboard` (aberto pelo botão "Finanças" na navbar) lê `clients` e `products` direto do `useStore`, então já reage a mutações locais. Porém o store é hidratado **uma única vez** via `loadSnapshot()` no `hydrate()` de `src/lib/store.ts` (linha 424). Não há assinatura Realtime do Supabase — mudanças feitas em outra aba, dispositivo, ou reconciliações do backend não aparecem até um reload manual. Por isso o modal exibe números que não batem com o único cliente atual.

## Solução

Adicionar sincronização Realtime das tabelas `clients`, `products`, `mgmv_agreements` e `mgmv_installments`. Ao receber qualquer evento (`INSERT`/`UPDATE`/`DELETE`), refazer o snapshot (debounced) e atualizar o store — isso propaga automaticamente para o `FinanceDashboard` (e todas as demais telas que lêem do store).

### Passo 1 — Habilitar Realtime nas tabelas (migração)

Nova migração adicionando as tabelas à publicação `supabase_realtime` (idempotente):

```sql
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mgmv_agreements;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mgmv_installments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

RLS existente das tabelas já protege quem recebe eventos.

### Passo 2 — Nova função `subscribeRealtimeSnapshot` em `src/lib/db-sync.ts`

Exporta uma função que abre um canal Supabase com `on('postgres_changes', ...)` para as 4 tabelas, e agenda uma re-hidratação debounced (~600ms) via callback. Retorna cleanup.

```ts
export function subscribeRealtimeSnapshot(onRefresh: () => void): () => void {
  let timer: number | null = null;
  const schedule = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(onRefresh, 600);
  };
  const channel = supabase
    .channel("realtime-store")
    .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, schedule)
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, schedule)
    .on("postgres_changes", { event: "*", schema: "public", table: "mgmv_agreements" }, schedule)
    .on("postgres_changes", { event: "*", schema: "public", table: "mgmv_installments" }, schedule)
    .subscribe();
  return () => {
    if (timer) window.clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}
```

### Passo 3 — Nova ação `refreshFromDb` no store (`src/lib/store.ts`)

Adiciona `refreshFromDb: () => Promise<void>` que chama `loadSnapshot()` e faz `set({ clients, products, importHistory })` — sem tocar em preferences/rules/security (o usuário pode ter mudanças locais em UI-only). Aplica o mesmo fix retroativo de situation em MGMV que o `hydrate` já faz.

### Passo 4 — Wire-up no bootstrap de auth

Em `src/routes/__root.tsx` (ou onde `hydrate()` já é chamado após login), depois do primeiro hidrate bem-sucedido, chamar `subscribeRealtimeSnapshot(() => useStore.getState().refreshFromDb())` e guardar o cleanup no `useEffect` return.

Vou identificar o ponto exato lendo `__root.tsx` no momento da implementação — o hook deve rodar apenas do lado cliente e apenas quando houver sessão autenticada (para evitar assinatura sem RLS válido).

## Fora de escopo

- Nenhuma mudança visual no modal Finanças.
- Não altero a lógica de cálculo dos KPIs — se após real-time os números continuarem "errados", isso vira uma investigação separada de fórmula.
- Não adiciono realtime para `team_tasks`, `import_history`, `audit_log` etc.
