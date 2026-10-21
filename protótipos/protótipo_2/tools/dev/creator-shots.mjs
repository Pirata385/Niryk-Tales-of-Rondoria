// Dev: creator screenshots for a few picks (race, gender, hair, framing, preview mode).
//   node tools/dev/creator-shots.mjs [viewport] [name,...]
import { launch, shoot, startServer } from '../shoot.mjs';

const vp = process.argv[2] ?? 'desktop';
const only = process.argv[3]?.split(',');
const picks = [
  { name: 'creator_human_f', clicks: [['gender', 'f'], ['hairStyle', 'rabo']], framing: 'body' },
  { name: 'creator_human_f_face', clicks: [['gender', 'f'], ['hairStyle', 'rabo']] },
  { name: 'creator_harpin_m', clicks: [['race', 'harpin']] },
  { name: 'creator_harpin_m_face', clicks: [['race', 'harpin'], ['framing', 'face']] },
  { name: 'creator_harpin_f', clicks: [['race', 'harpin'], ['gender', 'f']] },
  { name: 'creator_harpin_f_face', clicks: [['race', 'harpin'], ['gender', 'f'], ['eyeColor', '#3f6fa8']] },
  { name: 'creator_attack', clicks: [['race', 'harpin'], ['hairStyle', 'crista'], ['framing', 'body']], mode: 'attack', wait: 900 },
];
const { server, base } = await startServer();
const browser = await launch();
for (const p of picks) {
  if (only && !only.includes(p.name)) continue;
  const r = await shoot(browser, base, '?scene=creator&q=' + (process.env.Q ?? 'high'), p.name, vp, {
    wait: p.wait ?? 2500,
    before: async (page) => {
      for (const [field, value] of p.clicks) await page.click(`[data-field="${field}"] [data-value="${value}"]`);
      if (p.framing) await page.click(`[data-field="framing"] [data-value="${p.framing}"]`);
      await page.waitForFunction(() => window.__niryk.ready, null, { timeout: 120_000 });
      // the framing eases in over a few (slow, software-rendered) frames
      await page.waitForFunction(() => {
        const v = window.__niryk.preview;
        return Math.abs(v.closeup - (v.framing === 'face' ? 1 : 0)) < 0.02;
      }, null, { timeout: 120_000 });
      if (p.mode) await page.click(`.preview-ui [data-mode="${p.mode}"]`);
    },
  });
  console.log(r.file, JSON.stringify(r.info), r.errors.join('\n'));
}
await browser.close();
await server.close();
