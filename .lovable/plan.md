# Sessão Envio/Superfrete

Nova seção entre MGMV e Collection, no mesmo padrão visual das outras (cabeçalho, cards de resumo, filtros e tabela). Foco único: clientes com produtos **pagos aguardando envio** (financeiro = Pago, situação = Em Aberto).

## Tabela de clientes

Uma linha por cliente com: nome, telefone, pasta, quantidade de itens aguardando envio, valor total desses itens e o tempo em estoque do item mais antigo (dias, com destaque em cor conforme o tempo).

Ações por linha:
- **Detalhes** — expande uma linha abaixo mostrando os produtos aguardando envio (mesmo formato de tabela usado em Clientes: nome, plataforma, valor, data, situação), sem abrir a ficha.
- **Enviar** — abre o assistente de envio.
- **Abrir ficha** — abre o modal do cliente já existente.

## Filtros

- Busca por nome/telefone.
- Mínimo de produtos aguardando envio (campo numérico: 1+, 2+, 3+, 5+ ou valor livre).
- Tempo em estoque: qualquer, 3+ dias, 7+, 15+, 30+ (contado a partir da última atualização do produto — momento em que virou Pago).
- Pasta.
- Ordenação: mais antigos primeiro, mais itens, maior valor.

Filtros ficam salvos no navegador, como nas outras seções.

## Assistente de envio (modal em etapas)

1. **Produtos e medidas** — lista dos itens aguardando envio com seleção; para cada item selecionado, peso (kg) e medidas (comprimento, largura, altura em cm). Mostra totais (peso somado e caixa cúbica estimada).
2. **Dados de envio** — remetente fixo da Star Games e destinatário preenchido automaticamente com a ficha do cliente quando existir (nome, CPF, CEP, rua, número, complemento, bairro, cidade, UF, telefone), tudo editável. Se não houver ficha, campos vazios com aviso.
3. **Método de envio** — cartões de transportadoras com preços e prazos **fictícios** calculados localmente a partir do peso/medidas: Correios PAC, Correios SEDEX, Loggi, Jadlog .Package, Azul Cargo, JeT. Nenhuma chamada a API do Superfrete.
4. **Revisão e confirmação** — resumo de itens, destinatário, transportadora e valor; botão "Confirmar envio".

Ao confirmar: os produtos selecionados passam para situação **Enviado** e o envio fica registrado no histórico (itens, peso, medidas, transportadora, prazo e valor), consultável por um botão "Histórico de envios" no topo da seção.

Regra de acesso: a ação de enviar respeita a permissão de marcar como enviado; quem não tem, vê a lista e os detalhes em modo leitura.

## Detalhes técnicos

- Nova tabela `public.shipments` (+ `shipment_items`) com `env`/`sandbox_owner`, GRANTs, RLS por ambiente e escrita exigindo `shipping.mark_sent`; auditoria e `touch_updated_at` como nas demais tabelas.
- `src/sections/envio-section.tsx` novo, agregando `useStore` (clients/products) — filtro `financialStatus === "Pago" && situation === "Em Aberto"`, agrupado por cliente; tempo em estoque via `updated_at` do produto.
- `src/components/shipment-wizard-modal.tsx` com as 4 etapas; preenchimento do destinatário via `fichaFromTextWithDefaults` de `src/lib/ficha-parse.ts`.
- `src/lib/shipping-quotes.ts` — tabela de preços/prazos fictícios (peso cubado = C×L×A/6000), puro e testável.
- `src/lib/shipments.functions.ts` — server fn autenticada que grava o envio e atualiza `products.situation` para "Enviado" numa única operação.
- Registro da seção: link em `src/components/app-layout.tsx` entre MGMV e Collection, render em `src/components/one-page.tsx` (lazy, mesma ordem), e `ListSection` ganha `"envio"` em `src/lib/list-expansion.ts`.
