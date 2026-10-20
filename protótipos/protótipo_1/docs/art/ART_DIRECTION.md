# Direção de arte — Niryk

Referências em `references/`:

| Arquivo | O que tirar dela |
|---|---|
| `01_hades_templo_colunas.jpg` | Luz dramática, sombras longas e duras, contorno de tinta, fundo escuro que realça a área jogável |
| `02_hades_navio_combate.jpg` | Densidade de detalhes, props com contorno forte, efeitos brilhantes, leitura clara do combate |
| `03_hades_bosque_cristal.jpg` | Paleta de bosque com verdes e azuis, raios de luz, flores pequenas no chão |
| `04_hades2_salao_combate.jpg` | Pisos com padrões, móveis 3D com sombreamento chapado, HUD |
| `05_campo_pintado_arvores.jpg` | **Bioma inicial**: grama pintada com variação de tons, flores em manchas, árvores de copa em camadas "nuvem" com contorno, arbustos redondos, trilha de terra e barranco |
| `06_harpin_conceito.png` | **Design dos Harpins** |

## Regras gerais

- **2.5D isométrico.** Câmera ortográfica fixa com guinada de 45° e inclinação de 40° (a
  calibrar no portão G1).
- **3D**: personagens, equipamentos, criaturas, casas e estruturas (Pyram3D).
- **2D pintado**: árvores, arbustos, pedras, grama, flores, chão e UI.
- **Filtro pixel leve.** A escala inteira é escolhida pelo lado curto da tela, com cerca de
  384 px internos: 720p usa 2× (640×360), 1080p e celulares usam 3× e 1440p usa 4×. A
  quantidade de mundo visível fica parecida em qualquer aparelho, com cerca de 12 m no lado
  curto. A ideia é um pixel visível e agradável, não um pixel art grosseiro.
- **Densidade**: 32 px por metro na resolução interna, com zoom padrão. Uma árvore de 6 m
  tem cerca de 192 px de altura. Sprites 2D são pintados nessa densidade, para ficarem 1:1
  com o 3D.
- **Contorno de tinta** em tudo: roxo-escuro quase preto, `#1b1424`, nunca preto puro.
  1 px na resolução interna; 2 px nos sprites grandes, onde a silhueta pede.
- **Sombreamento chapado** em 3 tons:

| Tom | Cor |
|---|---|
| Luz | Quente (amarelado) |
| Meio-tom | Cor base |
| Sombra | Fria (azulada ou arroxeada), nunca só "mais escura" |

- **Luz**: o sol vem do **alto à esquerda da tela**; no mundo, isso é a direção de −X.
  Os sprites 2D são pintados com a mesma luz. As sombras projetadas caem para a direita e um
  pouco para baixo.
- **Rim light** fria e leve nos personagens, para destacá-los do chão.
- **Saturação**: média e alta nas cores de destaque (flores, efeitos, roupas); chão
  ligeiramente dessaturado, para os personagens se destacarem.

## Paleta base (Campos de Rondoria)

| Uso | Cores (luz, base, sombra) |
|---|---|
| Grama | `#9cc251` `#6f9a3b` `#3f6b3a` (sombra puxada para o azul `#2e4f45`) |
| Folhagem | `#8fbf4a` `#5b8f34` `#2f5a33` `#1f3d32` |
| Terra / trilha | `#c9a06a` `#a77b4a` `#6e4c33` |
| Pedra | `#c9c3b5` `#9a9488` `#64606a` |
| Madeira | `#b58256` `#8a5a3a` `#553524` |
| Telhado (telha) | `#c0643f` `#8f4030` `#5a2a2a` |
| Palha | `#e0c06a` `#b8933f` `#7a5a2a` |
| Contorno | `#1b1424` |
| Sombra no chão | Cerca de 65% do valor da grama, puxada para o azul (sprites: `#1f2f3f` a 68%) |
| Flores | Branco `#f4f1e6`, amarelo `#f2d04a`, lilás `#a58ad6`, azul `#7aa7e0`, vermelho `#e0563f` |

## Personagens

- **Proporção heroica estilizada**: cerca de 6,5 cabeças, mãos e ombros levemente
  exagerados, silhueta clara.
- Humanos com 1,75 m (masculino) e 1,68 m (feminino). Harpins mais leves e esguios
  (1,72 m e 1,66 m, sem contar o penacho).
- A silhueta precisa ser lida a cerca de 43 px de altura (1,75 m × cos 40° × 32 px/m).
- **Cores trocáveis por slot de material**: `Skin`, `Hair`, `Plume`, `Eye`, `Cloth_A`,
  `Cloth_B`, `Leather`, `Metal`, `Talon`.

## Interface

- Fonte pixel legível.
- Painéis em madeira escura e pergaminho, com cantos de metal; botões grandes no celular
  (pelo menos 48 px).
- Barra de vida vermelha com contorno, no estilo da referência 04.
