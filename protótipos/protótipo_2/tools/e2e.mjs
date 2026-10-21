// End-to-end check of the prototype in a real browser (Chromium + SwiftShader WebGL), on desktop
// (keyboard + mouse), phone portrait and phone landscape (touch: taps, joystick, look drag):
//   1. the character creator: Harpin options (plumes, its hair palette and styles), the Rosto
//      close-up (picking hair closes in, Corpo goes back), preview clips, Aleatório, the name
//      check, then the viewport's pick (desktop Humano, phone Harpin fêmea, phone landscape Humana)
//      and Entrar no mundo; a Harpin is checked in the world (plume slot tinted, wings, the wider
//      shoulder camera and the crosshair fade, first person hiding head, hair and temple feathers);
//   2. the village: walk, strafe, back-pedal and run (an open meadow), look around;
//   3. equipment: the panel (I or the bag), equip the Guard armor, close;
//   4. a sword combo, then a fight at a wolf den (debug teleport) until a wolf dies;
//   5. the death screen and the respawn at the plaza;
//   6. first person and back;
//   7. desktop: Novo personagem in the menu, back to the creator, a Harpin into the world (checked),
//      then a Harpin fêmea (checked) and a Humana.
// No page zoom on touch; fails on any console error.
//
//   node tools/e2e.mjs                  (screenshots of the steps go to .shots/e2e_*.png)
//   SHOTS=desktop node tools/e2e.mjs
//   Q=high node tools/e2e.mjs           (full quality; the default `low` keeps SwiftShader quick)
import { mkdirSync } from 'node:fs';
import { VIEWPORTS, launch, startServer } from './shoot.mjs';

const QUERY = `?debug&q=${process.env.Q ?? 'low'}`;
/** The character each viewport walks into the world with. */
const PICKS = {
  desktop: { race: 'human', gender: 'm', name: 'Aldren' },
  phone: { race: 'harpin', gender: 'f', name: 'Lyra' },
  phone_land: { race: 'human', gender: 'f', name: 'Mirela' },
};
const HARPIN_BLUE = '#3f72c4';

const state = (page) =>
  page.evaluate(() => {
    const n = window.__niryk;
    return { me: n.me, time: n.time, view: n.view, oneShot: n.oneShot, draws: n.info?.calls, tris: n.info?.triangles, kills: n.kills, dead: n.dead };
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

/** Waits for a condition on window.__niryk evaluated in the page (wall clock). */
const waitHook = (page, fn, arg, timeout = 180_000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

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

/**
 * The game world of seed 1, computed here through the dev server (the same shared modules the game
 * runs): an open meadow spot near the village for the movement checks (8 m free all around, far
 * from the wolf dens), and the dens.
 */
async function worldInfo(server) {
  const { generateWorld, GAME_WORLD } = await server.ssrLoadModule('/src/shared/world/worldgen.ts');
  const { CollisionWorld } = await server.ssrLoadModule('/src/shared/world/collision.ts');
  const w = generateWorld(1, GAME_WORLD);
  const col = new CollisionWorld(w.colliders, w.half);
  const free = (x, z) => {
    for (let d = 0; d <= 8; d += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (col.blocked(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.45)) return false;
      }
    }
    return true;
  };
  for (let r = 24; r < 70; r += 2) {
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (w.dens.some((d) => Math.hypot(d.x - x, d.z - z) < 30)) continue;
      if (free(x, z)) return { open: { x, z, yaw: Math.atan2(-x, -z) }, dens: w.dens, spawn: w.spawn };
    }
  }
  throw new Error('no open spot for the movement checks');
}

/** One finger held on the screen at (x, y) dragged by (dx, dy), through CDP. */
async function touchDrag(cdp, id, x, y, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5, id }] });
  }
}
const touchEnd = (cdp) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

/**
 * A Harpin in the world: the Plume slot carries the chosen color, it has wings and one hair style,
 * its shoulder camera sits wider with the crosshair fade on, and first person hides the head
 * nodes (head, hair, temple feathers) and drops what hangs on the head bone.
 */
