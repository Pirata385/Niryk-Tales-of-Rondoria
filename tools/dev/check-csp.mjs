// Opens a page wrapped with a strict content policy and checks the game boots. Without an argument
// it wraps dist-single/artifact.html (npm run build:single) the way the Artifact host does.
//   node tools/dev/check-csp.mjs [page.html]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHARACTERS, GL_ARGS } from '../shoot.mjs';

const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'";
let file = process.argv[2] && resolve(process.argv[2]);
if (!file) {
  file = resolve('dist-single/csp-check.html');
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">`;
  writeFileSync(file, `${head}<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${readFileSync('dist-single/artifact.html', 'utf8')}\n</body></html>`);
}
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((c) => localStorage.setItem('niryk.character.v1', c), JSON.stringify(CHARACTERS.harpin_f));
await page.goto('file://' + file);
try {
  await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 180_000 });
} catch {
  errors.push('game never became ready');
}
await page.waitForTimeout(800);
await page.screenshot({ path: '.shots/csp_desktop.png' });
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'boots under the strict policy');
process.exit(errors.length ? 1 : 0);
