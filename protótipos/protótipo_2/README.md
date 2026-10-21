# Niryk: Tales of Rondoria — protótipo 2

MMORPG sandbox de mundo aberto, jogável no navegador (computador e celular). O protótipo 2 testa
um caminho novo para o **visual** e o **jeito de jogar**: tudo em 3D, **câmera sobre o ombro** com
mira no centro, **1ª pessoa** no V, e um visual **cartoon na linha Hades** (sombreamento chapado
em faixas, contorno de tinta, luz quente e sombra fria). Os modelos são feitos no
[Pyram3D](https://github.com/Pirata385/Pyram3D) e refeitos do zero para serem vistos de perto.

## Fatia de estilo (o que dá para jogar agora)

- Um **Humano** com espada numa **clareira 3D**: lago, carvalho antigo, pedras, tronco caído,
  bosques de carvalhos e pinheiros, grama e flores balançando ao vento.
- **Câmera sobre o ombro** que se aproxima quando uma árvore, pedra ou o terreno fica no caminho.
- O personagem **sempre olha para onde a câmera aponta**: anda de lado, recua e corre para a frente.
- **Ataque** em combo de dois golpes na direção da mira.
- **1ª pessoa**: a câmera vai para os olhos, com a mão e a espada à vista.
- Ainda **sem** criador, lobos, vila e armadura: voltam depois da aprovação do estilo
  (veja `docs/DESIGN.md`).

## Controles

| | Computador | Celular |
|---|---|---|
| Olhar | mouse (clique para prender o mouse; Esc solta) | arraste na metade direita da tela |
| Andar | WASD ou setas (relativo à câmera) | joystick na metade esquerda |
| Correr | Shift (só para a frente) | empurre o joystick até a borda |
| Atacar | clique esquerdo (2 cliques = combo) | botão ⚔ |
| 1ª / 3ª pessoa | V | botão 1ª / 3ª |
| Menu (tela cheia) | Esc (com o mouse solto) ou ☰ | ☰ |

Onde o navegador não deixa prender o mouse (algumas páginas embutidas), arrastar com o mouse
olha e um clique ataca.

## Rodar

```bash
npm install
npm run dev            # servidor de desenvolvimento
npm run build          # site em dist/ (GitHub Pages)
npm run build:single   # um único dist-single/index.html com tudo embutido
npm test               # testes de regras e do servidor (vitest)
npm run e2e            # Playwright: anda, anda de lado, recua, corre, ataca, 1ª pessoa (computador e celular)
npm run shoot          # imagens da fatia em .shots/
```

Rode os comandos dentro desta pasta. O GitHub Pages publica este protótipo em `/prototipo-2/`.

Parâmetros úteis: `?scene=lab` (close-up do personagem), `?q=low|medium|high` (qualidade),
`?tunica=azul` (vinho, azul, verde, marrom, cinza, ocre).

Documentação para quem desenvolve (inclusive agentes de IA): [`CLAUDE.md`](CLAUDE.md),
[`docs/DESIGN.md`](docs/DESIGN.md), [`docs/BACKLOG.md`](docs/BACKLOG.md).
