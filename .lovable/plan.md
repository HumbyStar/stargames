## Objetivo

Exibir o **valor efetivamente pago** de cada parcela do MGMV nas listas de parcelas, para que pagamentos parciais (inferiores ou superiores ao valor da parcela) e parcelas marcadas como pagas mostrem exatamente quanto entrou.

## Regra de exibição

Para cada parcela, calcular `pagoNaParcela`:

- Se `i.paid === true` → `i.paidAmount ?? i.value` (quando marcada paga sem parcial anterior, considera o próprio `value` como pago; em quitação curta o `paidAmount` já traz o valor real recebido).
- Senão, se `(i.paidAmount ?? 0) > 0` → `i.paidAmount` (parcial em andamento).
- Senão → `0` (renderizar como `—` para não poluir).

Formatação com `formatBRL`. Alinhamento numérico (`tabular-nums`).

## Onde mudar

### 1. `src/sections/clientes-section.tsx` (tabela real `<table>`)

Cabeçalho atual: `Parcela | Vencimento | Valor | Status | Pagamento | Ações`.

Adicionar **nova coluna `Valor pago` entre `Status` e `Pagamento`**:

```text
Parcela | Vencimento | Valor | Status | Valor pago | Pagamento | Ações
```

- Novo `<th>` "Valor pago".
- Nova `<td className="py-2 pr-3 tabular-nums">` com o valor calculado, ou `<span className="text-muted-foreground">—</span>` quando 0.
- Adicionar `colSpan` correspondente se houver alguma linha de estado vazio (verificar rapidamente ao editar).

### 2. `src/sections/mgmv-section.tsx` (lista com `flex` — visualmente uma tabela)

A linha de cada parcela hoje tem: `#N/T`, `valor`, `vencimento`, `tag de status`, e (condicional) botões de ação.

Inserir **entre a tag de status e os botões de ação** um novo `<span className="tabular-nums">` com o `pagoNaParcela` formatado. Quando 0, exibir `—` em `text-muted-foreground` para manter o alinhamento visual em todas as linhas (inclusive quando os botões não aparecem, porque estão dentro de um bloco condicional — o span de valor pago fica **fora** do condicional, sempre visível).

## Não muda

- Lógica de pagamento parcial em `store.ts`.
- Tags existentes (`Paga`, `Parcial`, `Vencida`, `Pendente`, `Recalculada`, `Paga (parcial curto)`).
- Coluna `Pagamento` do clientes-section (continua sendo a data `paidAt`).
- Testes.

## Arquivos

- `src/sections/clientes-section.tsx` — nova coluna na `<table>` de parcelas.
- `src/sections/mgmv-section.tsx` — nova célula na lista flex de parcelas.

## Validação

Visual: abrir cliente MGMV com mix de parcelas (paga integral, parcial em curso, quitação curta com `shortPaid`, pagamento superior redistribuindo, pendente) e conferir que a nova coluna mostra o valor correto em cada caso.
