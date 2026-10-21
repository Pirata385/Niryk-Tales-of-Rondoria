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

Etapa atual: **conteúdo completo em rodadas**. Rodada 1: criador 3D, vila, lobos com combate,
morte e renascimento, painel de equipamento, humanos anime (`human_m`, `human_f`). Rodada 2:
**Harpins** (`harpin_m`, `harpin_f`; enquanto não são importados, o Harpin provisório de
`character/placeholder.ts`), câmera que não deixa as asas cobrirem a mira, enquadramento Corpo /
Rosto no criador. Rodada 3: lobo, casas e a Armadura do Guarda de verdade.

## Stack e comandos

- TypeScript, Vite e three.js (versões fixas em `package.json`). Sem framework de UI: DOM e CSS.
- `npm run dev`: servidor de desenvolvimento (abre o criador).
- `npm run build`: typecheck e build para `dist/` (GitHub Pages publica em `/prototipo-2/`).
- `npm run build:single`: um único `dist-single/index.html` com tudo embutido, mais
  `dist-single/artifact.html` (o mesmo sem o esqueleto HTML, para publicar como Artifact). Usa
  modelos sem compressão meshopt (`tools/raw-models.mjs`): nada de WebAssembly nem `fetch`.
  `npm run check:csp` abre esse arquivo sob uma política de conteúdo estrita e confere que o jogo
  carrega.
- `npm test`: testes unitários (vitest) de `src/shared`, `src/server` e da máscara de esmaecimento.
- `npm run e2e`: Playwright (Chromium com SwiftShader) no computador, celular em pé e deitado:
  criador (Harpin, Rosto/Corpo, prévia, Aleatório), entra no mundo, anda, anda de lado, recua,
  corre, olha, veste a armadura, ataca em combo, luta numa toca de lobos, morre e renasce, 1ª
  pessoa; Harpins conferidos no mundo (plumas, asas, câmera, esmaecimento, 1ª pessoa); no
  computador ainda entra como Harpin, Harpin fêmea e Humana pelo Novo personagem. Zero erros no
  console. Usa `?q=low` para o renderizador por software não demorar (`Q=high` para a qualidade
  cheia). `SHOTS=desktop` roda só o computador.
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
- No Pyram3D: `python projects/niryk/protótipo_2/build_characters.py [human_m] [human_f] ...`
  (personagens e espada) e `nature.py` (natureza). Veja o `README.md` de lá para as convenções do
  GLB.
- `node tools/dev/creator-shots.mjs [desktop|phone|phone_land] [nomes]`: imagens do criador
  (humana, Harpins, Corpo e Rosto, ataque).

O Chromium do Playwright é o pré-instalado (`/opt/pw-browsers`), com WebGL por SwiftShader:
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Um quadro leva 1 a 2 s nele:
as ferramentas medem em **tempo de jogo** (`__niryk.time`), não em tempo de relógio.

### Rotas e parâmetros

- `/` — o criador (ou direto na vila com o personagem salvo). `?scene=creator` sempre abre o
  criador; `?play` entra na vila com o salvo ou o herói padrão.
- `?scene=lab` — close-up do personagem na clareira (`anim`, `t`, `turn`, `dist`, `h`, `fov`,
  `lift`, `fp`, `armor`). Ex.: `?scene=lab&anim=Attack1&t=0.2&turn=60`.
- `?corpo=human_m|human_f|harpin_m|harpin_f` — com `?play` ou o lab: o visual padrão desse corpo.
- `?semfade` — sem o esmaecimento das asas e com a câmera do humano (imagens de comparação).
- `?q=high|medium|low` — qualidade (padrão: high no computador, medium no celular).
- `?tunica=vinho|azul|verde|marrom|cinza|ocre` — cor da túnica do herói.
- `?debug` — ganchos de teste em produção (no `npm run dev` eles já existem).

### Ganchos de teste (`window.__niryk`)

