# Dados Meta — extração de leads para campanhas

Nova página dedicada (aberta a partir de um card no modal de Configurações) para filtrar a base de clientes e exportar listas prontas para o Meta Business.

## Acesso

- Card "Dados Meta" em Configurações, visível apenas para **admin** e **admin_master**.
- A página fica em `/dados-meta` (área autenticada) e valida o papel também no servidor — quem não for admin recebe "acesso restrito".

## Como a tela funciona

Layout em duas partes:

```text
┌─ Filtros (painel lateral) ─┐ ┌─ Resultado ─────────────────────┐
│ Tipo de cliente            │ │ 412 clientes  •  318 com ficha  │
│ Total comprado (min/max)   │ │ 94 com ficha incompleta         │
│ Região (UF / cidade / CEP) │ │                                 │
│ Tempo como cliente         │ │ [tabela paginada 20 em 20]      │
│ Status / situação          │ │ nome | tel | UF | total | itens │
│ ... filtros sugeridos      │ │                                 │
│ [Aplicar]  [Limpar]        │ │ [Exportar ▾]                    │
└────────────────────────────┘ └─────────────────────────────────┘
```

Contadores no topo sempre mostram: total encontrado, quantos têm ficha completa e quantos têm ficha incompleta (com a lista de campos faltando por cliente).

## Filtros

Pedidos:
- **Total comprado** — faixa mínima/máxima (soma dos produtos do cliente).
- **Região** — UF, cidade e faixa de CEP (extraídos da ficha do cliente).
- **Telefone** — tem telefone válido / DDD específico / apenas celular.
- **Tempo como cliente** — desde a data de cadastro (ex.: mais de 6 meses).
- **Tipo de cliente** — MGMV, comum ou ambos.
- **Status** — situação dos produtos (Em Aberto, Enviado, Retirado…) e status financeiro (Pago, Pendente, MGMV).

Sugeridos (todos opcionais, desligados por padrão):
- **Recência**: última compra nos últimos X dias / sem comprar há mais de X dias (reengajamento).
- **Frequência**: número de produtos comprados (1 compra, 2–5, 6+).
- **Ticket médio** por produto.
- **Plataforma preferida** (PlayStation, Nintendo, Steam…) — ótimo para segmentar criativos.
- **Valor em aberto / inadimplência**: excluir quem tem pendências, ou criar público só de devedores.
- **MGMV**: acordo ativo, quitado ou em atraso.
- **Já recebeu envio** (tem etiqueta gerada) — público de recompra.
- **Completude da ficha**: tem e-mail, tem CPF, tem endereço completo.
- **Pasta/origem** do cliente.
- **Excluir clientes duplicados** (mesmo telefone normalizado).

## Exportação

Botão "Exportar" com as quatro opções:
1. **CSV Meta Ads (Customer List)** — colunas no padrão oficial: `email, phone, fn, ln, ct, st, zip, country, madid, extern_id`. Telefone em E.164 (+55…), UF em minúsculo, país `br`.
2. **CSV completo (analítico)** — todos os campos da ficha + métricas (total comprado, nº de produtos, ticket médio, primeira e última compra, tempo como cliente, tipo, plataformas).
3. **XLSX** — duas abas: `Aptos` e `Ficha incompleta` (esta com a coluna "campos faltando").
4. **Copiar telefones** — lista normalizada para a área de transferência.

Controles do export:
- **Toggle SHA-256**: exporta os campos identificáveis já com hash (normalizados antes: minúsculas, sem acento, telefone só dígitos) ou em texto puro.
- **Toggle "incluir fichas incompletas"**: decide na hora se os incompletos entram no arquivo (sempre separados em aba/arquivo próprio, nunca misturados).
- Nome do arquivo com data e resumo do filtro aplicado.
- Registro no log de auditoria de quem exportou, quantos registros e quais filtros — dado sensível (CPF, endereço) sai do sistema.

## Detalhes técnicos

- Rota `src/routes/_authenticated.dados-meta.tsx` + seção `src/sections/dados-meta-section.tsx`; card de entrada em `src/sections/configuracoes-section.tsx` (mesmo padrão dos cards existentes).
- `src/lib/meta-export.functions.ts` (server function com `requireSupabaseAuth` + verificação de `admin`/`admin_master` via `has_role`): faz a query agregada de `clients` + `products` no ambiente atual (`current_env`), aplica os filtros em SQL e devolve página de 20 em 20 para a tabela; um endpoint separado devolve o conjunto completo só no momento do export.
- Parse da ficha reutiliza `parseFichaFromText`/`fichaFromTextWithDefaults` de `src/lib/ficha-parse.ts` para extrair nome, CPF, UF, cidade, CEP, e-mail. Nenhum uso de IA e nenhum crédito consumido.
- `src/lib/meta-export-format.ts` (puro, testável): normalização Meta, hash SHA-256 via `crypto.subtle`, geração de CSV e XLSX, e a regra de "ficha completa" (nome + telefone + e-mail ou CPF + UF/cidade).
- Sem alteração de schema: tudo é leitura sobre `clients`, `products`, `mgmv_agreements` e `shipments` já existentes. Um índice de apoio pode ser avaliado depois se a consulta ficar lenta.
- Testes unitários para normalização/hash/completude da ficha.
