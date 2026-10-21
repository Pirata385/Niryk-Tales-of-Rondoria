// Opens a page wrapped with a strict content policy and checks the game boots (no fetch of data:
// or blob: URLs, no WebAssembly). Without an argument it wraps dist-single/artifact.html
// (npm run build:single) the way the Artifact host does.
//   node tools/dev/check-csp.mjs [page.html]
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch } from '../shoot.mjs';

const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'";
let file = process.argv[2] && resolve(process.argv[2]);
if (!file) {
  file = resolve('dist-single/csp-check.html');
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">`;
  writeFileSync(file, `${head}<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${readFileSync('dist-single/artifact.html', 'utf8')}\n</body></html>`);
  console.log(`artifact.html: ${(statSync('dist-single/artifact.html').size / 1024 / 1024).toFixed(2)} MB`);
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
// q=low only to keep the software renderer quick; the policy check is the same
await page.goto(`file://${file}?q=low`);
try {
  await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 240_000 });
} catch {
  errors.push('game never became ready');
}
const info = await page.evaluate(() => window.__niryk?.info ?? null);
mkdirSync('.shots', { recursive: true });
await page.screenshot({ path: '.shots/csp_desktop.png', timeout: 240_000 });
await browser.close();
console.log(`draws=${info?.calls ?? '?'} tris=${info?.triangles ?? '?'}`);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'boots under the strict policy');
process.exit(errors.length ? 1 : 0);
