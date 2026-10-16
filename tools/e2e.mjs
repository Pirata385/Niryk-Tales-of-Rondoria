// End-to-end check of the prototype in a real browser (Chromium + SwiftShader WebGL):
// create a character, enter the world, walk, run, fight a wolf and wear the armor, on desktop,
// phone portrait and phone landscape (touch). Fails on any console error.
//
//   node tools/e2e.mjs            (screenshots of each step go to .shots/e2e_*.png)
//   SHOTS=desktop node tools/e2e.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { GL_ARGS, VIEWPORTS, startServer } from './shoot.mjs';

const RACE = { desktop: 'Humano', phone: 'Harpin', phone_land: 'Harpin' };
const GENDER = { desktop: 'Masculino', phone: 'Feminino', phone_land: 'Masculino' };

const state = (page) => page.evaluate(() => {
  const n = window.__niryk;
  return { me: n.me, wolves: n.wolves, equipment: n.equipment, time: n.time, draws: n.info?.calls, tris: n.info?.triangles };
});

function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`  ok  ${msg}`);
}

/** Touch drag on the left half (virtual joystick) through CDP, held for `ms`. */
async function joystick(page, cdp, dx, dy, ms) {
  const vp = page.viewportSize();
  const x = vp.width * 0.25;
  const y = vp.height * 0.6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 4, y: y + (dy * i) / 4, id: 1 }] });
  }
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function run(browser, base, vpName) {
  const vp = VIEWPORTS[vpName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const touch = vp.hasTouch;
  const shot = (step) => page.screenshot({ path: `.shots/e2e_${vpName}_${step}.png` });
  console.log(`\n[${vpName}]`);

  // 1. character creator
  await page.goto(base);
  await page.waitForFunction(() => window.__niryk?.scene === 'creator' && window.__niryk.ready, null, { timeout: 120_000 });
  await page.getByRole('button', { name: RACE[vpName], exact: true }).click();
  await page.getByRole('button', { name: GENDER[vpName], exact: true }).click();
  await page.getByRole('button', { name: 'Andar', exact: true }).click();
  await page.waitForTimeout(700);
  await shot('1_creator');
  await page.getByRole('button', { name: 'Entrar no mundo' }).click();
  check(await page.locator('.creator .error').textContent() !== '', 'empty name is refused');
  await page.locator('.creator input[type=text]').fill(vpName === 'desktop' ? 'Aldren' : 'Sylwe');
  await page.getByRole('button', { name: 'Entrar no mundo' }).click();

  // 2. in the world
  await page.waitForFunction(() => window.__niryk?.ready === true && window.__niryk.me, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  let s = await state(page);
  check(s.me.hp === 100, `entered the world with full health (draws=${s.draws}, tris=${s.tris})`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('niryk.character.v1') ?? 'null'));
  check(saved?.race === (RACE[vpName] === 'Harpin' ? 'harpin' : 'human'), 'character saved in the browser');
  await shot('2_world');

  // 3. walk, then run: speeds are measured in game time (a slow software-GL frame rate stretches
  //    wall-clock time, not the simulation)
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const moveFor = async (runFlag, ms) => {
    const s0 = await state(page);
    const a = s0.me;
    if (touch) await joystick(page, cdp, 0, runFlag ? -120 : -36, ms);
    else {
      if (runFlag) await page.keyboard.down('Shift');
      await page.keyboard.down('w');
      await page.waitForTimeout(ms);
      await page.keyboard.up('w');
      if (runFlag) await page.keyboard.up('Shift');
    }
    const s1 = await state(page);
    const b = s1.me;
    return Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.05, s1.time - s0.time);
  };
  const walked = await moveFor(false, 1000);
  check(walked > 1.0, `walks at ${walked.toFixed(2)} m/s (game time)`);
  await page.waitForTimeout(300);
  const ran = await moveFor(true, 1000);
  check(ran > walked * 1.6, `runs at ${ran.toFixed(2)} m/s`);
  await shot('3_moved');

  // 4. fight: go next to a wolf and swing until it takes damage
  s = await state(page);
  const wolf = s.wolves.filter((w) => w.hp > 0).sort((a, b) => Math.hypot(a.x - s.me.x, a.z - s.me.z) - Math.hypot(b.x - s.me.x, b.z - s.me.z))[0];
  check(!!wolf, `${s.wolves.length} wolves in the world`);
  await page.evaluate(([x, z]) => window.__niryk.teleport(x, z), [wolf.x + 1.2, wolf.z + 1.2]);
  await page.waitForTimeout(400);
  let hurt = false;
  for (let i = 0; i < 24 && !hurt; i++) {
    if (touch) await page.locator('.attack-btn').tap();
    else {
      // aim with the mouse at the wolf: keyboard attack auto-aims, a click aims at the cursor
      await page.keyboard.press(' ');
    }
    await page.waitForTimeout(260);
    const w = (await state(page)).wolves.find((x) => x.id === wolf.id);
    hurt = !w || w.hp < 60;
    if (i === 3) await shot('4_fight');
  }
  check(hurt, 'the wolf took sword damage');
  for (let i = 0; i < 30; i++) {
    const w = (await state(page)).wolves.find((x) => x.id === wolf.id);
    if (!w || w.hp <= 0) break;
    if (touch) await page.locator('.attack-btn').tap();
    else await page.keyboard.press(' ');
    await page.waitForTimeout(300);
  }
  s = await state(page);
  const w = s.wolves.find((x) => x.id === wolf.id);
  check(!w || w.hp <= 0, `the wolf was defeated (player hp ${Math.ceil(s.me.hp)})`);
  await shot('5_after_fight');

  // 5. equipment: wear the guard armor from the bag
  await page.getByRole('button', { name: 'Equipamento' }).click();
  await page.getByRole('button', { name: 'Equipar', exact: true }).click();
  await page.waitForFunction(() => window.__niryk.equipment?.armor === 'armor_guard', null, { timeout: 5000 });
  check(true, 'armor equipped');
  await page.waitForTimeout(600);
  await shot('6_equipment');
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.waitForTimeout(600);
  await shot('7_armored');

  await ctx.close();
  check(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`);
}

async function main() {
  mkdirSync('.shots', { recursive: true });
  const which = (process.env.SHOTS ?? 'desktop,phone,phone_land').split(',');
  const { server, base } = await startServer();
  const browser = await chromium.launch({ args: GL_ARGS });
  let failed = false;
  try {
    for (const vp of which) {
      try {
        await run(browser, base, vp);
      } catch (e) {
        failed = true;
        console.error(`  FAIL ${e.message}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(failed ? '\nE2E FAILED' : '\nE2E PASSED');
  process.exit(failed ? 1 : 0);
}

main();
