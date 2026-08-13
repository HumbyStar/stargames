# Botão "Envios" na ficha do cliente

Novo botão **Envios** na linha de botões abaixo do telefone (ao lado de "Notas Fiscais"). Abre um modal com o histórico completo de envios daquele cliente.

## O que o modal mostra

Lista de envios, do mais recente para o mais antigo. Cada envio traz:

- Data e hora do envio
- Transportadora, serviço e prazo estimado
- Valor do frete e peso total
- Destinatário completo (nome, CPF, telefone, CEP, endereço, cidade/UF)
- Itens enviados: nome, plataforma, valor, peso e medidas (C x L x A)
- Observações, quando houver

Quando não houver envios, aparece uma mensagem de vazio com dica de usar o botão "Enviar" na seleção de produtos pagos aguardando envio.

## Etiqueta / PDF de envio

Cada envio tem um botão **Baixar PDF**, que gera uma etiqueta de postagem de exemplo (MVP, sem integração com transportadora), pronta para imprimir:

- Cabeçalho com Star Games e remetente fixo
- Bloco do destinatário em destaque
- Transportadora, serviço, prazo, peso e valor do frete
- Lista dos itens do envio
- Código do envio e data
- Aviso de que é um documento de exemplo (não é etiqueta oficial)

## Detalhes técnicos

- `listShipments` (em `src/lib/shipments.functions.ts`) já aceita `clientId`; o modal usa isso via `useQuery`.
- Novo `src/components/shipment-history-modal.tsx` com a lista, os detalhes expansíveis e o botão de PDF.
- Novo `src/lib/shipping-label-pdf.ts` gerando o PDF com `jspdf` (já usado em `src/lib/nf-pdf.ts`), mesmo padrão de fonte e layout.
- Em `src/sections/clientes-section.tsx`: estado `shipHistoryOpen`, botão "Envios" após "Notas Fiscais" e render do modal junto dos demais.
