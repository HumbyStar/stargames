# Placeholders de carregamento no Dashboard (nada de "0" falso)

## Problema confirmado
Em `src/components/one-page.tsx`, enquanto a consulta de agregados não responde, o dashboard usa um objeto padrão com todos os campos em `0` e renderiza esses zeros nos cards. Por isso, ao recarregar, a tela abre mostrando "0" em Total Clientes, Reservas Ativas, etc., e só depois troca pelos números reais.

## O que será feito

### 1. Placeholder de carregamento nos cards
- O card de métrica passa a aceitar um estado "carregando": em vez do número, mostra uma barrinha animada (skeleton) no lugar do valor.
- Enquanto os agregados não chegarem, todos os 9 cards mostram o placeholder — nunca "0".
- Mesmo tratamento para os dois gráficos (Status Financeiro e Situação dos Produtos): barras neutras em skeleton até os dados chegarem, sem desenhar 0%.
- Os Alertas Operacionais só aparecem depois dos dados; enquanto carrega, uma linha de placeholder.

### 2. Abrir já com os valores certos (rápido)
- Os últimos valores carregados ficam guardados no navegador, separados por ambiente (produção / modo teste).
- Ao recarregar, o dashboard mostra imediatamente os últimos valores conhecidos (sem piscar zeros) e atualiza em silêncio assim que a consulta responde.
- Na primeira vez (sem valores guardados), mostra os placeholders.
- Regra pedida: se um valor vier como 0 e ainda houver carregamento em andamento, mantém o placeholder; quando a carga terminar e o valor realmente for 0, aí sim exibe 0.

### 3. Tela de carregamento (splash)
- A splash com o avatar deixa de sair antes da hora: ela se mantém até o primeiro retorno dos agregados (com um limite curto de segurança, ~1,2s), para que o sistema abra já com números e não com valores nulos.

## Detalhes técnicos
- `src/components/ui-bits.tsx`: `MetricCard` ganha a prop `loading`; usa `Skeleton` de `@/components/ui/skeleton` no lugar do valor. `StackedBar` ganha estado de carregamento.
- `src/components/one-page.tsx`: remove o objeto zerado como fallback; usa dados iniciais vindos de cache local (`localStorage`, chave por ambiente via `useSandbox`) e passa `loading={aggregatesQuery.isPending && !cached}` aos cards; grava o resultado no cache quando a consulta responde.
- `src/components/hydration-splash.tsx`: aguarda o primeiro sucesso da query `dashboard-aggregates` (ou timeout curto) antes de fechar.
- Sem mudanças de banco de dados nem de regras de negócio.