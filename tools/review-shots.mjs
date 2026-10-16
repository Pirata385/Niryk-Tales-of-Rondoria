// In-engine review sheets for the critic: the four bodies and the wolf side by side through the
// real pixel pipeline (?scene=lab&lineup), in a few poses and at game scale.
//
//   node tools/review-shots.mjs            -> .shots/review_*.png
import { chromium } from '@playwright/test';
import { GL_ARGS, shoot, startServer } from './shoot.mjs';

const SHOTS = [
  ['lineup_idle', '?scene=lab&lineup&zoom=2&anim=Idle&t=0.4'],
  ['lineup_back', '?scene=lab&lineup&zoom=2&anim=Idle&t=0.4&rot=180'],
  ['lineup_walk', '?scene=lab&lineup&zoom=2&anim=Walk&t=0.22&rot=90'],
  ['lineup_run', '?scene=lab&lineup&zoom=2&anim=Run&t=0.12&rot=90'],
  ['lineup_attack', '?scene=lab&lineup&zoom=2&anim=Attack1&t=0.2'],
  ['lineup_armor', '?scene=lab&lineup&zoom=2&anim=Idle&t=0.4&armor'],
  ['lineup_game_scale', '?scene=lab&lineup&zoom=1&anim=Idle&t=0.4'],
];

const { server, base } = await startServer();
const browser = await chromium.launch({ args: GL_ARGS });
let failed = false;
try {
  for (const [name, query] of SHOTS) {
    const r = await shoot(browser, base, query, `review_${name}`, 'desktop', { wait: 400 });
    console.log(`${r.file}  draws=${r.info?.calls} tris=${r.info?.triangles}`);
    if (r.errors.length) {
      failed = true;
      console.error(r.errors.join('\n'));
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
