# Produto some da lista e verificação de integridade mostrando 0 produtos

## O que foi confirmado no banco e no código

- A base de produção tem 23.727 produtos (47.391 no total, contando o modo teste). A tabela de clientes é bem menor (5.516).
- A verificação de integridade conta produtos **sem filtrar o ambiente**: é uma contagem exata sobre a tabela inteira, avaliada linha a linha pela regra de visibilidade. Nessa escala ela estoura o tempo limite, o erro é engolido e o card exibe `0` — exatamente o "-23729 no banco" do print. Clientes e acordos, por serem pequenos, respondem a tempo e aparecem "OK".
- A leitura completa do snapshot pagina produtos em blocos de 1000 **sem ordenação estável** (`range(from,to)` sem `order`). Sem ordem definida, o banco pode devolver a mesma linha em duas páginas e pular outra — e, com uma inserção acontecendo em paralelo, a linha nova é justamente a que pode ficar de fora. É a causa direta do produto aparecer e sumir depois.
- Quando uma página falha, o snapshot é marcado como `partial`, mas a proteção atual só preserva a lista anterior se a leitura voltar **completamente vazia**. Uma leitura parcial (ex.: 12 mil de 23 mil) substitui a lista e apaga produtos da tela.
- A marcação de mutação local que protege o item recém-criado expira em 15 segundos; depois disso, qualquer releitura incompleta remove o produto.

## Correções

### 1. Contagem de integridade correta e honesta
As contagens passam a ser filtradas por ambiente (e, no modo teste, pelo dono), usando os índices já existentes `products_env_owner_idx` / `clients_env_owner_idx`. Se ainda assim uma contagem falhar, o card mostra "não foi possível verificar" em vez de `0` — nunca mais um falso alarme de divergência com o banco cheio.

### 2. Paginação estável (fim do sumiço)
A leitura paginada passa a ordenar por `id` e a avançar por chave (`id > último id lido`) em vez de deslocamento numérico. Isso elimina linhas duplicadas/puladas, deixa cada página com custo constante (hoje o custo cresce a cada página) e reduz muito o risco de tempo limite.

### 3. Leitura incompleta nunca apaga a tela
Quando o snapshot vier parcial, o resultado é **mesclado** com o que já está em memória (as linhas ausentes são mantidas) em vez de substituir a lista. Só um snapshot completo pode remover itens.

### 4. Atualização em tempo real sem recarregar tudo
Ao criar/editar um produto, em vez de disparar a releitura da base inteira, o app relê apenas os produtos daquele cliente e mantém a marcação local até o banco confirmar a linha. A releitura completa continua existindo, mas apenas como reconciliação de fundo.

### 5. Sem "timeout" percebido pelo usuário
Com filtro por ambiente + paginação por chave + mesclagem em leituras parciais, o snapshot deixa de depender de uma varredura completa da tabela, que é o que hoje leva ao erro de tempo limite e ao pedido de "atualizar snapshot".

## Detalhes técnicos

- `src/lib/db-sync.ts`
  - `dbFetchDiagnostics`: aplicar `.eq("env", env)` (+ `sandbox_owner` no modo teste) em todas as contagens `head`, e retornar `null` em vez de `0` quando a consulta falhar.
  - `fetchAllRows`: `.order("id", { ascending: true })` + paginação por chave (`.gt("id", lastId)`), mantendo o recuo de página em caso de erro `57014`.
- `src/components/dashboard-integrity-card.tsx`: tratar contagem `null` como "indisponível" (aviso neutro, sem contabilizar divergência) e manter o botão de recarregar.
- `src/lib/store.ts`: substituir `keepOnPartial` por uma mesclagem por id quando `snap.partial` for verdadeiro (mantém itens locais ausentes da leitura parcial); em `addProduct`/`updateProduct`, disparar releitura direcionada do cliente e estender a marca de mutação até a confirmação da linha.
- Testes em `src/lib/db-sync.test.ts` / `src/lib/store.test.ts`: paginação por chave não duplica nem pula linhas; snapshot parcial não remove produto existente; contagem com erro não vira zero.