## Objetivo
Paginar todas as tabelas/listas das seções em passos de 10, com botão "Carregar mais" dentro da própria tabela. Ao navegar para outra seção e voltar, a contagem visível reseta para 10 (economiza render e mantém navegação fluida).

## Comportamento
- Cada tabela começa mostrando **10 itens**.
- Botão **"Carregar mais +10"** (usa `LoadMoreButton` já existente) aparece **abaixo da última linha, dentro do container da tabela**, apenas quando há mais itens.
- O botão soma +10 ao contador local até esgotar a lista filtrada.
- Ao trocar de seção (ex.: Clientes → MGMV) e voltar, o contador reinicia em 10. Filtros/busca também reiniciam o contador em 10.
- Não altera dados, filtros, ordenação nem lógica de negócio — apenas quantos itens são renderizados.

## Onde aplicar
Tabelas/listas que hoje renderizam a coleção inteira:

1. `src/sections/clientes-section.tsx` — tabela principal de clientes.
2. `src/sections/mgmv-section.tsx` — lista de MGMVs.
3. `src/sections/collection-section.tsx` — `visible = filtered` (linha 264), tabela de cobrança.
4. `src/sections/import-section.tsx` — lista de clientes agrupados por pasta (`visibleFolders` → `visible.map`, ~linha 3928). Paginar a lista plana de clientes exibidos (10 clientes por vez, mantendo agrupamento por pasta).
5. `src/sections/equipe-section.tsx` — lista de tarefas/membros do time.

Seções sem tabelas grandes (Configurações) ficam de fora.

## Implementação técnica
- Criar hook `src/hooks/use-paginated-list.ts`:
  ```ts
  export function usePaginatedList<T>(items: T[], step = 10) {
    const [count, setCount] = useState(step);
    // reset quando o tamanho/identidade da lista filtrada muda
    useEffect(() => { setCount(step); }, [items, step]);
    const visible = items.slice(0, count);
    const hasMore = items.length > count;
    const remaining = items.length - count;
    const loadMore = () => setCount(c => Math.min(c + step, items.length));
    return { visible, hasMore, remaining, loadMore };
  }
  ```
- Em cada seção, aplicar o hook na lista **já filtrada/ordenada** e trocar o `.map` para usar `visible`.
- Renderizar `<LoadMoreButton count={Math.min(10, remaining)} onClick={loadMore} />` dentro do `<tbody>` (numa `<tr><td colSpan={N}>`) ou dentro do container da lista, logo abaixo da última linha, quando `hasMore`.
- **Reset ao trocar de seção**: como cada seção é desmontada ao navegar (o `AppLayout` monta apenas a seção ativa), o `useState` local já reseta naturalmente. Se alguma seção estiver sempre montada, forçar reset com `key` na seção baseada em `activeSection` no `app-layout.tsx`.

## Fora de escopo
- Virtualização (react-window) — não necessário para o passo de 10.
- Paginação server-side / infinite scroll automático — usuário pediu botão manual.
- Persistir contagem entre navegações — usuário pediu explicitamente o oposto.