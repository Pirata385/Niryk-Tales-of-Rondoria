// Dev probe: opens the game and prints frame times, draw calls and triangles.
//   node tools/dev/probe.mjs [query] [viewport]
import { VIEWPORTS, launch, startServer } from '../shoot.mjs';

const [query = '', vpName = 'desktop'] = process.argv.slice(2);
const { server, base } = await startServer();
const browser = await launch();
const vp = VIEWPORTS[vpName];
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
const page = await ctx.newPage();
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e}`));
const t0 = Date.now();
await page.goto(base + query);
await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 180_000 });
console.log(`ready after ${Date.now() - t0} ms`);
const times = await page.evaluate(() => new Promise((res) => {
  const out = [];
  let last = performance.now();
  const f = () => {
    const now = performance.now();
    out.push(Math.round(now - last));
    last = now;
    if (out.length < 6) requestAnimationFrame(f);
    else res(out);
  };
  requestAnimationFrame(f);
}));
console.log('frame ms', times.join(' '));
// synced frame time: a 1-pixel readback waits for the GPU (SwiftShader: the CPU) to finish
const synced = await page.evaluate(() => new Promise((res) => {
  const gl = document.getElementById('game').getContext('webgl2');
  const px = new Uint8Array(4);
  const out = [];
  let last = performance.now();
  const f = () => {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const now = performance.now();
    out.push(Math.round(now - last));
    last = now;
    if (out.length < 4) requestAnimationFrame(f);
    else res(out);
  };
  requestAnimationFrame(f);
}));
console.log('synced frame ms', synced.join(' '));
console.log(JSON.stringify(await page.evaluate(() => ({ info: window.__niryk.info, world: window.__niryk.world, view: window.__niryk.view }))));
await browser.close();
await server.close();
