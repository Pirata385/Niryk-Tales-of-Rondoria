// Deterministic screenshots of the running game for the critic and for visual checks.
//
//   node tools/shoot.mjs                      -> default set (desktop + phone portrait/landscape)
//   node tools/shoot.mjs "?scene=test" name   -> one URL, all default viewports
//   SHOTS=desktop node tools/shoot.mjs ...    -> restrict viewports
//   CHAR=harpin_f node tools/shoot.mjs "" game -> start in the game with a saved character
//   CHAR=human_m AT=30,12 node tools/shoot.mjs "" meadow -> ...teleported to (x, z) first
//
// Images go to .shots/<name>_<viewport>.png; console errors are printed and fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

export const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  phone_land: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function startServer() {
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer.address();
  return { server, base: `http://127.0.0.1:${addr.port}/` };
}

/** Saved characters for game shots (same shape as Appearance). */
export const CHARACTERS = {
  human_m: { name: 'Aldren', race: 'human', gender: 'm', skin: '#c68a5e', hairStyle: 'curto', hairColor: '#3b2619', plumeColor: '#ecebe6', eyeColor: '#3f6fa8', clothColor: '#5c8a44' },
  human_f: { name: 'Mirela', race: 'human', gender: 'f', skin: '#e8b994', hairStyle: 'longo', hairColor: '#a8432a', plumeColor: '#ecebe6', eyeColor: '#3f8a5c', clothColor: '#7a2f3a' },
  harpin_m: { name: 'Kaeru', race: 'harpin', gender: 'm', skin: '#d9a57c', hairStyle: 'crista', hairColor: '#3f72c4', plumeColor: '#3f72c4', eyeColor: '#8a7a3a', clothColor: '#7a5236' },
  harpin_f: { name: 'Sylwe', race: 'harpin', gender: 'f', skin: '#f3d2b8', hairStyle: 'plumado', hairColor: '#ecebe6', plumeColor: '#4f9a52', eyeColor: '#8a7a3a', clothColor: '#34507a' },
};

export async function shoot(browser, base, query, name, viewportName, opts = {}) {
  const vp = VIEWPORTS[viewportName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const page = await ctx.newPage();
  if (opts.character) {
    await page.addInitScript((c) => localStorage.setItem('niryk.character.v1', c), JSON.stringify(opts.character));
  }
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + query);
  await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 120_000 });
  if (opts.before) await opts.before(page);
  await page.waitForTimeout(opts.wait ?? 600);
  mkdirSync('.shots', { recursive: true });
  const file = `.shots/${name}_${viewportName}.png`;
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => window.__niryk?.info ?? null);
  await ctx.close();
  return { file, errors, info };
}

async function main() {
  const [query = '?scene=test&shot', name = 'test'] = process.argv.slice(2);
  const which = (process.env.SHOTS ?? 'desktop,phone,phone_land').split(',');
  const { server, base } = await startServer();
  const browser = await chromium.launch({ args: GL_ARGS });
  let failed = false;
  try {
    for (const vp of which) {
      const at = process.env.AT?.split(',').map(Number);
      const before = at ? (page) => page.evaluate(([x, z]) => window.__niryk.teleport(x, z), at) : undefined;
      const r = await shoot(browser, base, query, name, vp, { character: CHARACTERS[process.env.CHAR], before, wait: at ? 1500 : 600 });
      console.log(`${r.file}  draws=${r.info?.calls ?? '?'} tris=${r.info?.triangles ?? '?'}`);
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
}

if (import.meta.url === `file://${process.argv[1]}`) main();
