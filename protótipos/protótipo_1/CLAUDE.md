# Niryk: Tales of Rondoria — protótipo 1 (2.5D isométrico pixelado)

Este é o **protótipo 1**, guardado como referência (veja o `CLAUDE.md` da raiz do repositório). Todos os
comandos abaixo rodam **dentro desta pasta** (`protótipos/protótipo_1`).

MMORPG sandbox de mundo aberto, **2.5D isométrico**, jogável no navegador (desktop e celular).
O dono do projeto escreve em português (geralmente pelo celular); responda em português. Leia antes:

- `../../docs/GDD.md`: visão, raças, escopo do protótipo, roadmap.
- `docs/art/ART_DIRECTION.md`: câmera, filtro pixel, paleta, contorno, densidade de 32 px/m.
- `../../docs/art/references/`: imagens de referência do dono. O personagem "Oni", do repositório
  Pyram3D, **não** faz parte deste jogo.

## Fase atual: protótipo (revisões do crítico pausadas)

Estamos prototipando: nada do que existe tem garantia de entrar no jogo final. O foco é
**desenvolver e experimentar ideias**, não polir. Por decisão do dono, a Regra do Crítico abaixo
está **pausada**:
- Não lance o crítico nem rodadas de revisão, a menos que o dono peça.
- Mantenha só o básico verde: `npm run typecheck`, `npm test` e, ao mexer no jogo,
  `SHOTS=desktop npm run e2e`.
- Anote o que fica para depois em `docs/BACKLOG.md`.

O polimento e o crítico voltam quando o trabalho sério no jogo começar.

## Regra do Crítico (pausada na fase de protótipo)

Quando reativada, toda entrega visual (modelo, sprite, animação, tela do jogo) e todo sistema de
código relevante passam pelo agente **crítico** (`.claude/agents/critico.md`) antes de chegar ao
dono:

1. Gere o material de revisão:
   - assets 3D: folhas do Pyram3D em `projects/niryk/protótipo_1/review/`;
   - sprites: `tools/art2d/out/review_*.png`;
   - jogo: `npm run shoot` (uma URL; `CHAR=harpin_f` entra no jogo com personagem salvo,
     `AT=x,z` teleporta) e `node tools/review-shots.mjs` (4 corpos + lobo lado a lado, 8 direções,
     armadura, espada, criador), que gravam em `.shots/`.
2. Lance o crítico (subagente) com os caminhos. Em vez de abrir outro, continue a mesma
   instância nas rodadas seguintes.
3. `REFAZER` → corrija e reenvie, no máximo 3 rodadas por item. Se ainda não aprovar, siga em
   frente e informe o dono das pendências.

## Stack e comandos

- TypeScript, Vite e three.js (versões fixas em `package.json`). Sem framework de UI: DOM e CSS.
- `npm run dev`: servidor de desenvolvimento.
- `npm run build`: typecheck e build para `dist/` (GitHub Pages).
- `npm run build:single`: um único `dist-single/index.html` com tudo embutido, mais
  `dist-single/artifact.html` (o mesmo sem o esqueleto HTML, para publicar como Artifact). Usa
  modelos sem compressão meshopt (`tools/raw-models.mjs`) e não depende de WebAssembly nem de
  `fetch`, para rodar sob uma política de conteúdo estrita.
- `npm test`: testes unitários (vitest) de `src/shared` e `src/server`.
- `npm run typecheck`
- `npm run e2e`: Playwright, que cria personagem, anda, ataca e equipa, em desktop e celular.
- `npm run shoot`: screenshots determinísticas para o crítico (`.shots/`).
- `npm run models`: importa os GLBs exportados pelo Pyram3D
  (`../../../Pyram3D/projects/niryk/protótipo_1/exports`), simplifica por orçamento de malha, quantiza, comprime
  (meshopt) e grava em `assets/models/`. Texturas recebem nome pelo hash do conteúdo (a vila é
  fundida em lotes estáticos por textura).
- `npm run art`: regenera sprites, chão e UI 2D (`tools/art2d`, Python com numpy e Pillow) em
  `assets/sprites/`.
- Rotas: `?scene=creator`, `?scene=lab` (`lineup`, `dirs`, `race`, `gender`, `anim`, `t`,
  `zoom`, `armor`, `tx/ty/tz`…), `?scene=test`.
- No Pyram3D: `python projects/niryk/protótipo_1/build_characters.py [nome] [--fast] [--armor-only]
  [--sword]`, `wolf.py`, `buildings.py`.

Playwright usa o Chromium pré-instalado (`/opt/pw-browsers`) com WebGL via SwiftShader:
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

## Arquitetura (pronta para online)

```
src/shared/   tipos e regras puras: protocolo, constantes, aparência, itens, geração de mundo
              (seed), colisão, combate. Roda no cliente e no futuro servidor.
src/server/   simulação autoritativa em ticks de 20 Hz (GameServer). TS puro: nunca importe DOM,
              three.js ou src/client.
src/client/   tudo o que é visual e de entrada. Fala com o servidor só por `net/Transport`
              (LocalTransport hoje; WebSocketTransport depois).
```

Mensagens do protocolo: `src/shared/protocol.ts`. O cliente prevê o movimento do próprio
jogador e interpola as outras entidades.

## Convenções

- Unidades em **metros**, **+Y para cima**. Personagens olham para **+Z** no modelo; a esquerda
  do personagem é +X.
- Câmera ortográfica isométrica fixa (`src/client/render/IsoCamera.ts`).
- Filtro pixel em `src/client/render/PixelPipeline.ts`: resolução interna baixa, contorno por
  profundidade e normais, ampliação *nearest*.
- Camadas do three: `0` padrão; `1` OUTLINE (objetos 3D com contorno de tinta); `2` XRAY
  (silhueta do jogador atrás de objetos).
- **Sprites 2D** são billboards verticais voltados para a câmera, com a altura corrigida por
  1/cos(inclinação). O manifesto `public/assets/sprites/nature.json` traz âncora, tamanho e
  colisor de cada sprite.
- **Modelos 3D** vêm do Pyram3D (`../../../Pyram3D/projects/niryk/protótipo_1/*.py`). Nunca edite GLBs à mão:
  mude o script, reexporte e rode `npm run models`.
- **Slots de cor dos personagens**: os nomes de material (`Skin`, `Hair`, `Plume`, `Eye`,
  `Cloth_A`, `Cloth_B`, `Leather`, `Metal`, `Talon`) recebem a cor escolhida por multiplicação.
- Armaduras são skinned nos mesmos nomes de ossos e religadas ao esqueleto do personagem pelo
  nome.
- Textos da UI em PT-BR, centralizados em `src/client/ui/strings.ts`.
