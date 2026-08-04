# Corrigir sumiço dos itens do MGMV, modal de quitação e persistência do Modo Teste

## O que está acontecendo (confirmado)

- O carregamento de produtos está estourando o tempo limite do banco: o console mostra `canceling statement due to statement timeout` em `loadProducts`. A tabela de produtos tem 47.319 linhas (23.660 delas do modo teste) e o app lê **todas** de uma vez, sem filtrar por ambiente, com a regra de visibilidade avaliada linha a linha.
- Como a leitura falha, o app fica sem produtos: por isso a tabela "Itens incluídos no MGMV" desaparece mesmo com acordo ativo (ela só é exibida quando existem produtos MGMV carregados) e o modal de quitação não tem o que mostrar.
- O modal de conclusão hoje fecha ao clicar fora ou com ESC, então não "trava" a tela como você pediu.

## O que será feito

### 1. Voltar a carregar os produtos (causa raiz)
- A leitura passa a filtrar explicitamente pelo ambiente atual (produção ou modo teste) e, no modo teste, pelo dono do sandbox — em vez de varrer as 47 mil linhas e deixar a regra de acesso filtrar depois.
- Páginas menores, leitura em sequência controlada e nova tentativa automática quando o tempo se esgota.
- Índices de apoio no banco para o filtro por ambiente/dono, para a consulta usar índice em vez de varredura completa.
- Enquanto os produtos não chegam, a ficha mostra "carregando" em vez de esconder a tabela — nenhum bloco some silenciosamente por falha de leitura.

### 2. Tabela "Itens incluídos no MGMV" sempre visível com acordo ativo
- Com acordo ativo e não concluído, o bloco aparece sempre (produção e modo teste), mesmo com lista vazia ou carregando, com a mensagem correspondente.
- Ao confirmar a quitação, os itens continuam migrando para "Histórico de Produtos — Individuais" como Pago / Em Aberto, e o bloco do MGMV some.

### 3. Modal de quitação bloqueante
- Quando todas as parcelas estiverem pagas, o modal abre por cima de tudo (inclusive da ficha do cliente) e passa a ser bloqueante: não fecha ao clicar fora, não fecha com ESC e não tem "X"; a saída é só por "Revisar parcelas", "Cancelar" ou "Confirmar quitação".
- Enquanto estiver aberto, o restante da interface fica inerte.
- Comportamento idêntico em produção e no modo teste.

### 4. Modo Teste guardando o último estado
- Cada edição no modo teste continua gravada no ambiente do próprio usuário, e o app reabre no último estado salvo daquele ambiente: o cache por ambiente é reidratado ao entrar/sair do modo teste sem depender de uma releitura completa que pode falhar.
- Se uma leitura falhar, o app mantém o último estado conhecido daquele ambiente em vez de zerar as listas.

## Detalhes técnicos

- `src/lib/db-sync.ts`: `fetchAllRows` ganha filtro por `env` (e `sandbox_owner` no sandbox), páginas de 500 e retry com backoff no erro `57014`; `loadSnapshot` deixa de sobrescrever o estado com listas vazias quando um carregamento falha, retornando sinalizador de falha parcial.
- Migração: índices compostos `(env, sandbox_owner)` e `(env, client_id)` em `products` e nas demais tabelas grandes com o mesmo padrão de leitura.
- `src/lib/store.ts`: aplica merge preservando o cache do ambiente em falha parcial; `envSnapshots` reidratado ao trocar de ambiente.
- `src/components/mgmv-complete-modal.tsx`: `DialogContent` com `onInteractOutside`/`onEscapeKeyDown` prevenidos e sem botão de fechar.
- `src/sections/clientes-section.tsx`: bloco "Itens incluídos no MGMV" condicionado ao acordo ativo (não a `mgmvProducts.length > 0`), com estados de carregando/vazio.