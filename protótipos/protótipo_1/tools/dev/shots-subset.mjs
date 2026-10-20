// Re-shoots only the review shots whose names contain one of the given words.
//   node tools/dev/shots-subset.mjs armor sword
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { GL_ARGS, shoot, startServer } from '../shoot.mjs';

const want = process.argv.slice(2);
const src = readFileSync('tools/review-shots.mjs', 'utf8');
const shots = [...src.matchAll(/\['([a-z_]+)', '(\?scene=[^']+)'\]/g)].map((m) => [m[1], m[2]]).filter(([n]) => want.some((w) => n.includes(w)));
const { server, base } = await startServer();
const browser = await chromium.launch({ args: GL_ARGS });
for (const [name, query] of shots) {
  const r = await shoot(browser, base, query, `review_${name}`, 'desktop', { wait: 400 });
  console.log(r.file, r.errors.length ? r.errors.join('\n') : '');
}
await browser.close();
await server.close();
