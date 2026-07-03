# Import HTML de cliente (Notion) — 1 arquivo por vez

## Objetivo

Adicionar um segundo caminho de importação, ao lado do "Lista Colada" já existente, que:
- Lê um arquivo HTML exportado do Notion (ex.: `Hadi_-_47_9986-8265_....html`).
- Identifica **um único cliente** a partir do `<h1>` / `<title>` (nome + telefone).
- Varre **todas as `<table>`** do arquivo — mesmo quando a lista "quebra" em vários blocos com heading intermediário (ex.: `LOTE FECHADO MEU GAME MINHA VIDA`) — e concatena tudo como produtos do mesmo cliente.
- Preserva o grupo/lote de cada bloco (`sourceGroup`) para rastreio.
- Reaproveita o preview de revisão, os totais e a persistência já usados pela Lista Colada.

Sem alterar: importação por lista colada, MGMV, Collection, Concierge, Dashboard, layout.

## Regras de mapeamento (fechadas com o usuário)

- **Cliente**: nome + telefone extraídos do `<h1>`/`<title>` no formato `Nome - (DD) NNNNN-NNNN`. Telefone passa pelo mesmo `normalizePhone` do parser atual.
- **Colunas por linha** (7): `Item | Plataforma/Categoria | Valor total | Valor Pago | Status financeiro | Data | Situação operacional`. Tabelas sem `<thead>` são tratadas por posição (é o caso das duas primeiras tabelas do arquivo do Hadi).
- **Valor**: `parseMoney` reaproveitado (aceita `R$ 90`, `90 R$`, `R$ 100,00`, `-` → null).
- **Status financeiro** → `ListFinancialStatus`:
  - `PAGO` → `Pago`
  - `Reserva Paga` / `Reserva` → `Reserva` (com `paidValue` da coluna respectiva; sem valor → `review_required`)
  - `pendente` → `Pendente`
  - `-` / vazio → `Revisão necessária`
- **Situação operacional** (coluna 7):
  - `REMOVIDO` → produto entra já como `Retirado` (histórico finalizado, sem popup de confirmação — decisão do usuário).
  - `ENVIADO` → situação concluída/entregue (mapeada via `situation-normalizer` para o equivalente atual de "enviado").
  - vazio → situação "aberta" padrão (Pago/Reserva/Pendente segue o status financeiro).
- **Grupo**: cada `<h1>`/`<h2>`/`<h3>` intermediário vira `sourceGroup` das tabelas seguintes. Tabelas antes de qualquer heading extra ficam em `(sem grupo)`.
- **Review flags**: telefone inválido, valor total ausente, Reserva sem valor pago, e qualquer status/situação não reconhecidos marcam a linha como `review_required` — mesmo comportamento do parser de texto.

## Detalhes técnicos

### 1. Novo parser — `src/lib/html-client-import-parser.ts`
- Usa `DOMParser` (browser) para percorrer o HTML.
- Exporta `parseClientHtml(rawHtml: string): ListImportPreview` reaproveitando os tipos `ListImportRow`, `ListImportClientGroup`, `ListImportPreview` de `list-import-parser.ts`.
- Extrai cliente do primeiro `<h1>` (fallback: `<title>`) via regex `^(.+?)\s*-\s*(.+)$`.
- Itera `document.body.querySelectorAll('h1, h2, h3, table')` em ordem para manter `currentGroup`.
- Para cada `<tr>`: pega até 7 células, mapeia por posição, monta `ListImportRow` com `clientName`/`phone` do cabeçalho do arquivo (não da linha), gera `id`, `warnings`, `reviewStatus`.
- Extensão mínima do tipo: adicionar campo opcional `situation?: "Retirado" | "Enviado" | "Aberto"` em `ListImportRow` para carregar a coluna 7 até a persistência (usado só pelo caminho HTML; parser de texto continua não populando).
- Testes em `src/lib/html-client-import-parser.test.ts` cobrindo: extração de cliente do `<h1>`, 3 tabelas concatenadas, heading intermediário virando `sourceGroup`, `REMOVIDO`→`Retirado`, `Reserva Paga` com valor, `-` sem valor, telefone `(47) 9986-8265` normalizado para 11 dígitos.

### 2. UI — novo modo no modal de importação
- `src/components/list-import-modal.tsx`: adicionar aba/tab "HTML de cliente" ao lado da atual "Lista colada".
- Nova aba: `<input type="file" accept=".html,text/html">` + textarea de fallback para colar HTML.
- Ao carregar, chama `parseClientHtml` e alimenta o **mesmo componente de preview** já usado pela Lista Colada (tabela editável, contadores de totais, marcação `review_required`, ações "ignorar linha"). Nenhuma tela nova de preview.
- Botão "Confirmar importação" reaproveita o mesmo caminho de persistência do fluxo de texto, com a única diferença: passa `situation` de cada linha para o `store.ts` na criação do produto, para que `REMOVIDO` já entre como `Retirado` sem acionar o `RetiradoConfirmModal`.

### 3. Persistência — `src/lib/store.ts`
- Extender a função de criação de produto usada pelo import para aceitar `initialSituation` opcional. Quando presente, gravar `situation` direto (`Retirado` ou `Enviado`) e registrar `audit_log` com origem `import_html`. Quando ausente, comportamento atual não muda.
- **Não** alterar regras de MGMV, Collection, ou o fluxo `Abandonou → Retirar → Retirado` do dia a dia — a exceção só existe no caminho de import de histórico.

### 4. Fora de escopo desta entrega
- Upload múltiplo de HTMLs (o usuário escolheu "um por vez").
- Persistir o HTML original no `import_history` (pode entrar em follow-up se necessário).
- Alterações no parser de lista colada existente.

## Diagrama do fluxo

```text
[HTML do Notion]
       │
       ▼
parseClientHtml
       │
       ├── cliente <- <h1>/<title>
       └── produtos <- todas as <table>, agrupados por heading
       │
       ▼
ListImportPreview (mesmo tipo de hoje) + campo situation por linha
       │
       ▼
Preview de revisão existente (Lista Colada)
       │
       ▼
Confirmar → store.ts cria cliente + produtos
             REMOVIDO -> situation=Retirado (sem popup)
             ENVIADO  -> situation=Enviado
             demais   -> fluxo padrão
```

## Critérios de aceite

- Importar o arquivo do Hadi cria **1 cliente** com **as 3 tabelas concatenadas** (23 + 15 + 18 linhas descontando cabeçalhos/headers vazios), respeitando os `sourceGroup` dos headings intermediários.
- Linhas com `REMOVIDO` aparecem no cliente com situação `Retirado`, sem abrir o popup de confirmação.
- Linhas com `ENVIADO` entram como concluídas/enviadas.
- Linhas com `Reserva Paga` mantêm `paidValue` da coluna correspondente; `-` gera `review_required`.
- Telefone `(47) 9986-8265` é normalizado e válido.
- Parser de Lista Colada, MGMV, Collection, Concierge, Dashboard e layout não sofrem regressão (typecheck + testes existentes continuam verdes; novos testes cobrindo o parser HTML).
