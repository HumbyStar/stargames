Plano para aplicar o efeito corretamente:

1. Ajustar o estado da navbar
- Adicionar um estado específico de “saída do hover” quando houver scroll.
- Ao sair o mouse da navbar com scroll ativo, mudar `data-progress` para um estado dedicado, por exemplo `leaving`, em vez de simplesmente desligar o efeito.
- Depois de 3s, finalizar esse estado para deixar a navbar ofuscada.
- Ao entrar o mouse de novo, cancelar imediatamente o timeout e voltar ao loop/hover normal.

2. Corrigir o CSS do traço
- Criar seletores dedicados para `data-progress="leaving"`.
- Nesse estado, fazer o traço ocupar 100% da borda, pulsar com glow e desaparecer ao longo de 3s.
- Remover o `transition-delay: 3s` conflitante do anel para que a animação comece na hora certa, sem congelar.
- Manter o anel atrás dos botões/ícones via `z-index` e `pointer-events: none`.

3. Sincronizar com o glass/ofuscado
- Durante os 3s do pulso, manter a navbar ainda legível.
- Só aplicar a opacidade/blur do conteúdo após a animação terminar.
- Se o usuário voltar o mouse antes dos 3s, restaurar tudo instantaneamente.

4. Preservar acessibilidade
- Manter `prefers-reduced-motion` sem animação giratória/pulsante, usando apenas estado visual estático e suave.

5. Validar visualmente
- Testar hover, saída do mouse e scroll no preview.
- Confirmar que o traço não congela, não passa sobre ícones/botões, preenche 100% da borda, pulsa e apaga no tempo correto.