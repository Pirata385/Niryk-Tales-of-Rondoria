# Niryk: Tales of Rondoria

MMORPG sandbox de mundo aberto em **2.5D isométrico**, jogável no navegador (computador e
celular). Personagens, equipamentos, lobo e construções são 3D (modelados no
[Pyram3D](https://github.com/Pirata385/Pyram3D)); árvores, pedras, flores e o chão são pintados
em 2D. Tudo passa por um filtro pixelado leve com contorno de tinta.

## Protótipo 1

- **Criador de personagem**: Humano ou Harpin, gênero, tom de pele, cabelo, cor do cabelo, cor
  das plumas (Harpins), olhos e nome, com prévia 3D que gira arrastando. Fica salvo no navegador.
- **Campos de Rondoria**: vila inicial com praça, poço, casas, feira e estradas; bosques, prados
  com flores, lagos e borboletas.
- **Combate**: espada com combo de dois golpes; lobos que farejam, perseguem, avisam antes do
  bote e mordem. Vida, morte e renascimento na praça.
- **Equipamento**: espada equipada no início e a Armadura do Guarda na bolsa.
- **Pronto para online**: a simulação roda num "servidor local" autoritativo (20 ticks/s) com o
  protocolo de rede final; o cliente prevê o próprio movimento e interpola os outros.

## Controles

| | Computador | Celular |
|---|---|---|
| Andar | WASD ou setas | arraste na metade esquerda da tela |
| Correr | Shift | arraste até a borda do joystick |
| Atacar | clique (na direção do mouse) ou Espaço | botão ⚔ (mira o lobo mais próximo) |
| Equipamento | I ou o ícone da bolsa | ícone da bolsa |
| Menu | Esc ou ☰ | ☰ (tela cheia, novo personagem) |

## Rodar

```bash
npm install
npm run dev            # servidor de desenvolvimento
npm run build          # site em dist/ (GitHub Pages)
npm run build:single   # um único dist-single/index.html com tudo embutido
npm test               # testes de regras e do servidor (vitest)
npm run e2e            # Playwright: cria personagem, anda, corre, mata um lobo, veste a armadura
```

O GitHub Pages publica a branch `main` pelo workflow `.github/workflows/deploy.yml`. Para ativar,
uma vez: Settings → Pages → Build and deployment → Source: **GitHub Actions**.

Rotas úteis: `?scene=creator` (abre o criador mesmo com personagem salvo), `?scene=lab&lineup`
(os quatro corpos e o lobo lado a lado), `?scene=test`.

Documentação para quem desenvolve (inclusive agentes de IA): [`CLAUDE.md`](CLAUDE.md),
[`docs/GDD.md`](docs/GDD.md), [`docs/art/ART_DIRECTION.md`](docs/art/ART_DIRECTION.md).
