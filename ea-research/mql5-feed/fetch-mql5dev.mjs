#!/usr/bin/env node
// Incremental research feed for the public Telegram channel t.me/mql5dev.
// Scrapes the public web preview (t.me/s/mql5dev), keeps only posts newer than
// the last seen id, tags them for relevance to AT24 EA production, and writes:
//   data/posts.jsonl          - append-only raw store (one post per line)
//   digests/YYYY-MM-DD.md     - human-readable daily digest, relevant posts first
//   state.json                - last seen post id
// No dependencies; needs Node 18+. Usage: node fetch-mql5dev.mjs [--backfill N]

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHANNEL = 'mql5dev';
const STATE = join(HERE, 'state.json');
const STORE = join(HERE, 'data', 'posts.jsonl');
const DIGESTS = join(HERE, 'digests');

// Topic -> keywords. A post can carry several tags; "high" topics drive the digest order.
const TOPICS = {
  'ea-execution': { high: true, re: /\b(OrderCheck|OrderSend|retcode|fill(ing)? mode|slippage|margin|trailing|position sizing|risk manage|stop[- ]?loss|drawdown|lot size)\b/i },
  'tester-validation': { high: true, re: /\b(strategy tester|backtest|optimi[sz]|walk[- ]forward|OnTester|frames?|overfit|monte carlo|robust|real ticks?|genetic)\b/i },
  'mcp-ai-platform': { high: true, re: /\b(MCP|Model Context Protocol|AI Assistant|build 6\d{3}|MetaTrader 5 build|LLM|ONNX|machine learning|neural|transformer)\b/i },
  'cost-spread': { high: true, re: /(spread|slippage|commission|swap|tick history|execution cost|trading cost|latency|rollover|liquidity)/i },
  'ea-architecture': { high: true, re: /\b(EA state|state persistence|persist|restart|multi[- ]symbol|basket|recovery|grid|global variable|contract (spec|report)|specification panel|template|framework|reusable|\.mqh)\b/i },
  'data-diagnostics': { high: false, re: /\b(SQLite|database|WebRequest|socket|Python|CSV export|dashboard|heatmap|journal)\b/i },
  'news-calendar': { high: false, re: /\b(economic calendar|news filter|CalendarValue|high[- ]impact)\b/i },
  'signal-logic': { high: false, re: /\b(indicator|EMA|RSI|MACD|divergence|regime|Markov|volatility|multi[- ]timeframe|swing|breakout|smart money|order block|fair value gap|FVG)\b/i },
  'gold-fx': { high: false, re: /\b(XAUUSD|gold|forex|EURUSD)\b/i },
};

const decode = (s) =>
  s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();

function parsePosts(html) {
  const posts = [];
  const re = /data-post="mql5dev\/(\d+)"([\s\S]*?)(?=data-post="mql5dev\/\d+"|<\/section>|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const id = Number(m[1]);
    const body = m[2];
    const text = (body.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    const datetime = (body.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    const links = [...(text || '').matchAll(/href="([^"]+)"/g)]
      .map((x) => x[1].replace(/&amp;/g, '&').replace(/&amp;/g, '&').replace(/[?&]utm_[^&]*/g, '').replace(/&$/, ''))
      .filter((u) => /^https?:\/\//.test(u));
    posts.push({ id, datetime: datetime || null, text: text ? decode(text) : '', links: [...new Set(links)] });
  }
  return posts.filter((p) => p.text || p.links.length);
}

async function fetchPage(before) {
  const url = `https://t.me/s/${CHANNEL}${before ? `?before=${before}` : ''}`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 AT24-research-feed' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return parsePosts(await res.text());
}

function tag(post) {
  const hay = `${post.text} ${post.links.join(' ')}`;
  const tags = Object.entries(TOPICS).filter(([, t]) => t.re.test(hay)).map(([k]) => k);
  const score = tags.reduce((n, k) => n + (TOPICS[k].high ? 2 : 1), 0);
  return { tags, score };
}

if (process.argv.includes('--retag')) {
  const rows = readFileSync(STORE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  writeFileSync(STORE, rows.map((p) => JSON.stringify({ ...p, ...tag(p) })).join('\n') + '\n');
  console.log(`Retagged ${rows.length} posts.`);
  process.exit(0);
}

const backfillArg = process.argv.indexOf('--backfill');
const backfill = backfillArg > -1 ? Number(process.argv[backfillArg + 1]) || 100 : 0;
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { lastId: 0 };

let fresh = [];
let before;
for (let page = 0; page < 30; page++) {
  const posts = await fetchPage(before);
  if (!posts.length) break;
  const newer = posts.filter((p) => p.id > state.lastId);
  fresh.push(...newer);
  const oldest = Math.min(...posts.map((p) => p.id));
  const stop = state.lastId > 0 ? newer.length < posts.length : fresh.length >= (backfill || 20);
  if (stop || oldest <= 1) break;
  before = oldest;
}

fresh = [...new Map(fresh.map((p) => [p.id, p])).values()].sort((a, b) => a.id - b.id);
if (!fresh.length) {
  console.log(`No new posts (lastId=${state.lastId}).`);
  process.exit(0);
}

mkdirSync(dirname(STORE), { recursive: true });
mkdirSync(DIGESTS, { recursive: true });
const enriched = fresh.map((p) => ({ ...p, ...tag(p), url: `https://t.me/${CHANNEL}/${p.id}` }));
appendFileSync(STORE, enriched.map((p) => JSON.stringify(p)).join('\n') + '\n');

const day = new Date().toISOString().slice(0, 10);
const digestPath = join(DIGESTS, `${day}.md`);
const sorted = [...enriched].sort((a, b) => b.score - a.score || b.id - a.id);
const lines = [`# mql5dev digest ${day}`, '', `${enriched.length} new posts (ids ${enriched[0].id}-${enriched.at(-1).id}).`, ''];
for (const p of sorted) {
  const first = p.text.split('\n').find(Boolean) || '(link only)';
  lines.push(`- **[${p.tags.join(', ') || 'untagged'}]** ${first.slice(0, 220)}  \n  ${p.url}${p.links[0] ? ` -> ${p.links[0]}` : ''}`);
}
appendFileSync(digestPath, (existsSync(digestPath) ? '\n' : '') + lines.join('\n') + '\n');

state.lastId = Math.max(state.lastId, ...enriched.map((p) => p.id));
state.lastRun = new Date().toISOString();
writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log(`Stored ${enriched.length} posts, lastId=${state.lastId}, digest: ${digestPath}`);
