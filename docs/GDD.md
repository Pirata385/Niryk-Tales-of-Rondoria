# Niryk: Tales of Rondoria — documento de design (GDD)

## Visão

MMORPG **sandbox de mundo aberto** jogável no navegador (desktop e celular), em **2.5D isométrico**.
Personagens, equipamentos, criaturas e construções são 3D; a natureza (árvores, pedras, arbustos,
chão) é 2D pintada. Tudo passa por um filtro pixelado leve. O projeto começa pequeno e cresce
por etapas.

## Raças

### Humano
Humanoides básicos: são só humanos.

### Harpins
- Humanoides **leves e graciosos**, cobertos em parte por **penas como as de pássaros**.
- Um par de **asas enormes**, que usam para voar. Dobradas, as pontas chegam perto dos
  tornozelos; abertas, têm cerca de 3 m de envergadura.
- **Pernas como as de uma águia** (digitígradas, com garras), porém **cobertas de plumas**.
- Uma **cauda longa** como a de um mamífero, mas **coberta de plumas** em vez de pelos.
- **Cabelos e plumas** podem ser **branco, preto, cinza, verde, azul, vermelho ou amarelo**.
- Têm acesso aos elementos **vento, fogo, água e plasma**.
- Vivem nas **montanhas**.
- Arte de referência: `art/references/06_harpin_conceito.png`. Cabelo espetado com tufos de
  penas nas têmporas, orelhas pontudas, gola de pele, túnica, cinto de couro, asas escuras e
  pernas de ave com garras.

## Mundo

**Rondoria.** O primeiro bioma é o dos **Campos de Rondoria**: pradarias temperadas, bosques
de carvalhos e pinheiros, flores silvestres, pedras e trilhas de terra.

A **vila inicial** fica no centro. Tem uma praça com poço, casas de pedra e madeira, uma
barraca de feira, cercas, postes com lanterna e um quadro de avisos.

## Protótipo 1 (escopo)

| Sistema | Conteúdo |
|---|---|
| Criador de personagem | Raça (Humano/Harpin), gênero, tom de pele, estilo e cor de cabelo, cor das plumas (Harpin), cor dos olhos, nome, botão "aleatório" |
| Mundo | 1 bioma (~200×200 m), seed determinística, vila inicial, bosques, trilhas |
| Inimigo | Lobo 3D: patrulha, persegue, avisa e dá o bote; renasce em 30 s |
| Combate | Espada com combo de 2 golpes; dano, morte e renascimento na praça |
| Equipamento | 1 espada e 1 armadura (peitoral, ombreiras, braçadeiras, cinto e grevas) |
| Animações | Idle, andar, correr, ataque com espada (2 golpes), dano, morte; asas e cauda nos Harpins |
| Plataforma | Navegador; desktop (teclado e mouse) e celular (joystick virtual e botões) |
| Rede | Offline com "servidor local" autoritativo e protocolo final (pronto para WebSocket) |

**Fora do protótipo 1** (já previsto na arquitetura): servidor online, voo dos Harpins, magias
elementais, coleta, construção e crafting, NPCs, missões, mais biomas (montanhas dos Harpins)
e progressão.

## Roadmap (proposta)

1. **Protótipo 1**: este documento.
2. **Online**: servidor Node com WebSocket (reaproveita `src/server` e `src/shared`), contas,
   vários jogadores na vila.
3. **Harpins**: voo e planar, bioma de montanha, magias de vento, fogo, água e plasma.
4. **Sandbox**: coleta (madeira, pedra), crafting, inventário completo, construção.
5. **Conteúdo**: NPCs, missões, novos inimigos e equipamentos.
