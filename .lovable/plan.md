## Objetivo
Quando o Modo Teste estiver ativo, o aviso não deve existir só na página `/sandbox`: **todas as seções e todos os modais** ganham a mesma moldura tracejada laranja, e o bloco “MODO TESTE — produção intocada / Sair do Modo Teste” passa a viver **dentro da navbar flutuante**.

## Como será feito

### 1. Marcador global de ambiente
- O provedor de sandbox passa a marcar o documento (atributo em `<html>`, ex. `data-env="sandbox"`) sempre que o modo teste estiver ativo, e remove ao sair.
- Isso vale tanto na rota dedicada `/sandbox` quanto em qualquer outra tela com o modo ligado — um único sinal para toda a interface.

### 2. Estilo tracejado laranja em seções e modais
- Em `src/styles.css`, com o marcador ativo:
  - cada seção da one-page (`.one-page-section` e o bloco de clientes) recebe borda tracejada âmbar, cantos arredondados e fundo âmbar bem suave — idêntico ao que hoje existe só na moldura do `/sandbox`;
  - todo conteúdo de diálogo (`[role="dialog"]`, cobrindo Dialog, AlertDialog, Sheet, Command e todos os modais listados) recebe a mesma borda tracejada âmbar;
  - cada modal exibe um selo discreto “MODO TESTE” no topo, via pseudo-elemento, sem precisar editar 20 arquivos de modal.
- Cores vindas de tokens/utilitários já usados no projeto (âmbar), com contraste válido em tema claro e escuro.

### 3. Bloco de saída dentro da navbar
- O bloco marcado hoje renderizado acima da one-page em `/sandbox` sai dali e vira um componente “pílula de Modo Teste” montado **dentro da navbar flutuante** (`FloatingNavbar`), à direita dos controles, visível em qualquer rota enquanto o modo estiver ativo.
- Conteúdo: ícone de frasco, texto “MODO TESTE” (com a explicação “produção intocada” em telas maiores) e o botão “Sair do Modo Teste”, que continua desligando o ambiente e recarregando os dados.
- No modo compacto/mobile a pílula reduz para ícone + “Sair”, sem quebrar o layout da navbar.
- A faixa `SandboxBanner` atual (topo da página) é removida para não duplicar o aviso.

### 4. Ajuste da página `/sandbox`
- A moldura tracejada da rota deixa de ser um caso especial: ela passa a usar o mesmo estilo global, e o cabeçalho interno com o botão de sair é retirado, já que essa função vai para a navbar.

## Verificação
- Com o modo teste ligado: navbar mostra a pílula com “Sair do Modo Teste”; todas as seções (dashboard, clientes, MGMV, cobrança, importação, equipe, configurações) e todos os modais (finanças, cliente, backups, restauração, NF, IA etc.) aparecem com a borda tracejada laranja.
- Com o modo teste desligado: nenhuma borda âmbar, nenhuma pílula, layout idêntico ao atual.

## Arquivos principais
- `src/lib/use-sandbox.tsx` — marcador global de ambiente.
- `src/styles.css` — regras tracejadas para seções e diálogos.
- `src/components/app-layout.tsx` — pílula na navbar, remoção da faixa antiga.
- `src/routes/_authenticated.sandbox.tsx` — simplificação da moldura da rota.
