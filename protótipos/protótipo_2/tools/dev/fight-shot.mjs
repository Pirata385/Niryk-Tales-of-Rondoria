// Dev: a wolf fight in 3rd person. Teleports next to a den, wounds a wolf, waits for a bite
// warning and shoots .shots/<name>_<viewport>.png (warning ring and health bar in view).
//   node tools/dev/fight-shot.mjs [name] [viewport]      env: Q=low|medium|high VIEW=1p
import { launch, startServer, VIEWPORTS } from '../shoot.mjs';

const [name = 'fight', vpName = 'desktop'] = process.argv.slice(2);
const vp = VIEWPORTS[vpName];
const { server, base } = await startServer();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}?play&debug&q=${process.env.Q ?? 'medium'}`);
await page.waitForFunction(() => window.__niryk?.ready === true, null, { timeout: 180_000 });
const n = (f, a) => page.evaluate(f, a);
const time = () => n(() => window.__niryk.time);
async function waitGame(sec) {
  const t0 = await time();
  while ((await time()) - t0 < sec) await page.waitForTimeout(100);
}
const dens = await n(() => window.__niryk.world.dens);
const den = dens[0];
// stand by the den on the village side
const d = Math.hypot(den.x, den.z);
const off = Number(process.env.OFF ?? 9);
const at = [den.x - (den.x / d) * off, den.z - (den.z / d) * off];
await n(([x, z]) => window.__niryk.teleport(x, z), at);
await waitGame(0.6);
if (process.env.VIEW) await n((v) => window.__niryk.setView(v), process.env.VIEW);
// face the nearest wolf until one comes; hit it a couple of times
for (let i = 0; i < 80; i++) {
  const s = await n(() => {
    const k = window.__niryk;
    const me = k.me;
    let best = null;
    for (const w of k.nearWolves) if (w.hp > 0 && (!best || Math.hypot(w.x - me.x, w.z - me.z) < Math.hypot(best.x - me.x, best.z - me.z))) best = w;
    if (best) k.lookAt(best.x, best.z);
    return { best, me, hp: me.hp };
  });
  const dist = s.best ? Math.hypot(s.best.x - s.me.x, s.best.z - s.me.z) : 99;
  if (s.best && dist < 2.6 && s.best.hp === 60) await n(() => window.__niryk.attack());
  if (process.env.TRACE) console.log(i, JSON.stringify({ hp: s.hp, best: s.best && { id: s.best.id, hp: s.best.hp, anim: s.best.anim, t: s.best.telegraph }, ev: await n(() => window.__niryk.events.length) }));
  if (s.best && s.best.hp < 60 && s.best.telegraph) {
    await n(() => window.__niryk.freeze(true));
    break;
  }
  await waitGame(0.1);
}
await n((p) => window.__niryk.setLook(window.__niryk.view.yaw, p), Number(process.env.PITCH ?? -0.22));
await page.waitForTimeout(300);
const info = await n(() => ({ info: window.__niryk.info, wolves: window.__niryk.nearWolves, me: window.__niryk.me, events: window.__niryk.events.slice(-6) }));
await page.screenshot({ path: `.shots/${name}_${vpName}.png`, timeout: 240_000 });
if (process.env.TRACE) {
  console.log(JSON.stringify(await n(() => {
    const em = [];
    window.__niryk.threeScene.traverse((o) => {
      if (o.isMesh && o.material?.emissive && !o.userData.isOutline && o.material.emissive.r > 0) em.push([o.name, o.material.name, o.material.emissive.getHexString()]);
    });
    return { dmg: [...document.querySelectorAll('.dmg')].map((e) => [e.className, e.textContent, e.hidden, e.style.transform]), hurt: document.querySelector('.hurt').className, em, events: window.__niryk.events };
  })));
}
console.log(`.shots/${name}_${vpName}.png`, JSON.stringify(info));
if (errors.length) console.error(errors.join('\n'));
await browser.close();
await server.close();
