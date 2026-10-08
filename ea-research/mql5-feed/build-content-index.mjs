#!/usr/bin/env node
// Topic index over the downloaded mql5.com pages (content/*.txt): per-topic top lists and an
// overall "most useful for AT24 EA production" shortlist, scored by weighted keyword density.
// Output: content/INDEX.md. Pure local; re-run any time while the download is still going.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'content');

// topic -> weighted keywords (weight = how directly it helps AT24 EA production work)
const TOPICS = {
  'Execution safety (orders, fills, retcodes)': { OrderCheck: 4, OrderSend: 2, retcode: 3, 'fill(ing)? mode': 4, 'requote': 3, 'slippage': 2, 'stops level': 3, 'freeze level': 3, 'trade server': 1, 'position ticket': 1 },
  'Spread / costs / broker specs': { 'spread': 2, 'commission': 2, 'swap': 2, 'tick history': 3, 'contract spec': 3, 'SYMBOL_': 1, 'rollover': 2, 'broker': 1 },
  'Risk & position sizing': { 'position siz': 3, 'risk (per trade|management|percent)': 3, 'drawdown': 2, 'Kelly': 3, 'OrderCalcProfit': 4, 'OrderCalcMargin': 4, 'daily loss': 3, 'equity protection': 3 },
  'Validation / Strategy Tester / optimization': { 'strategy tester': 3, 'walk[- ]forward': 4, 'overfit': 4, 'OnTester': 4, 'FrameAdd|FrameNext': 4, 'monte carlo': 3, 'out[- ]of[- ]sample': 3, 'real ticks': 3, 'optimi[sz]ation': 2, 'robust': 2 },
  'EA architecture / state / restart safety': { 'global variable': 3, 'state (persist|recover)': 4, 'restart': 3, 'multi[- ]symbol': 3, 'class .*CExpert|CTrade': 1, 'framework': 2, '\\.mqh': 1, 'unit test': 3, 'logging': 2 },
  'Data, logging & connectivity (SQLite, WebRequest)': { 'SQLite|DatabaseOpen': 4, 'WebRequest': 3, 'socket': 2, 'JSON': 1, 'CSV': 1, 'Telegram': 2, 'REST': 2 },
  'AI / ML / MCP': { 'MCP|Model Context Protocol': 4, 'AI Assistant': 3, 'ONNX': 4, 'machine learning': 2, 'neural': 2, 'LLM': 3, 'Python': 1 },
  'Gold / breakout / trend ideas': { 'XAUUSD|gold': 2, 'breakout': 2, 'ATR': 1, 'trend[- ]follow': 2, 'pyramid': 3, 'trailing stop': 2, 'break[- ]even': 2, 'regime': 2 },
};
const compiled = Object.fromEntries(Object.entries(TOPICS).map(([t, kws]) => [t, Object.entries(kws).map(([k, w]) => ({ k, w, re: new RegExp(k, 'gi') }))]));

const docs = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.txt'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const url = (raw.match(/^URL: (.*)$/m) || [])[1];
  const title = ((raw.match(/^TITLE: (.*)$/m) || [])[1] || f).replace(/&#x27;/g, "'").replace(/ - MQL5 Articles$/, '').replace(/^Free download of the /, '').replace(/ for MetaTrader 5 in the MQL5 Code Base.*$/, ' (code)');
  const body = raw.slice(raw.indexOf('\n\n') + 2);
  const len = Math.max(body.length, 3000);
  const kind = f.split('_')[0];
  const scores = {};
  const hits = {};
  for (const [t, kws] of Object.entries(compiled)) {
    let s = 0; const h = [];
    for (const { k, w, re } of kws) {
      const n = (body.match(re) || []).length;
      const tn = (title.match(re) || []).length;
      if (n || tn) { s += w * (Math.min(n, 30) / (len / 10000) ** 0.5 + 5 * tn); h.push(`${k.split('|')[0]}x${n}`); }
    }
    scores[t] = s; hits[t] = h.slice(0, 4);
  }
  docs.push({ f, url, title, kind, len, scores, hits });
}

const out = ['# MQL5 library: topic index', '', `${docs.length} pages indexed (${docs.filter((d) => d.kind === 'articles').length} articles, ${docs.filter((d) => d.kind === 'code').length} code, ${docs.filter((d) => d.kind === 'forum').length} forum). Generated ${new Date().toISOString().slice(0, 10)}.`,
  'Score = weighted keyword density (higher = more directly about the topic). Keyword based, so skim before trusting. Code-base pages are other authors\' work: take the technique, do not copy-paste code into AT24 products.', ''];
const total = (d) => Object.values(d.scores).reduce((a, b) => a + b, 0);
out.push('## Top 20 overall for AT24 EA production', '', '| # | Page | Type | Best topic | Matched |', '|---|---|---|---|---|');
docs.filter((d) => d.kind !== 'forum').sort((a, b) => total(b) - total(a)).slice(0, 20).forEach((d, i) => {
  const best = Object.entries(d.scores).sort((a, b) => b[1] - a[1])[0][0];
  out.push(`| ${i + 1} | [${d.title.slice(0, 90)}](${d.url}) | ${d.kind} | ${best} | ${d.hits[best].join(', ')} |`);
});
for (const t of Object.keys(TOPICS)) {
  out.push('', `## ${t}`, '');
  docs.sort((a, b) => b.scores[t] - a.scores[t]).slice(0, 8).filter((d) => d.scores[t] > 0).forEach((d) => out.push(`- [${d.title.slice(0, 100)}](${d.url}) (${d.kind}; ${d.hits[t].join(', ')})`));
}
writeFileSync(join(DIR, 'INDEX.md'), out.join('\n') + '\n');
console.log(out.slice(0, 32).join('\n'));
