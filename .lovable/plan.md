# Corrigir o rótulo "Sandbox" no Envio / SuperFrete

## Por que aparece "Sandbox"

O texto não vem da API: é um rótulo fixo escrito no código, deixado da época dos testes.

- Em Configurações, o card "Envio / SuperFrete" tem o selo `status="Sandbox"` e o resumo "…(ambiente Sandbox)" gravados manualmente.
- A integração em si já está apontando para produção: a configuração do servidor usa `https://api.superfrete.com/api/v0` como padrão e só cai para sandbox se a variável `SUPERFRETE_ENVIRONMENT=sandbox` existir — e ela foi removida.

Ou seja, o sistema opera em produção; só a etiqueta na tela ficou desatualizada.

## O que será feito

1. Trocar o selo fixo do card de Configurações por um selo dinâmico que mostra "Produção" ou "Sandbox" conforme o ambiente real informado pelo servidor.
2. Ajustar o resumo do card para não citar Sandbox.
3. Mostrar o mesmo indicador de ambiente dentro da tela "Origem do envio (SuperFrete)", ao lado do saldo, para nunca mais haver dúvida sobre qual API está em uso.
4. Usar cor de destaque diferente quando estiver em Sandbox (aviso) e neutra/positiva em Produção.

## Detalhes técnicos

- Fonte da verdade: o campo `environment` já retornado por `getSuperfreteBalance` (`src/lib/superfrete.functions.ts`), que lê `getSuperfreteConfig()` em `src/lib/superfrete.server.ts`.
- `src/lib/use-superfrete-balance.ts` já expõe esse valor no hook; basta consumi-lo.
- Alterações: `src/components/shipping-origin-card.tsx` (badge de ambiente ao lado do saldo) e `src/sections/configuracoes-section.tsx` (linhas do `SecondaryCard` de Envio / SuperFrete: `status` e `summary`).
- Sem mudanças de banco, de token ou de comportamento das chamadas à SuperFrete.
