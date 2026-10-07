#!/usr/bin/env node
// Downloads the mql5.com pages (articles, code base, forum threads) linked from the stored
// mql5dev posts into content/<kind>_<id>.txt so they can be searched offline for R&D.
// Resumable (content/index.jsonl), polite (1 request per DELAY_MS), stops on repeated blocking.
// Usage: node fetch-content.mjs [--limit N] [--kind articles|code|forum] [--newest-first]

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'data', 'posts.jsonl');
const OUT = join(HERE, 'content');
const INDEX = join(OUT, 'index.jsonl');
const DELAY_MS = 900;
const MAX_BYTES = 400_000;
const UA = 'Mozilla/5.0 (compatible; AT24-research-feed; personal R&D archive)';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const limit = Number(arg('--limit')) || Infinity;
const kindFilter = arg('--kind');
const newestFirst = process.argv.includes('--newest-first');

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function extract(html) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]).trim();
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  body = decode(body).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return { title, text: body.slice(0, MAX_BYTES) };
}

function classify(url) {
  const m = url.match(/^https?:\/\/(?:www\.)?mql5\.com\/(?:[a-z]{2}\/)?(articles|code|forum)\/(\d+)/i)
    || url.match(/^https?:\/\/(?:www\.)?mql5\.com\/(?:[a-z]{2}\/)?(forum)\/(?:\d+\/)?(\d+)/i);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}

const posts = readFileSync(STORE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
posts.sort((a, b) => (newestFirst ? b.id - a.id : a.id - b.id));
const jobs = new Map();
for (const p of posts) {
  for (const link of p.links || []) {
    const c = classify(link);
    if (!c || (kindFilter && c.kind !== kindFilter)) continue;
    const key = `${c.kind}_${c.id}`;
    if (!jobs.has(key)) jobs.set(key, { key, kind: c.kind, id: c.id, url: `https://www.mql5.com/en/${c.kind}/${c.id}`, post: p.id });
  }
}

mkdirSync(OUT, { recursive: true });
const done = new Set(existsSync(INDEX) ? readFileSync(INDEX, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === 200).map((r) => r.key) : []);
const todo = [...jobs.values()].filter((j) => !done.has(j.key)).slice(0, limit);
console.log(`${jobs.size} linked pages known, ${done.size} already saved, ${todo.length} to fetch.`);

let fails = 0;
let n = 0;
for (const j of todo) {
  let status = 0;
  try {
    const res = await fetch(j.url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, redirect: 'follow' });
    status = res.status;
    if (res.status === 200) {
      const { title, text } = extract(await res.text());
      writeFileSync(join(OUT, `${j.key}.txt`), `URL: ${j.url}\nTITLE: ${title}\nTELEGRAM_POST: https://t.me/mql5dev/${j.post}\n\n${text}\n`);
      appendFileSync(INDEX, JSON.stringify({ key: j.key, url: j.url, post: j.post, status, title, chars: text.length }) + '\n');
      fails = 0;
    } else {
      appendFileSync(INDEX, JSON.stringify({ key: j.key, url: j.url, post: j.post, status }) + '\n');
      fails++;
      if (res.status === 429 || res.status === 403) await new Promise((r) => setTimeout(r, 30_000));
    }
  } catch (e) {
    fails++;
    appendFileSync(INDEX, JSON.stringify({ key: j.key, url: j.url, post: j.post, status: 0, error: String(e).slice(0, 120) }) + '\n');
  }
  if (++n % 50 === 0) console.log(`${n}/${todo.length} (last status ${status})`);
  if (fails >= 8) { console.log(`Stopping: ${fails} consecutive failures (last status ${status}). Re-run later to resume.`); break; }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
console.log(`Done this run: ${n} attempted.`);
