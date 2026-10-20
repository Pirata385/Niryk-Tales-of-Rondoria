# Protótipo 2: design

Aprovado pelo dono em 20/10/2026. Este protótipo vai decidir o **estilo de arte**, o **jeito de jogar** e o
**nível de imersão** do jogo.

## Ideia

Mantém os mesmos conceitos do protótipo 1:
- **Raças:** criador com Humano e Harpin.
- **Cenário:** vila inicial e um bioma.
- **Combate:** lobo, espada com combo de 2 golpes e armadura.
- **Movimento:** andar e correr.
- **Plataformas:** funciona no computador e no celular.
- **Rede:** offline, mas pronto para online.

O que muda é a forma:

| | Protótipo 1 | Protótipo 2 |
|---|---|---|
| Mundo | 2.5D: personagens 3D, natureza pintada em 2D | **tudo em 3D**, inclusive árvores, pedras e grama |
| Câmera | isométrica fixa | **sobre o ombro**, com mira no centro; **V** alterna para a 1ª pessoa |
| Visual | filtro pixelado, contorno por pós-processo | **cartoon na linha Hades**, sem pixelização (detalhes abaixo) |
| Modelos | SDF por "massas", encaroçados de perto | **refeitos do zero**, lisos, para serem vistos de perto |

O visual cartoon na linha Hades combina:
- sombreamento chapado, em 2 a 3 faixas;
- contorno de tinta;
- luz dramática.

As imagens de `docs/art/references/` (raiz do repositório) inspiram as **ideias**, não o estilo dos modelos.

## Personagens: lisos e heroicos

- **Proporção:** a mesma do protótipo 1, cerca de 6,5 cabeças, heroica e estilizada.
- **Formas:** silhuetas fortes e formas grandes e legíveis. Ângulos estilizados no rosto, nas mãos e nos
  ombros, sobre superfícies **lisas**.
- **Sem caroços:**
  - Usar poucas formas grandes com uniões amplas, nunca "músculos" feitos de bolinhas.
  - Malha fina, suavização com preservação de volume (Taubin) e normais suaves.
  - Partes tubulares (membros, mechas de cabelo, cauda, penas) podem ser lofts ou sweeps com
    subdivisão Catmull-Clark.
  - Roupas são cascas lisas que acompanham o corpo, com bordas limpas.
- **Critério de aceite:** com a câmera a 2,5 m (sobre o ombro) e a 0,3 m (mãos em 1ª pessoa), nada de
  calombos, vincos nas juntas ou partes "grudadas". Cotovelos e joelhos deformam bem ao andar, correr e
  atacar.
- **Rig:** o mesmo padrão de ossos do protótipo 1 (nomes do Unity Humanoid, sockets, slots de material
  por cor), para reaproveitar a lógica do cliente.
- **Clipes:**
  - Idle, Walk, Run;
  - **WalkBack, StrafeLeft, StrafeRight**: o personagem sempre olha para onde a câmera aponta, então
    anda de lado e de costas;
  - Attack1, Attack2, Hit, Death.
- **Orçamento:** personagem de até cerca de 25 mil triângulos (antes da simplificação no jogo), lobo de
  até cerca de 10 mil.

## Visual (three.js)

- **Material toon:**
  - rampa de 2 a 3 faixas, com sombra em tom frio (não cinza) e luz quente;
  - brilho de borda na silhueta superior;
  - cores de vértice ou paletas pequenas.
- **Contorno de tinta:**
  - Uma cópia da malha com as faces invertidas, inflada pelas normais suavizadas, com a espessura
    calculada em pixels de tela. Fica mais grosso de perto e afina com a distância.
  - Nas malhas com esqueleto, a cópia usa o mesmo esqueleto.
  - Um contorno fino de silhueta por profundidade cobre o terreno e o horizonte.
- **Cena:**
  - céu em degradê com nuvens pintadas;
  - neblina de distância na cor do céu;
  - sol direcional com sombra (mapa centrado no jogador);
  - gradação de cor leve.
- **Sem pixelização e sem bloom forte.** Antisserrilhado nativo (MSAA).
- **Desempenho:** natureza instanciada, menos de cerca de 200 chamadas de desenho, 60 fps no desktop e
  30 fps ou mais num celular médio.

## Câmera e controles

- **Sobre o ombro:**
  - posição: 0,45 m à direita, 1,6 m de altura, cerca de 2,6 m atrás do personagem;
  - mira fixa no centro da tela;
  - o personagem sempre vira para onde a câmera aponta;
  - a câmera se aproxima quando há parede, árvore ou terreno no caminho, com suavização.
- **1ª pessoa (V):**
  - a câmera fica no osso da cabeça;
  - cabeça e cabelo ficam ocultos, braços e espada à vista;
  - FOV um pouco maior.
- **Computador:** WASD para andar (relativo à câmera); Shift para correr; mouse preso (pointer lock) para
  olhar; clique esquerdo para atacar na direção da mira; V para alternar 1ª e 3ª pessoa; I para o
  equipamento; Esc para o menu.
- **Celular:** joystick à esquerda (na borda, corre); arrastar na metade direita para olhar; botões de
  ataque e de 1ª/3ª pessoa.

## Código: o que se reaproveita

O protótipo 2 é um app Vite independente nesta pasta. Do protótipo 1 vêm, copiados e adaptados:
- `src/shared` e `src/server`: protocolo, simulação de 20 Hz, combate, IA do lobo, geração do mundo e
  validação.
  - **Mudança:** a guinada do jogador segue a mira (`aim`), não a direção do movimento.
- `src/client/net` e `GameClient`: previsão e interpolação.
- `Input`: estendido com pointer lock e o "olhar" por toque.
- A interface (criador e HUD) e as ferramentas (`shoot`, `e2e`, `import-models`, `build:single`).

Tudo o que é visual é novo: render, câmera, vistas do mundo e personagens.

Modelos: `../Pyram3D/projects/niryk/protótipo_2/` (scripts novos) → `exports/` → `npm run models`.

## Ordem

1. **Fatia de estilo (ponto de decisão do dono):**
   - um Humano liso com espada numa clareira 3D (árvores, pedras, grama e flores);
   - visual toon com contorno;
   - câmera sobre o ombro e 1ª pessoa;
   - andar, correr, andar de lado e atacar, no desktop e no celular;
   - publicado num link para o dono aprovar.
2. **Depois da aprovação:**
   - Harpin (asas, cauda, pernas de águia);
   - criador;
   - vila com casas novas;
   - lobo e combate;
   - armadura.
3. **Fechamento:** build de arquivo único, Pages em `/prototipo-2/` e relatório.

Fase de protótipo: o crítico está pausado. Mantenha verdes o typecheck, os testes e o e2e no desktop, e
anote o que fica para depois em `docs/BACKLOG.md`.
