// End-to-end check of the style slice in a real browser (Chromium + SwiftShader WebGL): load,
// walk forward, strafe, back-pedal, run, look around, attack (two-hit combo), toggle first person,
// on desktop (keyboard + mouse), phone portrait and phone landscape (touch: joystick, look drag,
// buttons, no page zoom). Fails on any console error.
//
//   node tools/e2e.mjs                  (screenshots of each step go to .shots/e2e_*.png)
//   SHOTS=desktop node tools/e2e.mjs
//   Q=high node tools/e2e.mjs           (full quality; the default `low` keeps SwiftShader quick)
import { mkdirSync } from 'node:fs';
import { VIEWPORTS, launch, startServer } from './shoot.mjs';

const QUERY = `?play&debug&q=${process.env.Q ?? 'low'}`;

const state = (page) =>
  page.evaluate(() => {
    const n = window.__niryk;
    return { me: n.me, time: n.time, view: n.view, oneShot: n.oneShot, draws: n.info?.calls, tris: n.info?.triangles };
  });

function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`  ok  ${msg}`);
}

/** Waits until the game clock has advanced `seconds` (frames are slow under SwiftShader). */
async function gameWait(page, seconds, limitMs = 240_000) {
  const t0 = await page.evaluate(() => window.__niryk.time);
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    if ((await page.evaluate(() => window.__niryk.time)) - t0 >= seconds) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`game clock stuck (waited ${seconds} s of game time)`);
}

/** Waits until `pred(state)` holds, polling (game time limit `seconds`). */
async function until(page, pred, seconds, what) {
  const t0 = await page.evaluate(() => window.__niryk.time);
  const start = Date.now();
  for (;;) {
    const s = await state(page);
    if (pred(s)) return s;
    if (s.time - t0 > seconds || Date.now() - start > 240_000) throw new Error(`timed out waiting for ${what}`);
    await page.waitForTimeout(100);
  }
}

/**
 * Runs `act` (which starts some input), waits `seconds` of game time, runs `stop`, and returns the
 * motion: speed (m/s of game time) and the direction relative to the camera (forward, right).
 */
async function measure(page, act, stop, seconds = 1.0) {
  await act();
  await gameWait(page, 0.1); // the input is fully applied (a joystick drag takes a few frames)
  const a = await state(page);
  await gameWait(page, seconds);
  const b = await state(page);
  await stop();
  const dx = b.me.x - a.me.x;
  const dz = b.me.z - a.me.z;
  const dt = Math.max(0.05, b.time - a.time);
  const yaw = b.view.yaw;
  const len = Math.hypot(dx, dz) || 1;
  const fwd = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / len;
  const right = (-dx * Math.cos(yaw) + dz * Math.sin(yaw)) / len;
  await gameWait(page, 0.3); // let it settle
  return { speed: Math.hypot(dx, dz) / dt, fwd, right, yawGap: Math.abs(wrap(b.me.yaw - yaw)), b };
}

const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

/** One finger held on the screen at (x, y) dragged by (dx, dy), through CDP. */
async function touchDrag(cdp, id, x, y, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5, id }] });
  }
}
const touchEnd = (cdp) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

