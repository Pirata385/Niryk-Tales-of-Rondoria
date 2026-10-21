# Niryk: Tales of Rondoria — protótipo 2 (3D, câmera sobre o ombro)

Este é o **protótipo 2** (em andamento). Todos os comandos abaixo rodam **dentro desta pasta**
(`protótipos/protótipo_2`). O dono do projeto escreve em português (geralmente pelo celular);
responda em português. Leia antes:

- `docs/DESIGN.md`: o que este protótipo decide (estilo de arte, jeito de jogar, imersão). Aprovado
  pelo dono: **não edite sem ele pedir**.
- `docs/BACKLOG.md`: o que ficou para depois.
- `../../docs/GDD.md`: visão, raças, escopo. `../../docs/art/references/`: referências (ideias, não
  estilo de modelo). O personagem "Oni" do Pyram3D **não** faz parte deste jogo.

## Fase atual: protótipo (crítico pausado)

O foco é experimentar, não polir. Antes de entregar, deixe verde:
`npm run typecheck`, `npm test` e, ao mexer no jogo, `SHOTS=desktop npm run e2e`.
Olhe as imagens que gerar (`npm run shoot`) antes de dizer que algo está bom.

Etapa atual: **fatia de estilo** — um Humano liso com espada numa clareira 3D, sem criador, sem
lobos e sem vila (o código deles continua no servidor, desligado pelas opções do mundo).

## Stack e comandos

- TypeScript, Vite e three.js (versões fixas em `package.json`). Sem framework de UI: DOM e CSS.
- `npm run dev`: servidor de desenvolvimento (abre direto na clareira).
- `npm run build`: typecheck e build para `dist/` (GitHub Pages publica em `/prototipo-2/`).
- `npm run build:single`: um único `dist-single/index.html` com tudo embutido, mais
  `dist-single/artifact.html` (o mesmo sem o esqueleto HTML, para publicar como Artifact). Usa
  modelos sem compressão meshopt (`tools/raw-models.mjs`): nada de WebAssembly nem `fetch`.
  `npm run check:csp` abre esse arquivo sob uma política de conteúdo estrita e confere que o jogo
  carrega.
- `npm test`: testes unitários (vitest) de `src/shared` e `src/server`.
- `npm run e2e`: Playwright (Chromium com SwiftShader) no computador, celular em pé e deitado:
  anda, anda de lado, recua, corre, olha, ataca em combo, alterna 1ª pessoa; zero erros no console.
  Usa `?q=low` para o renderizador por software não demorar (`Q=high` para a qualidade cheia).
- `npm run shoot`: as imagens da fatia em `.shots/slice_*.png` (3ª e 1ª pessoa no computador,
  celular em pé e deitado, close-up no laboratório, corrida). Também uma URL só:
  `node tools/shoot.mjs "?scene=lab&anim=Run&t=0.2" lab_run desktop`, com `VIEW=1p`,
  `LOOK=yaw,pitch`, `AT=x,z`, `RUN=ms` (tempo de jogo) no ambiente. Imprime chamadas de desenho e
  triângulos de cada imagem.
- `npm run models`: importa os GLBs do Pyram3D
  (`../../../Pyram3D/projects/niryk/protótipo_2/exports`) para `assets/models/` e copia o
  `nature.json` para `assets/nature.json`. Personagens: orçamento generoso por malha e erro baixo
  (continuam lisos), normais de 12 bits e pesos de 16 bits. Natureza: só soldada, quantizada e
  comprimida.
- No Pyram3D: `python projects/niryk/protótipo_2/build_human.py [--fast]` (humano e espada) e
  `nature.py` (natureza). Veja o `README.md` de lá para as convenções do GLB.

O Chromium do Playwright é o pré-instalado (`/opt/pw-browsers`), com WebGL por SwiftShader:
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Um quadro leva 1 a 2 s nele:
as ferramentas medem em **tempo de jogo** (`__niryk.time`), não em tempo de relógio.

### Rotas e parâmetros

- `/` — a clareira com o herói padrão.
- `?scene=lab` — close-up do personagem na clareira (`anim`, `t`, `turn`, `dist`, `h`, `fov`,
  `lift`, `fp`). Ex.: `?scene=lab&anim=Attack1&t=0.2&turn=60`.
