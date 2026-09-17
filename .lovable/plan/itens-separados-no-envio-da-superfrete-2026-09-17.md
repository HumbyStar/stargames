# Itens separados no envio da SuperFrete

## Objetivo
Exibir e enviar cada produto em uma linha própria na declaração de conteúdo da SuperFrete, com sua descrição, quantidade e valor individual, como nas imagens enviadas.

## Alterações
- Substituir a linha única de resumo por uma lista com um registro para cada produto selecionado.
- Usar em cada linha a descrição revisada daquele produto, quantidade `1` e o valor próprio do item.
- Garantir que a soma dos valores das linhas seja exatamente igual ao valor total declarado e ao seguro contratado.
- Manter a descrição resumida apenas no histórico interno do envio, sem usá-la como uma linha única na SuperFrete.
- Separar tecnicamente os itens declarados das caixas/volumes, para que um envio com vários produtos e uma ou mais caixas preserve peso, medidas e preço da cotação atual.
- Manter a opção já existente de salvar as descrições editadas como padrão dos produtos.

## Validação
- Testar um e vários produtos, confirmando uma linha por item e o valor individual correto.
- Testar uma e várias caixas, garantindo que a cotação e a criação da etiqueta continuem usando os mesmos volumes.
- Validar que o total declarado e o seguro coincidam mesmo quando houver valores com centavos.
- Confirmar que o histórico registra as descrições efetivamente usadas no envio.
