## Objetivo

Importar `.zip` do Notion, um por vez. Navegar pela(s) pasta(s) de clientes dentro do ZIP e, para **cada arquivo `*.html` que houver ali dentro**, extrair um cliente com **todas as suas tabelas**, e passar por uma camada de IA (mesmo padrão do "Revisar com IA" do MGMV) antes de persistir.

**Nota importante**: o `(3)` (ou qualquer número) que apareça no nome da pasta — ex.: `Clientes (3)` — é apenas sufixo do export do Notion e **não representa a quantidade de clientes**. A contagem sai da varredura real dos arquivos HTML dentro da pasta.

## Terminologia — regra confirmada pelo usuário

Vale só no fluxo de importação; o resto do app não muda.

| Coluna "Situação" no HTML | Estado no preview | Botão(ões) na linha |
| --- | --- | --- |
| `REMOVIDO` | cliente desistiu → linha já entra como **`Retirado`** (= "retirado do estoque" / removido) | **sem botão** — já finalizado |
| `RETIRAR` | linha entra como **`Retirar`** | um botão **"Removido"** (é o antigo botão "Retirado" — finaliza a linha para `Retirado`) |
| `DESISTIU` | linha entra como **`Abandonou`** | **"Removido"** (finaliza como `Retirado`) |
| `RETIRADO` | linha já entra como **`Retirado`** | sem botão |
| `ENVIADO` | linha entra como **`Enviado`** | sem botão |
| vazio / outros | linha entra "Em Aberto" (segue o status financeiro) | sem botão contextual |

Nenhum novo valor de `Situation` no enum. "Removido" aparece só como **rótulo do botão** de finalização dentro do preview de importação.

## Fluxo — importação por ZIP

### 1. Entrada
- Nova aba **"ZIP Notion"** em `list-import-modal.tsx`, ao lado de "Lista colada" e "HTML de cliente" (fallback avulso).
- Um `.zip` por vez, descompactado no browser com `jszip` (edge-safe; `bun add jszip`).

### 2. Navegação do ZIP
- Percorre **todas** as entradas do ZIP. Para cada entrada `*.html`:
  - Se estiver dentro de uma pasta cujo nome começa com `Cliente` ou `Clientes` (opcionalmente com sufixo tipo ` (3)` do Notion) → **é um cliente**.
  - Se o ZIP não tiver uma pasta desse tipo (ex.: HTMLs soltos), varre todos os `*.html` na raiz do ZIP como fallback.
- Para cada HTML: `parseClientHtml` (já concatena **todas** as `<table>`, respeitando `sourceGroup` dos headings intermediários). Nenhuma tabela é descartada.
- Resultado: `HtmlImportPreview[]` com um item por HTML — a quantidade sai da contagem real de arquivos, ignorando o número no nome da pasta.

### 3. Camada de IA — `src/lib/list-import-ai-zip.functions.ts`
- Server function protegida (`requireSupabaseAuth`), padrão idêntico a `mgmv-ai-review.functions.ts`.
- Input por cliente: `{ clientName, phone, rows: HtmlImportRow[], sourceGroups: string[], htmlSnippet: string }` (HTML truncado da(s) tabela(s) para evidências).
- Modelo padrão `google/gemini-3-flash-preview` (rápido/barato, mesmo do resto do app).
- Output estruturado por produto (schema Zod curto, sem enums grandes, validação em código):
  ```ts
  {
    rowId: string,
    situationSuggestion: "Retirado" | "Retirar" | "Enviado" | "Abandonou" | "Em Aberto" | "Revisar",
    financialStatusSuggestion: "Pago" | "Reserva" | "Pendente" | "Revisar",
    totalValue: number | null,
    paidValue: number | null,
    confidence: number,   // 0..1
    evidence: string[],   // trechos citados literalmente do HTML/linha
    warnings: string[],
    needsReview: boolean,
  }
  ```
- Também por cliente: `clientSummary`, `duplicateGroups`, `overallNeedsReview`.
- Evidências vão para o `audit_log` na persistência.

