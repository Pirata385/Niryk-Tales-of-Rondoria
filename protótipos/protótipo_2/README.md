# Niryk: Tales of Rondoria — protótipo 2

MMORPG sandbox de mundo aberto, jogável no navegador (computador e celular). O protótipo 2 testa
um caminho novo para o **visual** e o **jeito de jogar**: tudo em 3D, **câmera sobre o ombro** com
mira no centro, **1ª pessoa** no V, e um visual **cartoon na linha Hades** (sombreamento chapado
em faixas, contorno de tinta, luz quente e sombra fria). Os modelos são feitos no
[Pyram3D](https://github.com/Pirata385/Pyram3D) e refeitos do zero para serem vistos de perto.

## O que dá para jogar agora

- **Criador de personagem** com prévia 3D numa clareira: **Humano** ou **Harpin**, masculino ou
  feminino, tom de pele, cabelo (quatro cortes humanos, três penachos Harpin), cor do cabelo e das
  plumas (Harpins só em branco, preto, cinza, verde, azul, vermelho e amarelo), olhos, túnica e
  nome. **Corpo / Rosto** enquadra o corpo inteiro ou o rosto (escolher cabelo ou olhos aproxima
  sozinho); arraste para girar; Parado, Andar e Atacar mostram os clipes.
- Uma **vila** no meio do mapa, com bosques, lagos e **tocas de lobos** ao redor. Lobos atacam em
  matilha (aviso no chão antes da mordida), dá para lutar, morrer e renascer na praça.
- **Câmera sobre o ombro** com mira no centro, que se aproxima quando algo fica no caminho; o
  personagem **sempre olha para onde a câmera aponta** (anda de lado, recua, corre para a frente).
  Para os **Harpins**, a câmera fica mais alta e aberta, e as asas enormes se desfazem num
  pontilhado onde cobririam a mira.
- **Ataque** em combo de dois golpes; **1ª pessoa** no V, com a mão e a espada à vista.
- **Equipamento** (I ou a mochila): espada e a Armadura do Guarda.
- Os humanos são os modelos anime do Pyram3D; os Harpins, o lobo, as casas e a armadura usam
  substitutos até os modelos chegarem.

## Controles

| | Computador | Celular |
|---|---|---|
| Olhar | mouse (clique para prender o mouse; Esc solta) | arraste na metade direita da tela |
| Andar | WASD ou setas (relativo à câmera) | joystick na metade esquerda |
| Correr | Shift (só para a frente) | empurre o joystick até a borda |
| Atacar | clique esquerdo (2 cliques = combo) | botão ⚔ |
| 1ª / 3ª pessoa | V | botão 1ª / 3ª |
| Equipamento | I ou a mochila | a mochila |
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
npm run e2e            # Playwright: criador, vila, movimento, armadura, lobos, morte, 1ª pessoa, Harpins (computador e celular)
npm run shoot          # imagens da fatia em .shots/
```

Rode os comandos dentro desta pasta. O GitHub Pages publica este protótipo em `/prototipo-2/`.

Parâmetros úteis: `?scene=lab` (close-up do personagem), `?play` (direto na vila),
`?corpo=harpin_f` (human_m, human_f, harpin_m, harpin_f), `?q=low|medium|high` (qualidade),
`?tunica=azul` (vinho, azul, verde, marrom, cinza, ocre).

Documentação para quem desenvolve (inclusive agentes de IA): [`CLAUDE.md`](CLAUDE.md),
[`docs/DESIGN.md`](docs/DESIGN.md), [`docs/BACKLOG.md`](docs/BACKLOG.md).