async function harpinChecks(page, shot, tag) {
  const body = () => page.evaluate(() => window.__niryk.body);
  let b = await body();
  check(b.plumeMaterials > 0 && b.plume === b.plumeTint, `Harpin: ${b.plumeMaterials} plume materials tinted ${b.plume}${b.placeholder ? ' (stand-in body)' : ''}`);
  check(b.wingBones > 0 && b.hair.length === 1, `wings (${b.wingBones} wing nodes) and one hair style (${b.hair.join()})`);
  check(b.shoulder.side > 0.5 && b.shoulder.height > 1.6 && b.fade.center > 0, `the shoulder camera sits higher and wider (${b.shoulder.height} m, ${b.shoulder.side} m) and the wings clear the crosshair (fade ${b.fade.center})`);
  await page.evaluate(() => window.__niryk.setView('1p'));
  await waitHook(page, () => window.__niryk.body?.fade.hideHead === 1);
  b = await body();
  check(b.hiddenInFirstPerson > 0 && b.fade.center === 0, `first person hides ${b.hiddenInFirstPerson} head meshes and drops what hangs on the head`);
  await gameWait(page, 0.2);
  if (shot) await shot(`${tag}_1p`);
  await page.evaluate(() => window.__niryk.setView('3p'));
  await waitHook(page, () => window.__niryk.body?.fade.hideHead === 0 && window.__niryk.body.fade.center > 0);
  check(true, 'back in third person');
}

/** The creator: tries the Harpin options and the preview, then makes `pick` and enters the world. */
async function createCharacter(page, pick, touch, shot, opts = {}) {
  const press = (sel) => (touch ? page.locator(sel).first().tap() : page.locator(sel).first().click());
  const preview = () => page.evaluate(() => ({ ...window.__niryk.preview, app: window.__niryk.appearance }));
  const model = (m) => waitHook(page, (want) => window.__niryk?.scene === 'creator' && window.__niryk.preview.model === want && window.__niryk.ready, m);
  await waitHook(page, () => window.__niryk?.scene === 'creator' && window.__niryk.ready === true);
  if (opts.expectName) check((await preview()).app.name === opts.expectName, `the creator opens with the saved character (${opts.expectName})`);

  if (!opts.quick) {
    // Harpin: plumes, its own hair palette and styles
    await press('[data-field="race"] [data-value="harpin"]');
    await model(`harpin_${(await preview()).app.gender}`);
    const harpinUi = await page.evaluate(() => ({
      plume: document.querySelectorAll('[data-field="plumeColor"]').length,
      hair: document.querySelectorAll('[data-field="hairColor"] .swatch').length,
      styles: [...document.querySelectorAll('[data-field="hairStyle"] [data-value]')].map((b) => b.dataset.value),
    }));
    check(harpinUi.plume === 1 && harpinUi.hair === 7 && harpinUi.styles.join() === 'espetado,crista,plumado', `Harpin: plume colors, 7 hair colors, styles ${harpinUi.styles.join('/')}`);
    await press(`[data-field="plumeColor"] [data-value="${HARPIN_BLUE}"]`);
    await press('[data-field="hairStyle"] [data-value="crista"]');
    let p = await preview();
    check(p.app.race === 'harpin' && p.app.plumeColor === HARPIN_BLUE && p.app.hairStyle === 'crista', `picks plumes and a crest (preview ${p.model}${p.placeholder ? ', stand-in model' : ''})`);
    await waitHook(page, () => window.__niryk.preview.framing === 'face' && window.__niryk.preview.closeup > 0.95);
    check(true, 'picking hair closes in on the face (Rosto)');
    await shot('0_creator_face');
    await press('[data-field="framing"] [data-value="body"]');
    await waitHook(page, () => window.__niryk.preview.framing === 'body' && window.__niryk.preview.closeup < 0.05);
    check(true, 'Corpo frames the whole body again');
    // the preview clips
    await press('.preview-ui [data-mode="walk"]');
    await waitHook(page, () => window.__niryk.preview.mode === 'walk');
    await press('.preview-ui [data-mode="attack"]');
    await waitHook(page, () => window.__niryk.preview.oneShot?.startsWith('Attack'));
    check(true, 'the preview walks and attacks');
    await shot('0_creator_harpin');
    // a random look is always a valid one, and fills an empty name
    await press('.creator .actions .btn:not(.primary)');
    p = await preview();
    check(p.app.name.length >= 2, `Aleatório rolls a look and a name (${p.app.race} ${p.app.gender}, ${p.app.name})`);
    // the name is required
    await page.fill('#creator-name', '');
    await press('.creator .actions .primary');
    check((await page.textContent('.creator .error')).length > 0, 'an empty name is refused');
    await press('.preview-ui [data-mode="idle"]');
  }

  // the pick for this run
  await press(`[data-field="race"] [data-value="${pick.race}"]`);
  await press(`[data-field="gender"] [data-value="${pick.gender}"]`);
  await model(`${pick.race}_${pick.gender}`);
  if (pick.race === 'human') {
    const n = await page.evaluate(() => [document.querySelectorAll('[data-field="plumeColor"]').length, document.querySelectorAll('[data-field="hairColor"] .swatch').length]);
    check(n[0] === 0 && n[1] === 8, 'Humano: no plumes, 8 hair colors');
  }
  await page.fill('#creator-name', pick.name);
  await shot(`0_creator_${pick.race}_${pick.gender}`);
  await press('.creator .actions .primary');
  await waitHook(page, () => window.__niryk?.scene === 'game' && window.__niryk.ready === true && !!window.__niryk.me);
  const a = await page.evaluate(() => window.__niryk.appearance);
  check(a.race === pick.race && a.gender === pick.gender && a.name === pick.name, `enters the world as ${pick.name} (${pick.race} ${pick.gender})`);
  if (pick.race === 'harpin') await harpinChecks(page, opts.quick ? null : shot, `1_${pick.race}_${pick.gender}`);
}

