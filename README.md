# Niryk: Tales of Rondoria

MMORPG sandbox de mundo aberto, jogável no navegador (computador e celular), ambientado nos Campos de
Rondoria. Humanos e Harpins (humanoides alados de pernas de águia que vivem nas montanhas) dividem um
mundo de vilas, bosques e feras.

O jogo está em fase de **protótipos**. Cada um testa um estilo de arte, uma câmera e um jeito de jogar
diferentes, sobre as mesmas ideias:

| Protótipo | Estilo | Câmera | Pasta |
|---|---|---|---|
| 1 | 2.5D pixelado, natureza pintada em 2D, contorno de tinta | isométrica fixa | [`protótipos/protótipo_1`](protótipos/protótipo_1) |
| 2 | 3D cartoon na linha Hades: sombreamento chapado e contorno de tinta | sobre o ombro e 1ª pessoa | [`protótipos/protótipo_2`](protótipos/protótipo_2) (em construção) |

Os modelos 3D são feitos com o [Pyram3D](https://github.com/Pirata385/Pyram3D) (`projects/niryk/`).

## Jogar online

O GitHub Pages publica os protótipos a cada push na `main` (workflow `.github/workflows/deploy.yml`):
`https://pirata385.github.io/Niryk-Tales-of-Rondoria/`. Para ativar, uma vez: Settings → Pages →
Build and deployment → Source: **GitHub Actions**.

## Desenvolver

Cada protótipo é um app Vite independente. Entre na pasta dele e rode `npm install` e `npm run dev`.
Documentação: [`docs/GDD.md`](docs/GDD.md) (visão do jogo), o `README.md` e o `CLAUDE.md` de cada
protótipo, e o [`CLAUDE.md`](CLAUDE.md) da raiz (para agentes de IA).