Sempre: `ready`, `info` (chamadas de desenho e triângulos do último quadro). Só no dev ou com
`?debug`: `me` (posição prevista, guinada, vida, golpe), `time` (relógio do servidor), `view` (modo,
transição, yaw, pitch, fov, mouse preso), `camera`, `oneShot`, `world`, `threeScene`,
`teleport(x, z)`, `setLook(yaw, pitch)`, `setView('1p' | '3p')`, `attack()`, `body` (slots, cabelo,
asas, esmaecimento, o que some na 1ª pessoa, a posição da câmera), `kill()`, `respawn()`,
`freeze(on)`, `lookAt(x, z)`, `wolves`, `nearWolves`, `kills`, `events`, `equipment`. No criador:
`appearance`, `preview` (modelo, clipe, enquadramento).

## Arquitetura (pronta para online)

```
src/shared/   regras puras: protocolo, constantes, movimento (guinada segue a mira), aparência,
              itens, geração do mundo (clareira; vila e tocas de lobo por opção), colisão.
src/server/   simulação autoritativa a 20 Hz (GameServer). TS puro: nunca importe DOM, three.js
              ou src/client.
src/client/
  net/        Transport (LocalTransport hoje; WebSocketTransport depois)
  game/       GameClient (previsão e reconciliação), GameScene (o laço do jogo)
  camera/     ShoulderCamera: sobre o ombro com colisão (posição por raça), 1ª pessoa, FOV por
              proporção da tela
  input/      Input: WASD relativo à câmera, mouse preso, joystick e olhar por toque
  character/  CharacterView (GLB, slots de cor, mistura de locomoção, golpes, pose de 1ª pessoa,
              esmaecimento), equipment (espada no Socket_Weapon_R, armadura religada pelos nomes
              dos ossos ou placas), placeholder (humanos e Harpins de cápsulas), WolfView
  render/     Renderer, toon (material de faixas), outline (contorno por casca invertida), fade
              (esmaecimento pontilhado), look (a direção de arte em números), Sky, Lighting (sol
              e sombra), quality
  world/      Terrain, Grass (tufos e flores instanciados perto do jogador), NatureView
              (árvores, arbustos, pedras instanciados), natureModels, Water, WorldView
  scenes/     LabScene
  ui/         Creator (criador com prévia 3D, Corpo/Rosto), Hud, strings (todo texto PT-BR), ui.css
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
- **1ª pessoa**: nós `Head_*` e `Hair_*` (as penas das têmporas são `Head_Plumes`) ficam ocultos
  numa camada que a sombra ainda desenha; o que estiver pesado no osso `Head` em outras malhas é
  descartado pelo esmaecimento. A câmera fica nos olhos (centro da malha dos olhos em relação ao
  osso `Head`); os braços entram numa pose de guarda que some durante os golpes.
- **Harpins**: slots `Plume` (asas, cauda, pernas, penas das têmporas: a cor das plumas) e `Talon`
  (garras, `SLOT_DEFAULTS`); ossos extras `Left/RightWing1..3` e `Tail1..6` animados nos mesmos
  10 clipes. A câmera usa `SHOULDER.harpin` (mais alta, mais aberta e mais longe).
- **Esmaecimento** (`render/fade.ts`): o jogador local some em pontilhado (sem transparência,
  então o contorno esmaece junto) onde asas, cauda e cabelo cobrem a mira e onde algo encosta na
  câmera. A máscara por vértice vem dos pesos dos ossos de asa/cauda (ou do nome da malha).
- **Modelos** vêm do Pyram3D. Nunca edite GLBs à mão: mude o script, reexporte e rode
  `npm run models`. O `import-models.mjs` **não** funde materiais iguais (os slots e o vento
  dependem dos nomes).
- Textos da UI em PT-BR, centralizados em `src/client/ui/strings.ts`.
- Orçamento: menos de ~200 chamadas de desenho (hoje ~120 na vila em qualidade alta).