async function run(browser, base, vpName, info) {
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
  const pick = PICKS[vpName];
  console.log(`\n[${vpName}]`);

  // 1. the creator, then into the village
  await page.goto(base + QUERY);
  loaded = true;
  await createCharacter(page, pick, touch, shot);
  let s = await state(page);
  check(s.me.hp === 100 && s.view.mode === '3p', `in the village, 3rd person, full health (draws=${s.draws}, tris=${s.tris})`);
  await shot('1_village');

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
  const tapAt = async (sel, id = 9) => {
    const b = await page.locator(sel).boundingBox();
    const p = { x: b.x + b.width / 2, y: b.y + b.height / 2, id };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** The mouse captured (desktop): click the middle of the view, which only captures it. */
  const capture = async () => {
    if (touch) return;
    await page.mouse.click(W / 2, H / 2);
    await page.waitForTimeout(300);
  };
  const release = async () => {
    if (touch) return;
    if ((await state(page)).view.locked) {
      await page.keyboard.press('Escape');
      await waitHook(page, () => !window.__niryk.view.locked);
    }
  };

  // 2. walk forward, strafe right, back-pedal, run (speeds in game time), on an open meadow
  await page.evaluate(([x, z, yaw]) => {
    window.__niryk.teleport(x, z);
    window.__niryk.setLook(yaw, -0.14);
  }, [info.open.x, info.open.z, info.open.yaw]);
  await gameWait(page, 0.4);
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

  // look around: mouse (pointer lock, or a drag where it is unavailable) or a drag on the right half
  s = await state(page);
  const yaw0 = s.view.yaw;
  if (touch) {
    await touchDrag(cdp, 2, W * 0.75, H * 0.45, -W * 0.18, 0);
    await touchEnd(cdp);
  } else {
    await capture();
    s = await state(page);
    if (s.view.locked) {
      await page.mouse.move(W / 2 - 120, H / 2, { steps: 6 });
    } else {
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

  // 3. equipment: open the panel, wear the Guard armor, close it
  if (touch) await page.locator('.bag-btn').tap();
  else await page.keyboard.press('i');
  await waitHook(page, () => window.__niryk.panel === 'equipment');
  check(!(await state(page)).view.locked, `${touch ? 'the bag' : 'I'} opens the equipment panel (the mouse is free)`);
  const eq0 = await page.evaluate(() => window.__niryk.equipment);
  check(eq0.weapon === 'sword_iron' && eq0.armor === null && eq0.items.includes('armor_guard'), 'the sword is worn, the armor is in the bag');
  await page.locator('[data-item="armor_guard"] [data-action="equip"]')[touch ? 'tap' : 'click']();
  await waitHook(page, () => window.__niryk.equipment.armor === 'armor_guard' && window.__niryk.equipment.armorParts.length > 0);
  const eq1 = await page.evaluate(() => window.__niryk.equipment);
  check(!eq1.items.includes('armor_guard') && (await page.locator('[data-slot="armor"] [data-action="unequip"]').count()) === 1, `wears the Guard armor (${eq1.armorParts[0] === 'placeholder' ? `${eq1.armorParts.length} stand-in plates` : eq1.armorParts.join(', ')})`);
  await shot('3_equipment');
  await page.locator('.modal.equipment .close-btn')[touch ? 'tap' : 'click']();
  await waitHook(page, () => window.__niryk.panel === null);
  check(true, 'closes the panel');
  await capture();

  // 4. attack: two presses make the combo (the second inside the first swing's chain window)
  const attack = async () => {
    if (touch) await tapAt('.attack-btn');
    else if ((await state(page)).view.locked) {
      await page.mouse.down();
      await page.mouse.up();
    } else await page.evaluate(() => window.__niryk.attack());
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
  await until(page, (x) => x.me.swing === null, 2, 'the swing to end');

  // 5. a wolf den: face the nearest wolf and fight until one falls
  const den = info.dens[0];
  const dd = Math.hypot(den.x, den.z);
  const near = [den.x - (den.x / dd) * 9, den.z - (den.z / dd) * 9];
  await page.evaluate(([x, z]) => window.__niryk.teleport(x, z), near);
  await gameWait(page, 0.3);
  let fightShot = false;
  let died = false;
  const t0 = (await state(page)).time;
  for (;;) {
    const f = await page.evaluate(() => {
      const k = window.__niryk;
      const me = k.me;
      let best = null;
      let bd = Infinity;
      for (const w of k.nearWolves) {
        const d = Math.hypot(w.x - me.x, w.z - me.z);
        if (w.hp > 0 && d < bd) {
          bd = d;
          best = w;
        }
      }
      if (best && !k.dead) k.lookAt(best.x, best.z);
      return { best, dist: bd, kills: k.kills, dead: k.dead, time: k.time, telegraph: k.nearWolves.some((w) => w.telegraph), bitten: k.events.some((e) => e.e === 'damage' && e.target !== e.source && k.nearWolves.every((w) => w.id !== e.target)) };
    });
    if (f.kills > 0) break;
    if (f.dead) {
      died = true;
      break;
    }
    if (f.time - t0 > 90) throw new Error('no wolf fell in 90 s of game time');
    if (f.best && f.dist < 2.9) await attack();
    if (f.telegraph && !fightShot) {
      fightShot = true;
      await shot('4_fight');
    }
    await gameWait(page, 0.08);
  }
  s = await state(page);
  check(s.kills > 0 || died, died ? 'fell to the pack before a kill (the death screen follows)' : `killed a wolf at the den (hp ${s.me.hp}/100)`);
  if (died && s.kills === 0) throw new Error('the pack won: no wolf killed');
  const bitten = await page.evaluate(() => window.__niryk.events.filter((e) => e.e === 'damage' && window.__niryk.nearWolves.every((w) => w.id !== e.target)).length);
  console.log(`  ..  bites taken in the last events: ${bitten}`);

  // 6. the death screen and the respawn at the plaza
  await release();
  if (!died) await page.evaluate(() => window.__niryk.kill());
  await waitHook(page, () => !!document.querySelector('.death button'));
  check(await page.locator('.death button').isDisabled(), 'the death screen shows, the respawn waits a moment');
  await shot('5_death');
  await waitHook(page, () => !document.querySelector('.death button')?.disabled, undefined, 240_000);
  await page.locator('.death button')[touch ? 'tap' : 'click']();
  s = await until(page, (x) => !x.dead && x.me.hp === 100, 3, 'the respawn');
  check(Math.hypot(s.me.x - info.spawn.x, s.me.z - info.spawn.z) < 1, 'Renascer na vila: back at the plaza with full health');
  await capture();

  // 7. first person and back (walking on the open meadow)
  await page.evaluate(([x, z, yaw]) => {
    window.__niryk.teleport(x, z);
    window.__niryk.setLook(yaw, -0.14);
  }, [info.open.x, info.open.z, info.open.yaw]);
  await gameWait(page, 0.4);
  if (touch) await page.locator('.view-btn').tap();
  else await page.keyboard.press('v');
  s = await until(page, (x) => x.view.mode === '1p' && x.view.fp === 1, 2, 'first person');
  check(s.view.fov > 60, `V / 1ª switches to first person (fov ${s.view.fov.toFixed(0)}°)`);
  await gameWait(page, 0.3);
  await shot('6_first_person');
  m = mover(['w'], 0, -0.6);
  r = await measure(page, m.act, m.stop, 0.6);
  check(r.fwd > 0.9, `walks forward in first person (${r.speed.toFixed(2)} m/s)`);
  if (touch) await page.locator('.view-btn').tap();
  else await page.keyboard.press('v');
  await until(page, (x) => x.view.mode === '3p' && x.view.fp === 0, 2, 'third person');
  check(true, 'and back to third person');

  // 8. touch: the page never zooms or scrolls (pinch spread on the canvas)
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.4, y: H * 0.4, id: 5 }, { x: W * 0.6, y: H * 0.6, id: 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W * 0.2, y: H * 0.2, id: 5 }, { x: W * 0.8, y: H * 0.8, id: 6 }] });
    await touchEnd(cdp);
    await page.waitForTimeout(300);
    const vv = await page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, sx: window.scrollX, sy: window.scrollY }));
    check(vv.scale === 1 && vv.sx === 0 && vv.sy === 0, `no page zoom or scroll (scale ${vv.scale})`);
  } else {
    // 9. Novo personagem: back to the creator (the saved character), Harpins and a Humana into the world
    let last = pick.name;
    for (const next of [
      { race: 'harpin', gender: 'm', name: 'Argnar' },
      { race: 'harpin', gender: 'f', name: 'Aeris' },
      { race: 'human', gender: 'f', name: 'Mirela' },
    ]) {
      await release();
      await page.locator('.menu-btn').click();
      await page.locator('.new-character').click();
      await createCharacter(page, next, false, shot, { quick: true, expectName: last });
      await gameWait(page, 0.3);
      await shot(`7_${next.race}_${next.gender}`);
      last = next.name;
    }
  }

  await ctx.close();
  check(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`);
}

async function main() {
  mkdirSync('.shots', { recursive: true });
  const which = (process.env.SHOTS ?? 'desktop,phone,phone_land').split(',');
  const { server, base } = await startServer();
  const info = await worldInfo(server);
  console.log(`open spot ${info.open.x.toFixed(1)}, ${info.open.z.toFixed(1)}; den ${info.dens[0].x.toFixed(1)}, ${info.dens[0].z.toFixed(1)}`);
  const browser = await launch();
  let failed = false;
  try {
    for (const vp of which) {
      try {
        await run(browser, base, vp, info);
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
