/** Tiny pixel-art icons as inline SVG (16×16 grids, crisp edges). */

const PALETTE: Record<string, string> = {
  k: '#1b1424', // ink
  s: '#dfe4ea', // steel light
  m: '#9aa3ad', // steel
  d: '#5c6470', // steel dark
  g: '#c9a24a', // brass
  b: '#7a4e30', // leather
  r: '#c43a32', // red
  w: '#f0e3c4', // parchment
};

function pixelSvg(rows: string[]): string {
  const rects: string[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const fill = PALETTE[c];
      if (fill) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
    });
  });
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`;
}

export const ICONS: Record<string, string> = {
  icon_sword: pixelSvg([
    '............kk..',
    '...........ksk..',
    '..........ksmk..',
    '.........ksmk...',
    '........ksmk....',
    '.......ksmk.....',
    '......ksmk......',
    '..kk.ksmk.......',
    '..kgksmk........',
    '...kgmk.........',
    '...kbgk.........',
    '..kbkkgk........',
    '.kbk..kgk.......',
    'kgk....kk.......',
    'kk..............',
    '................',
  ]),
  icon_armor: pixelSvg([
    '................',
    '..kkk......kkk..',
    '.kmmsk....ksmmk.',
    '.kmssskkkksssmk.',
    '.kdmssmmmmssmdk.',
    '..kdmsssssssmk..',
    '..kmmsssgsssmk..',
    '..kmmssgggssmk..',
    '..kmmsssgsssmk..',
    '..kdmmssssmmdk..',
    '..kggggggggggk..',
    '..kdmmkmmkmmdk..',
    '..kdmk.kk.kmdk..',
    '...kk......kk...',
    '................',
    '................',
  ]),
  bag: pixelSvg([
    '................',
    '......kkkk......',
    '.....kbbbbk.....',
    '.....kb..bk.....',
    '...kkkkkkkkkk...',
    '..kbbbbbbbbbbk..',
    '..kbbbbggbbbbk..',
    '..kbbbbggbbbbk..',
    '..kbbbbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '...kkkkkkkkkk...',
    '................',
    '................',
    '................',
  ]),
  menu: pixelSvg([
    '................',
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kwwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '................',
    '..kkkkkkkkkkkk..',
    '..kwwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '................',
    '..kkkkkkkkkkkk..',
    '..kwwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ]),
};