async function run(browser, base, vpName) {
  const vp = VIEWPORTS[vpName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('crash', () => errors.push('the page crashed'));
  page.on('framenavigated', (f) => f === page.mainFrame() && loaded && errors.push(`the page navigated to ${f.url()}`));
  let loaded = false;
  const touch = vp.hasTouch;
  const shot = (step) => page.screenshot({ path: `.shots/e2e_${vpName}_${step}.png`, timeout: 240_000 });
  console.log(`\n[${vpName}]`);

  // 1. load: straight into the clearing
  await page.goto(base + QUERY);
  await page.waitForFunction(() => window.__niryk?.ready === true && window.__niryk.me, null, { timeout: 180_000 });
  loaded = true;
  let s = await state(page);
  check(s.me.hp === 100 && s.view.mode === '3p', `in the clearing, 3rd person, full health (draws=${s.draws}, tris=${s.tris})`);
  await shot('1_start');

  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const W = vp.width;
  const H = vp.height;
  const joy = { x: W * 0.22, y: H * 0.7 };
  const R = Math.max(44, Math.min(70, Math.min(W, H) * 0.12));
  /** Movement for the step: keys on desktop, the joystick (vector in stick radii) on touch. */
  const mover = (keys, jx, jy) => ({
    act: async () => {
      if (touch) await touchDrag(cdp, 1, joy.x, joy.y, jx * R, jy * R);
      else for (const k of keys) await page.keyboard.down(k);
    },
    stop: async () => {
      if (touch) await touchEnd(cdp);
      else for (const k of keys) await page.keyboard.up(k);
    },
  });

  // 2. walk forward, strafe right, back-pedal, run (speeds in game time)
  let m = mover(['w'], 0, -0.6);
  let r = await measure(page, m.act, m.stop);
  check(r.speed > 1.5 && r.speed < 2.2 && r.fwd > 0.9, `walks forward at ${r.speed.toFixed(2)} m/s (forward ${r.fwd.toFixed(2)})`);
  m = mover(['d'], 0.6, 0);
  r = await measure(page, m.act, m.stop);
  check(r.speed > 1.5 && r.speed < 2.2 && r.right > 0.9 && r.yawGap < 0.15, `strafes right at ${r.speed.toFixed(2)} m/s, still facing the camera (gap ${r.yawGap.toFixed(2)} rad)`);
  m = mover(['s'], 0, 0.6);
  r = await measure(page, m.act, m.stop);
  check(r.speed > 1.0 && r.speed < 1.6 && r.fwd < -0.9 && r.yawGap < 0.15, `back-pedals at ${r.speed.toFixed(2)} m/s`);
  m = mover(['Shift', 'w'], 0, -1.6);
  r = await measure(page, async () => {
    await m.act();
    await gameWait(page, 0.25);
    await shot('2_run');
  }, m.stop);
  check(r.speed > 4.0 && r.fwd > 0.9, `runs at ${r.speed.toFixed(2)} m/s`);

  // 3. look around: mouse (pointer lock, or a drag where it is unavailable) or a drag on the right half
  s = await state(page);
  const yaw0 = s.view.yaw;
  if (touch) {
    await touchDrag(cdp, 2, W * 0.75, H * 0.45, -W * 0.18, 0);
    await touchEnd(cdp);
  } else {
    await page.mouse.click(W / 2, H / 2); // captures the mouse
    await page.waitForTimeout(300);
    s = await state(page);
    if (s.view.locked) {
      await page.mouse.move(W / 2 - 120, H / 2, { steps: 6 });
    } else {
      // no pointer lock here: drag to look
      await page.mouse.move(W / 2, H / 2);
      await page.mouse.down();
      await page.mouse.move(W / 2 - 120, H / 2, { steps: 6 });
      await page.mouse.up();
    }
    console.log(`  ..  pointer lock ${s.view.locked ? 'captured' : 'unavailable (drag look)'}`);
  }
  await gameWait(page, 0.2);
  s = await state(page);
  check(Math.abs(wrap(s.view.yaw - yaw0)) > 0.2, `the view turned by ${wrap(s.view.yaw - yaw0).toFixed(2)} rad`);
  await until(page, (x) => Math.abs(wrap(x.me.yaw - x.view.yaw)) < 0.05, 2, 'the body to face the camera');
  check(true, 'the body turned to face the camera');

  // 4. attack: two presses make the combo (the second inside the first swing's chain window)
  // touch: a finger straight on the ⚔ button (CDP is quicker than a locator tap: the combo has a window)
  const btn = touch ? await page.locator('.attack-btn').boundingBox() : null;
  const attack = async () => {
    if (touch) {
      const p = { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2, id: 9 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.down();
      await page.mouse.up();
    }
  };
  await attack();
  s = await until(page, (x) => x.me.swing === 'Attack1', 2, 'Attack1');
  check(s.oneShot === 'Attack1' || s.me.swing === 'Attack1', 'left click / ⚔ swings (Attack1)');
  // the chain window is 0.22-0.5 s into the swing (shared/constants.ts ATTACKS); a slow software
  // frame can step past it, so a missed window is retried
  let chained = false;
  for (let attempt = 0; attempt < 3 && !chained; attempt++) {
    if (attempt) {
      await until(page, (x) => x.me.swing === null, 2, 'the swing to end');
      await attack();
      await until(page, (x) => x.me.swing === 'Attack1', 2, 'Attack1');
    }
    await until(page, (x) => x.me.swing !== 'Attack1' || x.me.swingT >= 0.24, 2, 'the chain window');
    await attack();
    try {
      await until(page, (x) => x.me.swing === 'Attack2', 1, 'Attack2');
      chained = true;
    } catch {
      console.log('  ..  missed the chain window, again');
    }
  }
  check(chained, 'a second press chains the combo (Attack2)');
  await shot('3_attack');
  await until(page, (x) => x.me.swing === null, 2, 'the swing to end');

  // 5. first person and back
  if (touch) await page.locator('.view-btn').tap();
  else await page.keyboard.press('v');
  s = await until(page, (x) => x.view.mode === '1p' && x.view.fp === 1, 2, 'first person');
  check(s.view.fov > 60, `V / 1ª switches to first person (fov ${s.view.fov.toFixed(0)}°)`);
  await gameWait(page, 0.3);
  await shot('4_first_person');
  m = mover(['w'], 0, -0.6);
  r = await measure(page, m.act, m.stop, 0.6);
  check(r.fwd > 0.9, `walks forward in first person (${r.speed.toFixed(2)} m/s)`);
  if (touch) await page.locator('.view-btn').tap();
  else await page.keyboard.press('v');
  await until(page, (x) => x.view.mode === '3p' && x.view.fp === 0, 2, 'third person');
  check(true, 'and back to third person');

  // 6. touch: the page never zooms or scrolls (pinch spread on the canvas)
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.4, y: H * 0.4, id: 5 }, { x: W * 0.6, y: H * 0.6, id: 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W * 0.2, y: H * 0.2, id: 5 }, { x: W * 0.8, y: H * 0.8, id: 6 }] });
    await touchEnd(cdp);
    await page.waitForTimeout(300);
    const vv = await page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, sx: window.scrollX, sy: window.scrollY }));
    check(vv.scale === 1 && vv.sx === 0 && vv.sy === 0, `no page zoom or scroll (scale ${vv.scale})`);
  } else {
    await page.keyboard.press('Escape'); // releases the mouse
  }

  await ctx.close();
  check(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`);
}

async function main() {
  mkdirSync('.shots', { recursive: true });
  const which = (process.env.SHOTS ?? 'desktop,phone,phone_land').split(',');
  const { server, base } = await startServer();
  const browser = await launch();
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
