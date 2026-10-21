// Dev: creator screenshots for a few picks (race, gender, hair, preview mode).
//   node tools/dev/creator-shots.mjs [viewport]
import { launch, shoot, startServer } from '../shoot.mjs';

const vp = process.argv[2] ?? 'desktop';
const picks = [
  { name: 'creator_harpin_m', clicks: [['race', 'harpin']] },
  { name: 'creator_harpin_f', clicks: [['race', 'harpin'], ['gender', 'f']] },
  { name: 'creator_human_f', clicks: [['gender', 'f'], ['hairStyle', 'rabo']] },
  { name: 'creator_attack', clicks: [['race', 'harpin'], ['hairStyle', 'crista']], mode: 'attack', wait: 900 },
];
const { server, base } = await startServer();
const browser = await launch();
for (const p of picks) {
  const r = await shoot(browser, base, '?scene=creator&q=' + (process.env.Q ?? 'high'), p.name, vp, {
    wait: p.wait ?? 1500,
    before: async (page) => {
      for (const [field, value] of p.clicks) await page.click(`[data-field="${field}"] [data-value="${value}"]`);
      await page.waitForFunction(() => window.__niryk.ready, null, { timeout: 120_000 });
      if (p.mode) await page.click(`.preview-ui [data-mode="${p.mode}"]`);
    },
  });
  console.log(r.file, JSON.stringify(r.info), r.errors.join('\n'));
}
await browser.close();
await server.close();
