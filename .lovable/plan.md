## Resposta curta sobre a página própria

Vale a pena — mas por clareza, não por segurança. O isolamento real vem do banco (coluna de ambiente + regras de acesso + ids regerados), e ele funciona igual estando na mesma tela ou em outra. O ganho de uma página própria `/sandbox` é operacional: URL diferente, layout com moldura de aviso permanente, impossível "esquecer" que está no teste, e dá para deixar duas abas do navegador abertas (uma produção, uma teste) sem confundir. Recomendo fazer: página própria **e** o isolamento reforçado no servidor.

## Escopo

### 1. Limite de envio 500 MB
- ZIP enviado direto na importação por backup passa de 250 MB para 500 MB, com validação no cliente e no servidor, e mensagem clara quando exceder.
- Backups já salvos na nuvem continuam sem limite (não passam pelo navegador).

### 2. Página própria do Modo Teste (`/sandbox`)
- Nova rota `src/routes/_authenticated.sandbox.tsx` (admin/admin_master; quem não for é redirecionado).
- Layout próprio com moldura/faixa fixa "MODO TESTE — produção intocada" sempre visível, e o app inteiro (Clientes, MGMV, Collection, Finanças, Equipe, Importação, Backups) renderizado dentro dela sobre os dados de teste.
- Em Configurações, o card atual vira o ponto de entrada: "Abrir Modo Teste" leva para `/sandbox`; "Sair" volta para `/`.
- Entrar/sair da página liga/desliga o modo no servidor e dispara a recarga em tempo real (sem F5).
- Se alguém abrir `/sandbox` sem o modo ativo, a própria página ativa; ao sair da página, o modo é desligado — não fica ligado por acidente.

### 3. Importação exclusiva por backup/ZIP, com isolamento total

Novo card "Importar de backup (ZIP)" na seção Importação, disponível nos dois ambientes.

Garantias (o núcleo da entrega):
1. **Destino decidido no servidor**, a partir do estado de sandbox do usuário. Não existe parâmetro de ambiente vindo do navegador.
2. **No sandbox, todos os ids são regerados** e as ligações entre tabelas (cliente → acordo → parcelas → produtos → NF → tarefas) reescritas com o mesmo mecanismo da clonagem. Nenhum id do backup entra como está, então é impossível sobrescrever uma linha de produção.
3. **Toda gravação carimba o ambiente de destino** — o ambiente gravado no ZIP é descartado.
4. **Exclusões sempre filtradas por ambiente**: "substituir tudo" no sandbox apaga só o sandbox.
5. **Trava final antes de cada lote**: o servidor confere que todas as linhas têm o ambiente de destino e que nenhum id colide com produção; divergência aborta sem gravar nada.
6. **Modo padrão é mesclar**, preservando o que já existe no sandbox.
7. Papéis, perfis e log de auditoria não são tocados quando o destino é sandbox.

UI do card: upload de `.zip` (até 500 MB) ou escolha de backup salvo, selo de destino calculado no servidor ("Destino: SANDBOX — produção não será alterada"), prévia com contagem por tabela e comparação com o estado atual, escolha mesclar/substituir com confirmação digitada, progresso por tabela e atualização em tempo real ao final.

## Detalhes técnicos

- `src/lib/backup.functions.ts`: destino por ambiente, remapeamento de ids reutilizando `CLONE_ORDER`/`remapRow`, delete filtrado por ambiente, verificação pré-gravação, limite 500 MB.
- Novo `src/components/backup-import-card.tsx`; integração em `src/sections/import-section.tsx`.
- Nova rota `src/routes/_authenticated.sandbox.tsx` + ajuste em `src/components/sandbox-settings-card.tsx` e `src/components/app-layout.tsx` (faixa passa a viver na página).
- O painel de Backups em Configurações passa a usar a mesma rotina segura, eliminando o caminho antigo sem filtro de ambiente.
- Sem alteração de schema no banco.
