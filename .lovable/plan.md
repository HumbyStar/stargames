## Importação por Lista Colada — Plano

Nova modalidade de importação independente das existentes (ZIP/HTML e MGMV). Toda a lógica vive em arquivos novos, sem alterar parsers/fluxos atuais.

### 1. Parser (`src/lib/list-import-parser.ts`, novo)

- Função `parseListText(raw: string): ListImportPreview`
- Reconhece cabeçalhos `Grupo X:` / `Grupo <nome>:` (regex `^Grupo\s+.+:\s*$`, case-insensitive).
- Para cada linha não vazia abaixo de um grupo, faz split por ` - ` mas trata o produto como "miolo" entre telefone e plataforma/categoria:
  1. campo 0 = cliente
  2. campo 1 = telefone bruto
  3. último = status
  4. penúltimo = valor
  5. antepenúltimo = plataforma/categoria
  6. campos 2..N-3 unidos por ` - ` = produto
- Normalização de telefone: remove não-dígitos; valida 10 ou 11 dígitos.
- Valor: aceita `60 reais`, `R$ 60`, `60,00`, `R$60,00`.
- Status:
  - `PAGO` → `valorPago = valorTotal`, restante = 0
  - `RESERVA (N)` → `valorPago = N`, restante = total - N
  - `RESERVA` sem valor → `reviewStatus = review_required`, motivo "Valor pago da reserva não informado"
- Cada linha gera `ListImportRow` com `confidence` (1.0 quando tudo bate, decrementa por aviso), `warnings[]`, `reviewStatus`, `sourceGroup`.
- Agrupamento de clientes: chave `nome+telefone` normalizados. Detecta `duplicateCandidate` quando nome igual com telefones diferentes ou telefone igual com nomes variantes.

### 2. Modal (`src/components/list-import-modal.tsx`, novo)

Modal grande seguindo padrão visual (Dialog + cards + tabela). Estados internos via `useState`:

- `rawText`, `preview`, `activeFilter`, `selectedRowIds`, `aiReviewingId`.
- Topo: textarea + botão **Analisar lista** + sample placeholder.
- Após análise:
  - Grid de cards (`ImportCardsGrid` + `ImportCard`) com filtros clicáveis:
    Grupos detectados, Linhas analisadas, Clientes únicos, Produtos capturados, Pagos, Reservas, Valor total/pago/aberto, Telefones válidos/erro, Duplicatas, Revisão necessária, Erros de leitura.
  - Tabela com colunas pedidas, ações por linha (Editar/Revisar IA/Ignorar/Confirmar). Edição inline em popover; recálculo automático ao salvar a edição.
  - Rodapé: Cancelar / Salvar somente válidos / Salvar tudo revisado / Salvar todos com confirmação.

Estado temporário fica só dentro do componente; ao fechar/salvar limpa tudo (sem tocar store).

### 3. Revisão com IA

- Nova server function `src/lib/list-import-ai.functions.ts` com `requireSupabaseAuth`, usa AI Gateway (modelo `google/gemini-3-flash-preview`) e retorna `ListImportAIReview` via `Output.object` (Zod).
- Botão "Revisar com IA" na linha → chama a server fn com a linha bruta + contexto do grupo; resultado preenche um diff que o usuário aceita/recusa.

### 4. Persistência

- Ao confirmar: para cada cliente único, `upsert` em `clients` (match por telefone normalizado); para cada produto, `insert` em `products` com:
  - `valor_total`, `valor_pago`, `valor_restante`, `status_financeiro`, `situacao` (PAGO→`Aguardando envio`, RESERVA→`Em Aberto`).
  - Campos novos: `source_group TEXT`, `source_import_type TEXT` (`'list_text'`), `import_batch_id UUID`.
- Nova tabela `list_import_batches` (id, user_id, totals, created_at) para histórico. RLS por `auth.uid()`, GRANTs adequados.

### 5. Integração na seção Importação

- Em `src/sections/import-section.tsx`, adicionar uma terceira aba/cartão "Importar por lista colada" que apenas abre o `<ListImportModal />`. Nenhuma alteração nos parsers existentes.

### Migração de BD

```sql
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source_group TEXT,
  ADD COLUMN IF NOT EXISTS source_import_type TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

CREATE TABLE public.list_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  total_lines INT, valid_lines INT, error_lines INT,
  clients_created INT, products_created INT,
  total_value NUMERIC, paid_value NUMERIC, open_value NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- + GRANTs + RLS por user_id
```

### Testes (Vitest)

`src/lib/list-import-parser.test.ts` cobre: grupos, produto com hífen, PAGO, RESERVA (N), RESERVA sem valor, telefone inválido, agrupamento por cliente, duplicatas.

### Fora de escopo (não tocar)

- Importação ZIP/HTML, MGMV, Concierge, Dashboard, navbar, tutorial.

### Critério de aceite

Todos os 21 itens da seção 24 do brief verificados manualmente no preview após implementação.
