## Objetivo

Criar em **Configurações → Instalar Sistema (Windows)** uma forma de rodar o Star Games localmente no PC, com os dados atualizados, funcionando sem internet e sem banco na nuvem. Se a internet ou o banco caírem, você continua cadastrando/editando localmente e depois gera um **backup ZIP no mesmo formato do sistema** para validar no Modo Teste e importar de volta na produção.

## Como vai funcionar (visão do usuário)

1. Em Configurações aparece um card novo **"Instalar Sistema (Windows)"** mostrando: status da instalação, data do último pacote local, quantos registros estão salvos no PC e se o pacote está desatualizado.
2. Botão **"Instalar no Windows"** → o navegador instala o sistema como aplicativo (ícone na área de trabalho, abre em janela própria, sem barra do navegador).
3. Botão **"Baixar dados agora"** → o sistema verifica o último backup; se estiver desatualizado (ou não existir), **gera um backup novo automaticamente** e usa ele para montar o banco local. Barra de progresso igual à dos backups.
4. Offline, o app abre normalmente com uma faixa **"MODO LOCAL — sem conexão"**. Você navega em Clientes, MGMV, Cobrança, Finanças e pode **criar e editar** registros; tudo é gravado no banco local do PC.
5. Botão **"Exportar backup local (.zip)"** → gera um ZIP idêntico ao formato de backup do sistema, já com suas alterações offline. Esse ZIP você sobe no **Modo Teste** para validar e depois importa na produção pelo fluxo que já existe.
6. Quando a conexão volta, o card mostra o que foi alterado offline e oferece "Exportar para reimportar" (sem sincronização automática, para não sobrescrever nada sem sua conferência).

## Escopo técnico

**1. Instalação (PWA)**
- Manifest + ícones (usar o mascote já existente em `src/assets/favicons/`), `display: standalone`, tema alinhado à identidade da onepage.
- Service worker gerado por `vite-plugin-pwa` (`generateSW`, `autoUpdate`), registrado só em produção, nunca no preview/iframe/dev, com kill-switch `?sw=off`. Navegações em `NetworkFirst`, assets hasheados em `CacheFirst`.

**2. Banco local**
- Novo módulo `src/lib/local-db.ts`: IndexedDB com um object store por tabela do backup (mesmas tabelas de `BACKUP_TABLES`), mais um store `meta` (versão do schema, data do pacote, contagens) e um store `local_changes` (fila de alterações offline: tabela, id, operação, payload, timestamp).

**3. Pacote de dados**
- Nova server fn `prepareLocalPackage`: verifica o backup mais recente; se for mais antigo que o limite (ou o banco tiver mudado desde então), dispara `executeBackupNow`, aguarda o término e devolve a URL assinada do ZIP.
- Download no cliente + leitura do `manifest.json` e dos `.jsonl` (mesmo leitor já usado no restore) → gravação em lotes no IndexedDB, com progresso por tabela para não travar a UI.
- Excluir do pacote local: `audit_log`, `notion_html_access_log` e o espelho de arquivos HTML (peso alto, sem uso offline).

**4. Leitura/escrita offline**
- `src/lib/store.ts` ganha uma fonte alternativa: quando offline (ou "Modo Local" ligado), o snapshot vem do IndexedDB em vez do Supabase; o Realtime fica desligado.
- As escritas passam a gravar no IndexedDB e registrar a operação em `local_changes` quando não há conexão. Sem sincronização automática — o caminho de volta é sempre pelo ZIP.

**5. Exportação compatível**
- `src/lib/local-backup-export.ts`: monta o ZIP no cliente com `manifest.json` (mesmo `schemaVersion`), `summary.json`, `RESTORE.md` e `database/data/<tabela>.jsonl`, aplicando as alterações offline. Assim o arquivo é aceito sem mudanças pelo fluxo atual de validação e restauração (incluindo o dry-run do sandbox).

**6. UI**
- `src/components/local-install-card.tsx` (card em Configurações, no padrão visual dos cards de Backup/Sandbox: badges de status, progresso por etapa, ações).
- Faixa "MODO LOCAL" no `app-layout`, reaproveitando o estilo da faixa do Modo Teste.

## Limitações que valem registrar

- Os arquivos HTML originais (acervo Notion) não ficam offline — apenas os dados das tabelas.
- Usuários/papéis vão no pacote apenas para leitura; login offline usa a sessão local já autenticada, sem criar usuários novos.
- Alterações offline nunca sobem sozinhas: sempre passam pelo ZIP → Modo Teste → produção, como você pediu.
