// Opens a page (path argument) wrapped with a strict content policy and checks the game boots.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { CHARACTERS, GL_ARGS } from '../shoot.mjs';

const file = resolve(process.argv[2]);
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
