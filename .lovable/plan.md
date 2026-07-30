## Diagnóstico

O erro `Failed to execute 'insertBefore' on 'Node'` não vem da lógica do sistema — é o padrão clássico de conflito entre o **tradutor automático do navegador** e o React.

Evidência verificada:
- Em `src/routes/__root.tsx` o documento é declarado como `<html lang="en">`, enquanto todo o conteúdo do sistema está em português.
- Com isso o Chrome/Edge detecta "página em outro idioma" e traduz automaticamente: ele substitui os nós de texto por nós próprios (dentro de `<font>`), e quando o React tenta atualizar aquele mesmo texto (badges de status, rótulos de botões — exatamente o que aparece no topo da pilha: `badge`, `button`) o nó original já não é mais filho do pai, e a renderização quebra.
- A própria mensagem de erro do relatório chegou traduzida ("em botão", "na seção"), confirmando que a página foi traduzida no navegador.

## O que será feito

1. **Idioma correto do documento** (`src/routes/__root.tsx`)
   - `<html lang="pt-BR">`, eliminando o gatilho de tradução automática.

2. **Bloquear tradução da UI da aplicação**
   - Adicionar `translate="no"` no `<html>` e a meta `google: notranslate`, para que extensões/tradutores não reescrevam a árvore React.

3. **Endurecer os pontos frágeis de texto dinâmico**
   - Nos componentes de badge e botão usados nas seções (status, contadores), garantir que texto dinâmico esteja sempre dentro de um elemento próprio (`<span>`) em vez de nó de texto solto irmão de outros nós — isso torna a árvore resistente mesmo se o usuário forçar a tradução manualmente.

4. **Recuperação automática do Error Boundary**
   - Em `src/components/global-error-boundary.tsx`, detectar especificamente erros de `insertBefore`/`removeChild` (`NotFoundError`) e fazer uma remontagem automática da subárvore uma vez, em vez de mostrar a tela "Algo travou por aqui". Assim, mesmo num caso residual, o usuário não perde a tela.

## Detalhes técnicos

- Alterações concentradas em `src/routes/__root.tsx` (shell/head), `src/components/global-error-boundary.tsx` (retry automático com contador para evitar loop) e ajustes pontuais de marcação em `src/components/ui/badge.tsx` e nos usos que renderizam texto condicional dentro de botões nas seções.
- Nenhuma mudança em lógica de negócio, banco de dados ou cálculos financeiros.
- Validação: build + carregamento da página no navegador headless simulando tradução (injeção de nós `<font>`) para confirmar que a UI não quebra mais.