### 4. Preview — `zip-import-review.tsx`
- Sidebar de clientes (contador de linhas + badge "revisar IA" quando `overallNeedsReview`).
- Painel central por cliente: tabela do preview atual + colunas extras **Situação IA** e **Evidência IA**.
- Ações por linha:
  - **Lápis** → edição inline via `useRowEdit` (blur não salva, Confirmar persiste). Não abre dialog.
  - **Cérebro "Revisar com IA"** → mantém, por linha e por cliente (mesmo padrão do MGMV).
  - Botões contextuais conforme a tabela de terminologia acima.
- Barra do cliente: "Revisar todos com IA", "Aceitar sugestões IA", "Rejeitar sugestões IA".
- Confirmação final: **"Importar todos os clientes"** persiste via `store.ts`, sem `RetiradoConfirmModal` (histórico).

### 5. Persistência — `src/lib/store.ts`
- `initialSituation?: Situation` já cobre tudo (enum atual inclui `Retirado`, `Retirar`, `Abandonou`, `Enviado`, `Em Aberto`).
- Cada produto criado gera `audit_log` com `origin: "import_zip_notion"` e campo opcional `importMeta` guardando `evidence[]` + `aiConfidence`.

## Parser — `src/lib/html-client-import-parser.ts`
- `ImportedSituation`: `"Retirado" | "Retirar" | "Enviado" | "Abandonou" | null`.
- `normalizeSituation`: `REMOVIDO` → `Retirado`; `DESISTIU`/`DESISTÊNCIA` → `Abandonou`; `RETIRAR` → `Retirar`; `RETIRADO` → `Retirado`; `ENVIADO` → `Enviado`. Reaproveita `situation-normalizer`.

## Testes

- Fixture com 3 tabelas quebradas por `<h2>` → 1 cliente com todos os produtos e `sourceGroup` correto.
- Fixture de ZIP (construído via `jszip` no teste) com pasta `Clientes (3)` contendo **5** HTMLs → função de navegação retorna **5** clientes (mostra que o `(3)` do nome é ignorado e a contagem sai dos arquivos).
- Fixture de ZIP sem pasta `Clientes*`, HTMLs na raiz → varredura fallback pega todos.
- Mapeamentos de situação: `REMOVIDO`, `RETIRAR`, `DESISTIU`, `RETIRADO`, `ENVIADO`.

## Escopo mantido

- "Revisar com IA" em **Clientes e MGMV** continua exatamente como está.
- Aba "Lista colada" e aba "HTML de cliente" avulso não mudam além do enum de situações.
- MGMV / Collection / Concierge / Dashboard sem regressão.

## Diagrama

```text
[ZIP Notion]
   └─ Clientes (3)/            ← o "(3)" é só sufixo do Notion; não é contagem
        ├─ Alice.html          ┐
        ├─ Beto.html           │  parseClientHtml → todas as <table>
        ├─ Carla.html          │
        ├─ Diego.html          │
        └─ Elena.html          ┘
                 │
                 ▼
        HtmlImportPreview por cliente  (5 clientes reais, não 3)
                 │
                 ▼
        Revisão IA por cliente (evidências, sugestões, duplicatas)
                 │
                 ▼
        Preview ZIP (sidebar + tabela + lápis inline + botões)
                 │
                 ▼
        Confirmar → store.ts (initialSituation, audit_log import_zip_notion)
```

## Critérios de aceite

- Um ZIP com pasta `Clientes (3)` contendo 5 arquivos HTML gera **5** clientes (não 3).
- ZIP com HTMLs na raiz e sem pasta `Clientes*` também gera 1 cliente por HTML.
- Cada cliente tem **todas** as `<table>` do seu HTML concatenadas com `sourceGroup` correto.
- `REMOVIDO` → linha já entra `Retirado`, sem botão. `RETIRAR` → `Retirar` com botão "Removido". `DESISTIU` → `Abandonou` com botão "Removido". `RETIRADO`/`ENVIADO` → estado final, sem botão.
- "Revisar com IA" (linha e cliente) retorna sugestão + evidências citadas do HTML, com `needsReview` marcando divergência.
- Lápis abre edição inline; blur não salva; Confirmar persiste; Fechar descarta.
- Enum `Situation` inalterado; sem regressão em Clientes/MGMV/Collection/Concierge/Dashboard (testes verdes + novos testes cobrindo parser, navegação do ZIP e mapeamentos).