- `?q=high|medium|low` — qualidade (padrão: high no computador, medium no celular).
- `?tunica=vinho|azul|verde|marrom|cinza|ocre` — cor da túnica do herói.
- `?debug` — ganchos de teste em produção (no `npm run dev` eles já existem).

### Ganchos de teste (`window.__niryk`)

Sempre: `ready`, `info` (chamadas de desenho e triângulos do último quadro). Só no dev ou com
`?debug`: `me` (posição prevista, guinada, vida, golpe), `time` (relógio do servidor), `view` (modo,
transição, yaw, pitch, fov, mouse preso), `camera`, `oneShot`, `world`, `threeScene`,
`teleport(x, z)`, `setLook(yaw, pitch)`, `setView('1p' | '3p')`, `attack()`.

## Arquitetura (pronta para online)

```
src/shared/   regras puras: protocolo, constantes, movimento (guinada segue a mira), aparência,
              itens, geração do mundo (clareira; vila e tocas de lobo por opção), colisão.
src/server/   simulação autoritativa a 20 Hz (GameServer). TS puro: nunca importe DOM, three.js
              ou src/client.
src/client/
  net/        Transport (LocalTransport hoje; WebSocketTransport depois)
  game/       GameClient (previsão e reconciliação), GameScene (o laço do jogo)
  camera/     ShoulderCamera: sobre o ombro com colisão, 1ª pessoa, FOV por proporção da tela
  input/      Input: WASD relativo à câmera, mouse preso, joystick e olhar por toque
  character/  CharacterView (GLB, slots de cor, mistura de locomoção, golpes, pose de 1ª pessoa),
              equipment (espada no Socket_Weapon_R), placeholder (herói de cápsulas)
  render/     Renderer, toon (material de faixas), outline (contorno por casca invertida), look
              (a direção de arte em números), Sky, Lighting (sol e sombra), quality
  world/      Terrain, Grass (tufos e flores instanciados perto do jogador), NatureView
              (árvores, arbustos, pedras instanciados), natureModels, Water, WorldView
  scenes/     LabScene
  ui/         Hud, strings (todo texto PT-BR), ui.css
```

O cliente prevê o próprio movimento com o mesmo `stepPlayer` do servidor e interpola os outros.
O jogador manda a guinada da câmera como `aim`: o corpo sempre olha para onde a câmera aponta
(anda de lado e de costas), e o golpe sai nessa direção.

## Convenções

- Metros, **+Y para cima**. Personagens olham para **+Z** no modelo; a esquerda do personagem é
  +X. Guinada: a direção é `(sin yaw, cos yaw)` em XZ (a mesma em `shared/movement.ts` e na
  câmera). Pitch da câmera: positivo olhando para cima.
- **Visual** (`src/client/render/look.ts` concentra os números): material toon com 3 faixas (luz
  quente, meio-tom, sombra fria), borda de luz na silhueta, contorno de tinta em pixels de tela
  (grosso perto, fino longe), céu em degradê com nuvens pintadas, neblina na cor do horizonte,
  sol com sombra centrada no jogador. Sem pós-processo; antisserrilhado nativo (MSAA).
- **Contorno**: cada malha ganha uma casca (`addOutline`) que é filha dela; instâncias usam a
  mesma matriz e desenham só as mais próximas (`hull.count`). Olhos e detalhes escuros não têm
  contorno.
- **Slots de cor dos personagens**: `Skin`, `Hair`, `Eye`, `Cloth_A` vêm da aparência;
  `Cloth_B`, `Leather` e `Metal` usam `SLOT_DEFAULTS` (`CharacterView.ts`). As cores base do GLB
  são brancas; o detalhe pintado está nas cores de vértice.
- **1ª pessoa**: nós `Head_*` e `Hair_*` ficam ocultos; a câmera fica nos olhos (centro da malha
  dos olhos em relação ao osso `Head`); os braços entram numa pose de guarda que some durante os
  golpes.
- **Modelos** vêm do Pyram3D. Nunca edite GLBs à mão: mude o script, reexporte e rode
  `npm run models`. O `import-models.mjs` **não** funde materiais iguais (os slots e o vento
  dependem dos nomes).
- Textos da UI em PT-BR, centralizados em `src/client/ui/strings.ts`.
- Orçamento: menos de ~200 chamadas de desenho (hoje ~75 na clareira).
