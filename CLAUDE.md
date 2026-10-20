# Niryk: Tales of Rondoria — instruções para agentes

MMORPG sandbox de mundo aberto, jogável no navegador (desktop e celular). O dono do projeto escreve
em português, geralmente pelo celular, então responda em português.

## Fase atual: protótipos

Estamos **prototipando**. Nada do que existe tem garantia de entrar no jogo final.
- **O foco é desenvolver e experimentar ideias**, não polir.
- **Revisões do crítico** (`.claude/agents/critico.md`): estão **pausadas**. Só use o crítico se o
  dono pedir.
- **Antes de entregar:** deixe verde o básico de cada protótipo (typecheck, testes e, ao mexer no
  jogo, o e2e no desktop).
- **O que fica para depois** vai para o `docs/BACKLOG.md` do protótipo.

## Estrutura

```
docs/GDD.md                visão, raças (lore dos Harpins), escopo, roadmap: vale para todos os protótipos
docs/art/references/       imagens de referência do dono: inspiram as IDEIAS, não o estilo dos modelos
protótipos/index.html      página de entrada do GitHub Pages
protótipos/protótipo_1/    2.5D isométrico pixelado (concluído, guardado como referência)
protótipos/protótipo_2/    3D, câmera sobre o ombro e 1ª pessoa, toon com contorno na linha Hades (em andamento)
.github/workflows/         Pages: compila cada protótipo e publica em /prototipo-N/
```

Cada protótipo é um app Vite independente, com `package.json`, `CLAUDE.md` e `docs/` próprios.
**Rode os comandos dentro da pasta do protótipo**: `npm install`, `npm run dev`, `npm test`, `npm run e2e`…

Os modelos 3D vêm do repositório Pyram3D (`../Pyram3D`), em `projects/niryk/protótipo_N/`, com a mesma
divisão por protótipo. Nunca edite GLBs à mão: mude o script, reexporte e importe.

O personagem "Oni" do Pyram3D **não** faz parte deste jogo.
