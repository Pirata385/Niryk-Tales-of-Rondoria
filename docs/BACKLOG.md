# Backlog (para quando o trabalho sério começar)

Itens anotados durante o protótipo. Nada aqui é urgente: são lembretes para a fase de polimento.

## Online (antes de ter servidor de verdade)

Encontrados numa revisão automática e **ainda não verificados**:

- **NET-1:** um `join` malformado pode lançar exceção dentro de `GameServer.receive`; num
  servidor online, isso derrubaria todos. Envolver `receive` e `tick` em try/catch por
  cliente e validar o formato inteiro da mensagem.
- **NET-2:** a fila de entradas só cresce. Um pico de atraso deixa latência permanente e,
  com a fila cheia, descarta ataques. É preciso drenar o excesso (pular entradas de movimento,
  preservar ataques).
- **NET-3:** sem entradas novas (aba em segundo plano, rede parada), o servidor repete o
  último movimento para sempre. Parar depois de alguns ticks.
- **NET-4:** um segundo `join` do mesmo cliente é aceito, o que revive e cura no spawn.
  Recusar.
- **NET-5:** o nome é validado sem os espaços das pontas, mas guardado sem cortar e sem
  limite de tamanho. Guardar o valor cortado e limitar.
- **NET-6:** a animação de ataque do próprio jogador segue o servidor, não a previsão. Online,
  isso dá um ida e volta de atraso.
- **NET-7:** a suavização das correções de posição não tem teto.
- **NET-8:** eventos recebidos sem quadros rodando (aba oculta) acumulam efeitos.

## Visual

- **Anel sob o jogador:** nos Harpins, as asas e a cauda escondem quase todo o anel. O piso
  de contraste (`RING_LIFT` em `src/client/game/Markers.ts`) passa dos 35% sobre grama clara.
- **Lobos atrás de copas:** a silhueta vermelha se mistura ao padrão quadriculado da copa
  transparente e fica poluída.
- **Floresta:** desde a correção dos sprites espelhados, ela aparece com a densidade real (o
  dobro de antes). Há grupos de 3 pinheiros quase no mesmo ponto. Rever `density` e o
  espaçamento mínimo em `src/shared/world/nature.ts`.
- **Sprites espelhados:** a sombra pintada mantém a direção do sol e só acompanha a copa.
  Sprites com luz pintada (árvores, arbustos, pedras, tocos) não são espelhados.
- **Praça:** num dos lados, o banco fica logo na frente de um canteiro.
- **Borda do mundo:** perto de z = −100 aparece o fundo escuro. Falta uma borda natural
  (morros ou mata fechada).

## Desempenho

- O passe de overlay (marcadores) percorre a cena inteira a cada quadro. Daria para renderizar
  só a lista de marcadores.
- `Effects` ainda monta strings de estilo para os números de dano.
