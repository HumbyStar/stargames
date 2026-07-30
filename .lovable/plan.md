## Objetivo
Garantir que, no Modo Teste, toda restauração de backup comece de um ambiente completamente zerado — sem restos da restauração anterior e sem qualquer conflito com a produção.

## Situação atual (verificada no código)
- A restauração no sandbox só apaga dados quando o usuário escolhe "Substituir tudo" e digita REPLACE; o padrão é "mesclar", então importações sucessivas acumulam dados.
- Mesmo em "Substituir tudo", a limpeza cobre apenas as tabelas presentes no ZIP/selecionadas — tabelas fora dessa lista continuam com dados antigos do teste.
- O isolamento em si já está correto: destino decidido no servidor, ids regerados, tabelas globais (perfis/papéis) nunca tocadas, produção nunca apagada.

## Implementação

### 1. Limpeza total automática no sandbox
- Quando o destino for SANDBOX, apagar **todas** as tabelas com dados de teste antes de inserir, independentemente do que existe no ZIP ou da seleção de tabelas.
- A limpeza segue a ordem inversa de dependências (dependentes primeiro) e é sempre restrita ao ambiente de teste.
- Nunca tocar em produção, perfis, papéis, permissões e auditoria.

### 2. Modo de aplicação simplificado em teste
- No sandbox, "mesclar" deixa de existir na prática: toda aplicação é "ambiente zerado + carga do backup".
- Remover a exigência de digitar REPLACE quando o destino é o teste (não há risco real), mantendo a exigência integral na produção.
- Ajustar os textos do modal para deixar claro: "O ambiente de teste será zerado antes de carregar este backup".

### 3. Importação manual de clientes no teste
- Manter o mesmo comportamento de isolamento já existente, e oferecer no painel do Modo Teste um botão explícito de "Zerar ambiente de teste" para começar uma comparação limpa antes de uma importação manual (lista/ZIP de clientes).

### 4. Verificação
- Aplicar o mesmo backup duas vezes seguidas no teste e confirmar contagens idênticas (sem duplicação).
- Aplicar backups diferentes em sequência e confirmar que não restam registros do anterior.
- Conferir no registro de auditoria que as contagens de produção permanecem inalteradas antes e depois.

## Arquivos principais
- `src/lib/backup.functions.ts` — limpeza total do ambiente de teste antes da carga.
- `src/components/restore-backup-modal.tsx` — modo e textos no destino SANDBOX.
- `src/components/sandbox-settings-card.tsx` — ação de zerar o ambiente de teste.
