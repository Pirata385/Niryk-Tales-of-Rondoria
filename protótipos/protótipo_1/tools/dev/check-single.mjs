// Opens dist-single/index.html straight from disk (file://, no server) and checks the game boots.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { CHARACTERS, GL_ARGS } from '../shoot.mjs';

const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((c) => localStorage.setItem('niryk.character.v1', c), JSON.stringify(CHARACTERS.harpin_m));
await page.goto('file://' + resolve('dist-single/index.html'));
await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 180_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '.shots/single_desktop.png' });
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'single-file build OK');
process.exit(errors.length ? 1 : 0);
