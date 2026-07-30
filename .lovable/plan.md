## Situação

O envio do código-fonte para o GitHub não é feito por código dentro do app — é a **sincronização nativa do Lovable**, que só você pode acionar (uma vez). Depois disso, tudo que mudar aqui vira commit no repositório automaticamente, e todo push lá volta pra cá.

Como você não tem certeza se já está conectado, o caminho é verificar e conectar.

## Passo a passo (você faz, leva ~2 minutos)

1. No chat, clique no botão **+** (canto inferior esquerdo do campo de mensagem).
2. Escolha **GitHub**.
   - Se aparecer o nome de um repositório, **já está conectado** — anote qual é.
   - Se aparecer **Connect project**, ainda não está.
3. Clique em **Connect project** e autorize o app do Lovable no GitHub.
4. Escolha a conta ou organização onde o repositório deve viver.
5. Clique em **Create Repository**.

Sobre o nome **StarGames.app**: o Lovable cria o repositório com o nome do projeto. Se ele nascer com outro nome, é só renomear depois no GitHub em **Settings → General → Repository name** — a sincronização continua funcionando normalmente.

## Depois de conectado

- Cada alteração feita aqui vira um commit no repositório, com autor e data.
- Para dar acesso a outras pessoas: no GitHub, **Settings → Collaborators** (repo pessoal) ou um **Team** (se for de organização), com papel Read / Write / Admin.
- Recomendação: se o repositório for da empresa, crie uma **organização** gratuita no GitHub e conecte lá, para o projeto não ficar preso a uma conta pessoal.

## O que fica de fora agora

Conforme você definiu, o card "Conectar conta GitHub" em Configurações (publicação de backups, exports CSV e changelog no repositório) **fica parado por enquanto** — o código já existe no projeto e só precisa do token quando você quiser ativar.

## Detalhes técnicos

Nenhuma alteração de código é necessária para esta etapa. `src/lib/github.functions.ts`, `src/lib/github.server.ts` e `src/components/github-card.tsx` permanecem como estão, inertes até que o secret `GITHUB_TOKEN` seja configurado.

## O que eu faço quando você aprovar

Como a ação depende inteiramente do menu do GitHub no chat, aprovar este plano serve para eu acompanhar: me diga o que apareceu no passo 2 e eu te oriento a partir dali (incluindo renomear o repositório para StarGames.app ou ativar o card de publicação).
