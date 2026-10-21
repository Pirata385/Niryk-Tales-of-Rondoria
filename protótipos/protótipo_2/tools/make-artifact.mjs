// Turns the single-file build (dist-single/index.html) into a page body for a claude.ai Artifact:
// the publisher wraps the page in its own <!doctype><html><head><body> skeleton (with charset and a
// viewport-fit=cover viewport), so we keep only the title, styles, scripts and body content.
//
//   npm run build:single && node tools/make-artifact.mjs [out.html]
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const src = readFileSync('dist-single/index.html', 'utf8');
const out = process.argv[2] ?? 'dist-single/artifact.html';

const head = src.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const title = head.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '<title>Niryk: Tales of Rondoria</title>';
// keep styles and scripts from the head; drop meta/charset/viewport/icon tags (the skeleton has them)
const keep = [...head.matchAll(/<(style|script)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);

const page = [
  title,
  // one deliberate look: the game is dark in every theme (the canvas paints the whole page)
  '<style>:root{color-scheme:dark;background:#1b1424}html,body{height:100%;background:#1b1424}</style>',
  ...keep,
  body.trim(),
].join('\n');

writeFileSync(out, page);
const mb = statSync(out).size / 1024 / 1024;
console.log(`${out}: ${mb.toFixed(2)} MB${mb > 16 ? '  (over the 16 MB artifact limit!)' : ''}`);
