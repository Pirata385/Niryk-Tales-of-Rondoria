# Backlog do protótipo 2

O que ficou cru na fatia de estilo. Nada aqui é urgente: são lembretes para depois da aprovação do
estilo pelo dono.

## Conteúdo que ainda não está na fatia

- **Criador de personagem**: a fatia entra direto com o herói padrão (`sliceHero` em
  `src/client/main.ts`). Só a túnica muda por `?tunica=`.
- **Harpin, Humana**: só existe `human_m.glb`. Outros corpos caem no herói de cápsulas
  (`character/placeholder.ts`).
- **Lobos e vila**: o servidor e a geração do mundo ainda têm o código (opções `VILLAGE_WORLD`,
  `wolves`), mas o cliente não tem `WolfView` nem modelos de casas; a `GameScene` ignora entidades
  que não são jogadores.
- **Armadura e o painel de equipamento (I)**: fora da fatia; `equip()` ignora o slot `armor`.
- **Efeitos de golpe** (rastro da espada, números de dano, tremida de câmera) e o anel de aviso do
  lobo: não portados do protótipo 1.

## Câmera e controles

- A colisão da câmera usa cilindros verticais (troncos, pedras, estruturas) e o terreno. Copas
  e arbustos não bloqueiam: olhando muito para baixo perto de uma árvore, a câmera pode entrar na
  copa.
- Na 1ª pessoa os golpes tocam o clipe da 3ª pessoa (a pose de guarda some durante o golpe): o
  arco passa rente à câmera e a mão sai da tela no fim do golpe. Vale um clipe próprio de 1ª
  pessoa (ou um ajuste por camada nos braços).
- A sombra do jogador em 1ª pessoa perde a cabeça (os nós ocultos não projetam sombra).
- Sensibilidade do mouse/toque e inversão do eixo Y ainda não são configuráveis.
- No celular em pé, o campo de visão é largo (até 82°) para o personagem caber; testar num
  aparelho real.

## Visual

- **Grama**: tufos grandes e pontudos perto da câmera; longe, o campo fica salpicado de pontos
  claros das flores. Ajustar densidade, tamanho e o rareamento (`THIN_FROM`, `THIN_KEEP` em
  `world/Grass.ts`).
- **Junção cabeça/corpo**: `Body` e `Head_Skin` são malhas separadas; conferir de perto se a
  casca de contorno não marca uma linha no pescoço.
- **Sobrancelhas** com contorno próprio podem pesar no rosto de perto.
- Sem nível de detalhe nas árvores: carvalhos (~1.900 triângulos) e pinheiros (~1.050) até 150 m.
  Uma versão simplificada para longe cortaria boa parte dos triângulos.

## Desempenho

- Na clareira (computador, qualidade alta): ~75 chamadas de desenho e ~1,0 a 1,4 milhão de
  triângulos, quase tudo instâncias de árvores, cascas de contorno e grama. Medir num celular
  médio; se faltar, baixar o alcance das árvores (`quality.ts`) ou ter LOD.
- Os testes no Chromium usam SwiftShader (1 a 2 s por quadro): o e2e roda em `?q=low`.
