## Erros encontrados nessa lista

**1. Duas pessoas coladas na mesma linha (mais grave)**
- Última linha: `soldier - 13 99805-6851 - Pure Vessel (Hollow Knight) - Figure - 80 reais  - Pago  Zanon - 44 9984-8236 - Dragon Quest XI: Echoes of an Elusive Age - PS4 - 90 reais -  Reserva`
- Hoje vira **um único registro errado**: cliente "soldier", produto engolindo "Pago Zanon - 44 9984-8236 - Dragon Quest XI…", e o **Zanon desaparece sem aviso**.

**2. Falta de plataforma/categoria**
- `Paulo - 11 98504-6889 - Controle de PS2 - 50 reais - Reserva` → só 5 campos; o parser assume "Controle de PS2" como plataforma e o produto fica vazio.

**3. Espaço duplo antes do status / traço colado**
- Nascimento Denilson (`-  Pago`), Filipe Rodrigues (`-  Reserva`), José Carlos Loures/Controle PS4 (`-  Reserva`), Fábio Viana (`40 reais  - Pago ` com espaço final), Caio Felipe (`80 reais  - Pago`), Fábio Viana/Uchiha Sasuke (`150 reais  - Pago`), Gaby Anad (`130 reais  - Reserva(65)`), Zanon (`-  Reserva`).

**4. Espaço no início da linha**
- ` Sousa Diego`, ` soldier` → nome entra com espaço e cria cliente "diferente" de um já existente.

**5. Status em minúsculo**
- `reserva` (Sousa Diego, CODE).

**6. Reserva com valor colado**
- `Reserva(65)` (Renan Oliveira, Gaby Anad) — sem espaço; o padrão é `Reserva (65)`.

**7. Telefones com 10 dígitos (provável 9 faltando)**
- Pedro Paulo, Filipe Rodrigues, Ângela, João Paulo, Nathanael, Philippe, José Carlos Loures, Priscilla, Caio Brá, Wendel Brasil, Marcos Paulo, Bruna Mendes, Weslley Lara, Renan Silva, felipe/Felipe, Gustavo (99), Kimberly, Rafa, Gaby Anad, Sousa Diego, Gabriel Victor, André Cipolini, OSCAR MATEU, Zanon.

**8. Mesmo cliente escrito de formas diferentes**
- `felipe` e `Felipe` (mesmo 34 9771-2600) → risco de duplicar cliente. Também `OSCAR MATEU`, `CODE`, `Netao` (caixa inconsistente, só alerta).

**9. Repetições suspeitas**
- Yury Marcello (11 95973-5933) 5x com "Lote de jogos - PS2/PSP" quase idêntico (50/50/50/60) → precisa de confirmação humana.

**10. Cabeçalho solto**
- `PASSADOS` na primeira linha — ignorar sem virar erro.

---

## O que vou implementar

Tudo cai na **tela de revisão antes de importar**: nada é salvo automaticamente, cada linha corrigida fica visível, marcada e **editável** antes da confirmação.

### A. Corte automático de linhas coladas
Em `src/lib/list-import-parser.ts`, pré-passagem antes do parse:
- Âncora de status: **depois de `Pago` / `Reserva` / `Reserva (x)` / `Pendente` / `MGMV`, o que vier a seguir é um NOVO registro** → quebra a linha ali.
- Reforço por telefone: um segundo padrão `DD 9xxxx-xxxx` no meio da linha confirma o ponto de corte.
- As duas partes viram linhas normais com o aviso "linha dividida automaticamente (2 clientes na mesma linha)" — o Zanon volta a aparecer.

### B. Normalização de ruído
- `trim`, colapso de espaços múltiplos e de `-\s{2,}` para `" - "`.
- Status em qualquer caixa; `Reserva(65)`, `Reserva 65`, `Reserva - 65` viram Reserva com pago 65.
- Nome normalizado só para comparação (não duplicar `felipe`/`Felipe`), preservando o texto original no campo editável.

### C. Falta de plataforma vira aviso claro
- Linha com exatamente 5 campos → `review_required` com aviso **"Plataforma/categoria ausente — informe antes de importar"**, plataforma preenchida com `—` e o produto correto mantido (hoje o produto fica vazio).

### D. Revisão e edição antes de importar
No modal de lista colada (`src/components/list-import-modal.tsx`):
- Bloco de resumo no topo: quantas linhas foram divididas, quantas sem plataforma, telefones curtos, duplicidades.
- Cada linha problemática destacada, com o trecho original visível e **todos os campos editáveis** (nome, telefone, produto, plataforma, valor, status) usando os controles de edição por linha já existentes — confirmar/fechar por linha, nada salva sozinho.
- Botão de importar só habilita quando não houver linha em estado de erro; linhas em "revisão" exigem seu OK explícito.

### E. Prompt da IA mais rígido
Em `src/lib/list-ai-analyze.functions.ts` e `src/lib/list-import-ai.functions.ts`:
- Regra explícita: "tudo depois do status pertence a um NOVO cliente, mesmo na mesma linha".
- Regras de linha grudada, espaço duplo, traço colado, status minúsculo, `Reserva(x)`, plataforma ausente.
- Cada correção descrita em `fixes` (ex.: "linha 47 dividida em 2 clientes").
- Telefone com 10 dígitos: sinalizar "confirmar 9º dígito" sem inventar número.

### Detalhes técnicos
- Arquivos: `src/lib/list-import-parser.ts`, `src/lib/list-ai-analyze.functions.ts`, `src/lib/list-import-ai.functions.ts`, `src/components/list-import-modal.tsx`.
- Testes em `src/lib/list-import-parser.test.ts`: linha com 2 clientes, linha sem plataforma, `Reserva(65)`, espaços duplos/iniciais, status minúsculo, cabeçalho `PASSADOS`.
- Sem mudança de banco de dados.
