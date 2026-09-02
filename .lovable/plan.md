# Verificação de integridade mostrando "0" no Dashboard

## O que está acontecendo

O card compara a contagem que está na memória do app (coluna "Dashboard") com a contagem do banco. Desde que as listas passaram a carregar sob demanda (para economizar créditos), o app abre **sem** clientes/produtos em memória. O card, porém, faz a conferência assim que monta — antes de a base terminar de carregar — e enxerga 0 x 2903, 0 x 25046, 0 x 105.

Consequências: alarme falso permanente de "3 divergências" e, pior, o card dispara sozinho um recarregamento completo do snapshot ("reconciliando automaticamente"), justamente a leitura pesada que a otimização tentou evitar.

## Correção

1. **Só conferir quando a base estiver realmente carregada.** Enquanto o carregamento não terminou, o card mostra "Carregando base para conferência…" com placeholders no lugar dos números, em vez de 0.
2. **Nunca tratar "ainda não carregado" como divergência.** A comparação (e a auto-reconciliação) só roda com a base em memória; sem isso, nada de aviso vermelho nem recarregamento automático.
3. **Botão de reconferir passa a carregar a base sob demanda** quando ela ainda não estiver em memória, e só então compara — assim a conferência continua sendo possível a qualquer momento, mas apenas quando o usuário pede.
4. **Sem laço de recarregamento:** a auto-reconciliação continua limitada a uma vez por divergência real, agora nunca acionada por base vazia.

## Detalhes técnicos

- `src/components/dashboard-integrity-card.tsx`: ler `dataLoaded`/`dataLoading` do store; o `useEffect` inicial só chama `check()` quando `dataLoaded` for verdadeiro; `rows`/`divergences`/auto-fix ficam suspensos enquanto `!dataLoaded`; o botão manual chama `ensureDataLoaded()` antes de `fetchDiagnostics()`.
- Sem mudanças de banco de dados nem em `src/lib/store.ts`.
