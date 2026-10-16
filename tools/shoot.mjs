// Deterministic screenshots of the running game for the critic and for visual checks.
//
//   node tools/shoot.mjs                      -> default set (desktop + phone portrait/landscape)
//   node tools/shoot.mjs "?scene=test" name   -> one URL, all default viewports
//   SHOTS=desktop node tools/shoot.mjs ...    -> restrict viewports
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

export async function shoot(browser, base, query, name, viewportName, opts = {}) {
  const vp = VIEWPORTS[viewportName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const page = await ctx.newPage();
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
      const r = await shoot(browser, base, query, name, vp);
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
