# Gerar NCM por plataforma

Sim, dá para fazer. Hoje a geração pega sempre "os próximos itens sem NCM" de todo o catálogo. A ideia é permitir escolher uma plataforma (ou todas) antes de gerar, e a IA classifica só os itens daquela plataforma — ainda em lotes internos, porque a IA precisa processar aos poucos, mas o escopo passa a ser da plataforma escolhida.

## O que muda na tela

Na aba **Gerar NCM** do modal de Produtos:
- Um seletor de plataforma no topo ("Todas as plataformas" + a lista já usada nos filtros do catálogo).
- Ao lado, a contagem de itens ainda sem NCM naquela plataforma, para saber o tamanho do trabalho antes de começar.
- O botão passa a ser "Gerar NCM (PS5)" etc., e a barra de progresso mostra o total daquela plataforma.
- Pausar/Continuar continuam funcionando; trocar a plataforma reinicia a contagem.
- Ao terminar, mensagem do tipo "Plataforma PS5 totalmente classificada".

## Detalhes técnicos

- `src/lib/product-ncm.functions.ts`: `listPendingNcmItems` ganha um campo opcional `platform` no validador e o repassa ao RPC `product_catalog` como `_platform` (o RPC já aceita esse parâmetro), mantendo `_only_missing_ncm: true`. Sem plataforma, comportamento atual (vazio = todas).
- `src/components/products-catalog-modal.tsx`: novo estado `ncmPlatform`, `Select` reutilizando `usePlatformOptions()`, contagem de pendentes via `useQuery` chamando `listPendingNcmItems` com `limit: 1` (usa o `remaining` retornado), e `runGeneration` passando a plataforma em cada chamada de lote. Ao mudar a plataforma, o progresso é zerado.
- Nenhuma mudança de banco de dados ou de migração.
