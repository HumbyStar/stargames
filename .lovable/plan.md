# Descrições editáveis na Nota Fiscal e no SuperFrete

## Objetivo
Permitir uma descrição padrão por produto, reutilizada automaticamente, mas ajustável em cada Nota Fiscal ou envio sem alterar obrigatoriamente o padrão salvo.

## Implementação

### 1. Descrição padrão do produto
- Adicionar aos produtos um campo opcional de descrição padrão.
- Quando não houver descrição cadastrada, usar o nome atual do produto como sugestão inicial.
- Preservar o nome original do produto; a descrição será um campo separado.

### 2. Nota Fiscal
- Antes de montar o texto final, exibir os itens selecionados com uma descrição editável para cada produto.
- Preencher cada campo com a descrição padrão ou, na ausência dela, com o nome do produto.
- Permitir salvar a descrição editada como novo padrão do produto por uma opção explícita; sem essa opção, a alteração valerá somente para a nota atual.
- Usar as descrições ajustadas no texto da nota, no PDF e no conteúdo salvo no histórico.
- Manter NCM, categoria fiscal, quantidade e valores funcionando como hoje.

### 3. SuperFrete
- Gerar automaticamente uma descrição resumida a partir das descrições padrão dos produtos selecionados.
- Exibir esse resumo no fluxo de envio para revisão e edição antes da cotação/compra.
- Enviar a descrição revisada à SuperFrete no lugar dos nomes genéricos “Pacote” ou “Caixa N”, preservando dimensões, peso, quantidade de caixas, seguro e valores.
- Quando houver várias caixas, manter a identificação de cada volume e incluir o resumo dos produtos de forma compatível com o limite aceito pela SuperFrete.
- Oferecer a mesma opção explícita para salvar ajustes como padrão dos respectivos produtos; caso contrário, eles valerão apenas para o envio.

### 4. Histórico e compatibilidade
- Salvar na Nota Fiscal e no envio exatamente a descrição confirmada naquela operação, para que históricos antigos não mudem quando o padrão do produto for alterado depois.
- Manter notas, envios e produtos existentes compatíveis; registros sem descrição continuam usando o nome do produto.
- Atualizar os tipos de dados e os pontos de leitura/gravação afetados.

### 5. Validação
- Testar descrição padrão, ajuste temporário e atualização do padrão.
- Testar nota, PDF, histórico, cotação e compra de etiqueta com um e vários produtos/volumes.
- Validar textos vazios, caracteres especiais e o tamanho máximo aceito pela SuperFrete, aplicando resumo seguro sem cortar palavras quando necessário.

## Detalhes técnicos
- Alteração estrutural na tabela de produtos para armazenar a descrição padrão, com os acessos existentes preservados.
- A Nota Fiscal continuará armazenando seu conteúdo final como texto, garantindo compatibilidade com o histórico e a auditoria atuais.
- O envio continuará guardando os itens internos no histórico e passará a registrar também a descrição efetivamente enviada à transportadora.
