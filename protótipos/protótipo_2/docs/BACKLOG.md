# Backlog do protótipo 2

O que ficou cru. Nada aqui é urgente: são lembretes para quando formos polir.

## Modelos que ainda faltam (o jogo usa substitutos)

- **Harpins** (`harpin_m.glb`, `harpin_f.glb`): estavam sendo feitos no Pyram3D enquanto a
  integração foi escrita. Até chegarem, o jogo usa o Harpin provisório de cápsulas
  (`character/placeholder.ts`), com asas dobradas enormes nas proporções do GLB, cauda, canelas
  de plumas, garras e os três penteados. Quando `npm run models` os importar, conferir com imagens:
  - a câmera dos Harpins (`SHOULDER.harpin` em `camera/ShoulderCamera.ts`) e o esmaecimento das
    asas (`VIEW_FADE` em `character/CharacterView.ts`) com as asas de verdade;
  - o enquadramento do criador (largura das asas em `placeCamera`, giro `TURN.harpin`);
  - a pose de guarda dos braços em 1ª pessoa (feita para o humano);
  - o orçamento de triângulos por malha no `tools/import-models.mjs` (penas finas: o limite de
    erro pode precisar ser menor para as penas não perderem a ponta).
- **Lobo, casas da vila e a Armadura do Guarda** (rodada 3): substitutos de cápsulas e caixas.
- **Armadura do Guarda para Harpins** (`armor_guard_harpin_*.glb`): até lá, as placas
  provisórias; as caneleiras ficam por cima das plumas das pernas de águia e o peitoral não tem
  recorte para as asas. Um osso da armadura que o corpo não tenha cai nas placas provisórias.

## Harpins

- **Esmaecimento pontilhado** (screen-door) das asas, cauda e cabelo perto da mira e perto da
  câmera: sem transparência, então não há erro de ordenação com o contorno. Numa tela de
  densidade 1x a trama aparece como meio-tom; em celulares (densidade alta) fica mais suave.
  Dá para trocar por ruído azul ou fazer a trama correr no tempo.
- O esmaecimento é só do jogador local; outros Harpins (online) cobrem a mira normalmente.
- A sombra do jogador não esmaece (de propósito: a silhueta das asas no chão ajuda).
- As asas não colidem com o mundo: encostado numa parede, a ponta da asa atravessa.
- Sem voo nem planar ainda (o GDD fala em Harpins nas montanhas).

## Criador

- **Corpo / Rosto**: escolher cabelo ou olhos aproxima o rosto sozinho; raça, gênero, plumas e
  túnica voltam ao corpo. Tom de pele não mexe no enquadramento. Arrastar gira; roda do mouse e
  pinça fazem o meio-termo.
- No celular em pé, o rosto aparece acima da folha de opções; com cabelos altos (crista) a ponta
  pode encostar nos botões Corpo/Rosto.

## Câmera e controles

- A colisão da câmera usa cilindros verticais (troncos, pedras, estruturas) e o terreno. Copas
  e arbustos não bloqueiam: olhando muito para baixo perto de uma árvore, a câmera pode entrar na
  copa.
- Na 1ª pessoa os golpes tocam o clipe da 3ª pessoa (a pose de guarda some durante o golpe): o
  arco passa rente à câmera e a mão sai da tela no fim do golpe. Vale um clipe próprio de 1ª
  pessoa (ou um ajuste por camada nos braços).
- Sensibilidade do mouse/toque e inversão do eixo Y ainda não são configuráveis.
- No celular em pé, o campo de visão é largo (até 82°) para o personagem caber; testar num
  aparelho real.

## Visual

- **Grama**: tufos grandes e pontudos perto da câmera; longe, o campo fica salpicado de pontos
  claros das flores. Ajustar densidade, tamanho e o rareamento (`THIN_FROM`, `THIN_KEEP` em
  `world/Grass.ts`).
- **Junção cabeça/corpo**: `Body` e `Head_Skin` são malhas separadas; conferir de perto se a
  casca de contorno não marca uma linha no pescoço.
- Sem nível de detalhe nas árvores: carvalhos (~1.900 triângulos) e pinheiros (~1.050) até 150 m.
  Uma versão simplificada para longe cortaria boa parte dos triângulos.
- Efeitos de golpe: falta o rastro da espada.

## Desempenho

- Na vila (computador, qualidade alta): ~120 chamadas de desenho e ~1,1 a 1,3 milhão de
  triângulos, quase tudo instâncias de árvores, cascas de contorno e grama. Medir num celular
  médio; se faltar, baixar o alcance das árvores (`quality.ts`) ou ter LOD.
- Cada personagem tem os próprios materiais de casca (o esmaecimento é por personagem); os
  programas de shader continuam compartilhados.
- Os testes no Chromium usam SwiftShader (1 a 2 s por quadro): o e2e roda em `?q=low`.

## Rodada 3 (notas)

- Lobo: de frente, o focinho aparece como um anel escuro (ponta do nariz). Revisar em `wolf.py`.
- Tocas no meio do bosque denso: a colisão da câmera a aproxima tanto que a luta fica apertada.
  Testar empurrar a câmera para cima, em vez de para frente, quando há troncos atrás.
- Humanos: manchas na gola e no pescoço e facetas escuras no cabelo (`human_f_face.png`).
