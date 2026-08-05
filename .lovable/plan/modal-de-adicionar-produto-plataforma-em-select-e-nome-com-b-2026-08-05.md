# Modal de Adicionar Produto: plataforma em select e nome com busca

## O que muda

### 1. Plataforma vira um select
- No modal de Adicionar/Editar Produto, o campo "Plataforma" deixa de ser texto livre e passa a ser uma lista.
- A lista combina:
  - plataformas padrão (PS5, PS4, PS3, PS2, Xbox, Nintendo, Colecionável);
  - todas as plataformas que já aparecem nos produtos cadastrados;
  - plataformas cadastradas manualmente pelo usuário.
- A última opção é "+ Adicionar plataforma...". Ao escolher, aparece um campo para digitar o nome; ao confirmar, a plataforma é salva, fica disponível para os próximos cadastros e já é selecionada no produto atual.
- Duplicatas são evitadas (ignora maiúsculas/minúsculas e espaços extras).
- O filtro "Plataforma" da tela de clientes passa a usar a mesma lista, no lugar da lista fixa atual.

### 2. Nome do produto com busca ao digitar
- O campo "Nome do produto" vira um campo com sugestões, no mesmo estilo da busca da navbar.
- Ao digitar, aparecem os produtos já existentes que combinam com o texto (nome + plataforma como referência), ordenados pelos mais usados/recentes.
- Ao clicar numa sugestão, o nome é preenchido e a plataforma daquele produto é aplicada automaticamente (se ainda não tiver sido escolhida).
- Se o texto digitado não existir, ele é aceito normalmente como produto novo — nada é bloqueado.
- Teclado funciona: setas para navegar, Enter para escolher, Esc para fechar.

## Detalhes técnicos

- Persistência das plataformas customizadas: novo campo `customPlatforms: string[]` em `SystemPreferences` (`src/lib/store.ts`), salvo via `setPreferences` → `app_settings.preferences`, respeitando o isolamento produção/sandbox existente.
- Novo helper `src/lib/platforms.ts`: constantes padrão, normalização e `usePlatformOptions()` combinando padrões + plataformas dos produtos + `preferences.customPlatforms`.
- Novo componente `src/components/product-name-combobox.tsx`: input + sugestões usando `Command`/`Popover` de `src/components/ui`, com debounce e a mesma função de match da busca atual.
- `ProductModal` em `src/sections/clientes-section.tsx`: troca o input de plataforma pelo select + fluxo "adicionar plataforma", e o input de nome pelo combobox. Sem mudanças em regras de negócio, status financeiro ou datas.
- O filtro de plataforma da lista de clientes passa a renderizar as opções de `usePlatformOptions()`.