import { chromium } from '@playwright/test';
import { startServer, GL_ARGS, CHARACTERS } from '../shoot.mjs';
const { server, base } = await startServer();
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript((c) => localStorage.setItem('niryk.character.v1', c), JSON.stringify(CHARACTERS.harpin_f));
await page.goto(base);
await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const out = {};
  const s = window.__niryk.threeScene;
  s.traverseVisible((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints) return;
    let p = o; let top = o.name;
    while (p.parent && p.parent !== s) { p = p.parent; }
    const k = (p.name || p.type) + ' / ' + (o.layers.mask) + ' / ' + o.name + ' / ' + (o.material?.name ?? '');
    out[k] = (out[k] || 0) + 1;
  });
  return out;
});
console.log(r);
await browser.close(); await server.close();
