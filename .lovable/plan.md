# Envio/SuperFrete: tabela com scroll e cards compactos no assistente

## Tabela da seção Envio

- A lista de clientes passa a ter a mesma altura máxima das demais seções (Clientes, MGMV, Collection): container com altura limitada (~28rem) e barra de rolagem interna, mantendo o cabeçalho da página fixo em relação à página.
- Assim a navegação entre seções fica fluida, sem a tabela empurrando o restante da página.

## Ver detalhes com seleção

- Ao expandir "Ver detalhes" de um cliente, cada produto ganha uma caixa de seleção, além de "selecionar todos".
- Por padrão todos os itens aguardando envio ficam marcados.
- O botão "Enviar" abre o assistente já com exatamente os produtos marcados naquela linha; se nada estiver marcado, ele abre com todos (comportamento atual).

## Cards de produto no modal de envio

- Etapa 1 do assistente passa a usar cards compactos e modernos: uma linha só com seleção, nome, plataforma e valor, mais um resumo curto do peso/medidas atuais.
- Cada card ganha um botão "Ver detalhes" que expande a área de peso (kg) e medidas (comprimento, largura, altura).
- O primeiro card já vem expandido, para preencher medidas imediatamente; os demais ficam fechados.
- O resumo do pacote combinado (peso real, cubado e dimensões) continua no rodapé da etapa.

## Detalhes técnicos

- `src/sections/envio-section.tsx`: envolver a tabela em `div.table-scroll-y max-h-[28rem] overflow-x-auto` com borda, como em `collection-section.tsx`; novo estado `selectedByClient: Record<string, Set<string>>` alimentando os checkboxes do detalhe e passado ao wizard.
- `src/components/shipment-wizard-modal.tsx`: nova prop opcional `initialSelectedIds?: string[]` usada no reset ao abrir; estado `expandedCard: Set<string>` iniciado com o primeiro produto selecionado; card compacto com toggle "Ver detalhes" (chevron) em vez de expandir só por estar marcado.
- `src/sections/clientes-section.tsx`: passa os ids já selecionados na ficha como `initialSelectedIds` (hoje já filtra os produtos, então é só encaminhar).
