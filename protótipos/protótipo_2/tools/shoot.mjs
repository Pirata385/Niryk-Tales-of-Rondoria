// Deterministic screenshots of the running game (Chromium + SwiftShader WebGL).
//
//   node tools/shoot.mjs                         -> the style-slice set (.shots/slice_*.png)
//   node tools/shoot.mjs "?scene=lab&anim=Run" lab_run [desktop,phone]   -> one URL
//   options (env): VIEW=1p|3p   LOOK=yaw,pitch (radians; yaw may be "spawn")   AT=x,z (teleport)
//                  RUN=ms (hold Shift+W for that much GAME time, shot while running)   WALK=ms
//                  KEYS=keys to hold while walking (default w)
//                  SHOTS=desktop,phone,phone_land (viewports)   WAIT=ms (before the shot)
//
// Every shot prints its draw calls and triangles; console errors are printed and fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone_land: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const BROWSER_PATH = process.env.PW_CHROMIUM;

export async function startServer() {
  // no file watching or hot reload: an edit while a test runs must not reload the page under it
  const server = await createServer({
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer.address();
  return { server, base: `http://127.0.0.1:${addr.port}/` };
}

export function launch() {
  return chromium.launch({ args: GL_ARGS, ...(BROWSER_PATH ? { executablePath: BROWSER_PATH } : {}) });
}

/** Holds keys for `ms` of wall time (SwiftShader frames are slow: the game runs on game time). */
export async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
}

/**
 * Holds keys until the game clock (server time) has advanced `seconds`: SwiftShader draws a frame
 * every second or two and the game caps each frame's step, so wall time says little.
 */
export async function holdGameTime(page, keys, seconds, wallLimitMs = 240_000) {
  const t0 = await page.evaluate(() => window.__niryk.time);
  for (const k of keys) await page.keyboard.down(k);
  const start = Date.now();
  while (Date.now() - start < wallLimitMs) {
    const t = await page.evaluate(() => window.__niryk.time);
    if (t - t0 >= seconds) return t - t0;
    await page.waitForTimeout(150);
  }
  throw new Error(`the game clock did not advance ${seconds} s`);
}

export async function release(page, keys) {
  for (const k of keys) await page.keyboard.up(k);
}

/**
 * Opens `query`, waits for the game, runs `opts.before(page)`, waits and shoots
 * .shots/<name>.png (the viewport name is appended unless opts.exactName).
 */
export async function shoot(browser, base, query, name, viewportName, opts = {}) {
  const vp = VIEWPORTS[viewportName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + query);
  await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 180_000 });
  if (opts.before) await opts.before(page);
  await page.waitForTimeout(opts.wait ?? 800);
  if (opts.during) await opts.during(page);
  mkdirSync('.shots', { recursive: true });
  const file = `.shots/${opts.exactName ? name : `${name}_${viewportName}`}.png`;
  const info = await page.evaluate(() => window.__niryk?.info ?? null);
  await page.screenshot({ path: file, timeout: 240_000 });
  if (opts.after) await opts.after(page);
  await ctx.close();
  return { file, errors, info };
}

/** A `before` step from the env options (VIEW, LOOK, AT, RUN, WALK, KEYS). */
function envSteps() {
  const view = process.env.VIEW;
  const look = process.env.LOOK?.split(',');
  const at = process.env.AT?.split(',').map(Number);
  const runMs = Number(process.env.RUN ?? 0);
  const walkMs = Number(process.env.WALK ?? 0);
  const keys = process.env.KEYS ? [...process.env.KEYS] : null;
  return {
    before: async (page) => {
      if (at) await page.evaluate(([x, z]) => window.__niryk.teleport(x, z), at);
      if (view) await page.evaluate((v) => window.__niryk.setView(v), view);
      if (look) {
        await page.evaluate(([y, p]) => {
          const n = window.__niryk;
          n.setLook(y === 'spawn' ? n.world.spawn.yaw : Number(y), Number(p));
        }, look);
      }
      if (at) await page.waitForTimeout(1200);
    },
    during: async (page) => {
      // keys stay held through the shot (released by `after`)
      if (runMs) await holdGameTime(page, ['Shift', 'w'], runMs / 1000);
      else if (walkMs) await holdGameTime(page, keys ?? ['w'], walkMs / 1000);
    },
    after: async (page) => release(page, ['Shift', 'w', ...(keys ?? [])]),
  };
}

/** The style slice: what the owner judges the look on. */
const SLICE = [
  { name: 'slice_3p_desktop', vp: 'desktop', query: '?play' },
  { name: 'slice_1p_desktop', vp: 'desktop', query: '?play', view: '1p', pitch: -0.12 },
  { name: 'slice_3p_phone', vp: 'phone', query: '?play' },
  { name: 'slice_3p_phone_land', vp: 'phone_land', query: '?play' },
  { name: 'slice_closeup', vp: 'desktop', query: '?scene=lab' },
  { name: 'slice_run', vp: 'desktop', query: '?play', run: 1400, pitch: -0.3 },
];

async function main() {
  const [query, name, vps] = process.argv.slice(2);
  const { server, base } = await startServer();
  const browser = await launch();
  let failed = false;
  const report = (r) => {
    console.log(`${r.file}  draws=${r.info?.calls ?? '?'} tris=${r.info?.triangles ?? '?'}`);
    if (r.errors.length) {
      failed = true;
      console.error(r.errors.join('\n'));
    }
  };
  try {
    if (query === undefined) {
      const only = process.env.ONLY?.split(',');
      for (const s of SLICE) {
        if (only && !only.some((o) => s.name.includes(o))) continue;
        const r = await shoot(browser, base, s.query, s.name, s.vp, {
          exactName: true,
          wait: 1500,
          before: async (page) => {
            if (s.view) await page.evaluate((v) => window.__niryk.setView(v), s.view);
            if (s.pitch !== undefined) await page.evaluate((p) => window.__niryk.setLook(window.__niryk.view.yaw, p), s.pitch);
          },
          during: s.run ? (page) => holdGameTime(page, ['Shift', 'w'], s.run / 1000) : undefined,
          after: s.run ? (page) => release(page, ['Shift', 'w']) : undefined,
        });
        report(r);
      }
    } else {
      const which = (vps ?? process.env.SHOTS ?? 'desktop').split(',');
      const steps = envSteps();
      for (const vp of which) report(await shoot(browser, base, query, name ?? 'shot', vp, { ...steps, wait: Number(process.env.WAIT ?? 1200) }));
    }
  } finally {
    await browser.close();
    await server.close();
  }
  process.exit(failed ? 1 : 0);
}

// run as a script (the folder name is not ASCII: compare paths, not URLs)
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) main();
