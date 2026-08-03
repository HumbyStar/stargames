# Casar clientes quando falta o 9 no celular

## Problema
O export do Notion às vezes remove o 9 inicial do celular. "15 98826-7132" e "1588267132" são
a mesma pessoa, mas hoje a importação trata como dois clientes diferentes, porque a busca por
telefone compara só os dígitos exatos.

## Solução

### 1. Chave canônica de telefone
Nova função de normalização que gera, além dos dígitos crus, uma **chave canônica**:
- 11 dígitos com 9 na frente do número (DDD + 9XXXXXXXX) → chave = os 11 dígitos.
- 10 dígitos cujo primeiro dígito do número é 6/7/8/9 (celular antigo) → chave = DDD + "9" + 8 dígitos.
- 10 dígitos começando com 2–5 → fixo, chave = os próprios 10 dígitos.
- Números com 12/13 dígitos começando com 55 → remove o DDI antes de tudo.

Assim "1598826 7132" e "1588267132" produzem a mesma chave.

### 2. Busca de cliente tolerante
A busca por telefone passa a comparar primeiro pela chave canônica e só depois pelos dígitos
exatos, então a importação já encontra o cliente existente correto em vez de criar um novo.

### 3. Diálogo de conciliação (mesma lógica do nome)
Quando a chave bate mas os dígitos são diferentes, a importação mostra o cliente na etapa de
conciliação já existente ("Clientes com o mesmo número"), agora com um caso extra:

```text
Cliente existente : Junior Bredariol — 15 98826-7132
Da lista importada: Sergio Bredariol — 1588267132   (falta o 9)

[ Usar o cliente existente e corrigir o telefone ]   (padrão)
[ Manter separado — criar cliente novo ]
```
- Padrão: vincula os produtos ao cliente existente e mantém/normaliza o telefone completo.
- A decisão de nome (Manter / Atualizar) continua funcionando junto, como hoje.
- Botões "Aplicar a todos" para resolver o lote de uma vez.

### 4. Correção do telefone salvo
Quando o cliente é criado a partir de um número de 10 dígitos que é claramente celular, o
telefone salvo passa a ser a forma canônica com o 9 — evitando gerar novas duplicatas depois.

### 5. Cobertura
Vale para os três caminhos de importação: lista colada, HTML do Notion e ZIP do Notion, já que
todos usam a mesma normalização de telefone.

## Detalhes técnicos
- `normalizePhone` em `src/lib/list-import-parser.ts` ganha `canonical` e um flag `wasFixed`;
  novos testes em `list-import-parser.test.ts` cobrindo 10 vs 11 dígitos, fixo e DDI 55.
- `findClientByPhone` em `src/lib/store.ts` compara por chave canônica com fallback nos dígitos.
- `src/components/list-import-modal.tsx`: a lista de conciliação passa a marcar o motivo do
  match (`exato` | `faltando 9`) e a decisão extra "usar existente / manter separado".
- Nenhuma migração de banco; os telefones já gravados não são alterados em massa.

## Opcional (só se você quiser)
Uma varredura única na tela de Configurações que lista clientes já existentes que são duplicata
por causa do 9 faltando, com botão para unificar.
