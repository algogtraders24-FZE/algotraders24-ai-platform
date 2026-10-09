#!/usr/bin/env node
// Live-results dataset: scrapes the public MQL5 Signals list (real track records: growth,
// drawdown, weeks live, trades, subscribers and their funds) and builds signals/SIGNALS_INDEX.md.
// Polite: one request per DELAY_MS, aborts on repeated errors. Pure local output.
// Usage: node fetch-signals.mjs [--pages N]   (default 10 pages per ordering)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'signals');
const DELAY_MS = 4000;
const UA = 'Mozilla/5.0 (compatible; AT24-research-feed; personal R&D archive)';
const PLATFORM = process.env.PLATFORM || 'mt5';
const pages = Number(process.argv[process.argv.indexOf('--pages') + 1]) || 10;
// quality = MQL5's own rating; funds = real subscriber money following the signal
const ORDERINGS = ['quality', 'subscribersdepositstotal'];

const num = (s) => { const m = String(s ?? '').replace(/&nbsp;|\s| | /g, '').match(/-?[\d.]+(?:,\d+)?[KM]?/i); if (!m) return null;
  let t = m[0].replace(',', ''); let mult = 1; if (/k$/i.test(t)) { mult = 1e3; t = t.slice(0, -1); } else if (/m$/i.test(t)) { mult = 1e6; t = t.slice(0, -1); }
  const v = Number(t); return Number.isFinite(v) ? v * mult : null; };
const cell = (row, cls) => (row.match(new RegExp(`class="col-${cls}[^"]*"[^>]*>([\\s\\S]*?)</div>`)) || [, ''])[1].replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').trim();
const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

function parse(html) {
  return html.split('<div class="row signal">').slice(1).map((row) => {
    const id = (row.match(/mql5\.com\/en\/signals\/(\d+)/) || [])[1];
    const title = decode((row.match(/title="&#x27;(.*?)&#x27; by ([^"]*)"/) || [])[0] || '');
    const name = decode((row.match(/<span class="name">([\s\S]*?)<\/span>/) || [, ''])[1]).trim();
    const author = decode((row.match(/&#x27; by ([^"]*)"/) || [, ''])[1]);
    const curve = ((row.match(/<input type="hidden" value="([^"]*)"/) || [, ''])[1]).split(',').map((x) => Number(x)).filter(Number.isFinite);
    return {
      id, name, author, real: /ico_state real/.test(row),
      priceUSD: num((row.match(/price-value">([^<]*)/) || [])[1]),
      growthPct: num(cell(row, 'growth')), profitPerMonthPct: num((row.match(/Profit\/Month: (-?[\d.]+)/) || [])[1]),
      subscribers: num(cell(row, 'subscribers')), fundsUSD: num(cell(row, 'facilities')), balanceUSD: num(cell(row, 'balance')),
      weeks: num(cell(row, 'weeks')), expertPct: num(cell(row, 'experts')), trades: num(cell(row, 'trades')),
      winPct: num(cell(row, 'plus')), activityPct: num(cell(row, 'activity')), profitFactor: num(cell(row, 'pf')),
      expectedPayoffUSD: num(cell(row, 'ep')), drawdownPct: num(cell(row, 'drawdown')), leverage: cell(row, 'leverage'), curve, _t: title,
    };
  }).filter((s) => s.id);
}

const all = new Map();
let fails = 0;
outer: for (const ord of ORDERINGS) {
  for (let p = 1; p <= pages; p++) {
    const url = `https://www.mql5.com/en/signals/${PLATFORM}/list${p > 1 ? `/page${p}` : ''}?orderby=${ord}`;
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
      if (res.status !== 200) { fails++; console.log(`${res.status} ${url}`); if (fails >= 4) break outer; await new Promise((r) => setTimeout(r, 60000)); continue; }
      const rows = parse(await res.text());
      for (const s of rows) all.set(s.id, { ...s, seenIn: [...(all.get(s.id)?.seenIn || []), `${ord}#${p}`] });
      fails = 0;
      if (!rows.length) break;
    } catch (e) { fails++; console.log(String(e).slice(0, 100)); if (fails >= 4) break outer; }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

const list = [...all.values()].map(({ _t, ...s }) => s);
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT, `signals-${PLATFORM}-${stamp}.json`), JSON.stringify(list, null, 1));

// ---- analysis ----
const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const f = (x, d = 0) => (x == null ? '-' : x.toFixed(d));
const THEMES = {
  'Gold / XAUUSD': /gold|xau|aurum/i, 'Scalper / HFT': /scalp|hft|pip|fast/i, 'Grid / martingale / hedge': /grid|martin|hedg|recover|averag/i,
  'AI / neural / GPT': /\bai\b|neural|gpt|deep|machine|smart/i, 'Breakout': /breakout|range/i, 'Pairs / stat-arb': /pair|arbitrage|correl/i,
  'Trend': /trend|momentum/i, 'Crypto': /btc|crypto|bitcoin|eth/i, 'Multi-EA / portfolio': /multi|portfolio|basket|diversif/i,
};
const robust = list.filter((s) => s.real && s.weeks >= 52 && s.trades >= 300 && s.drawdownPct != null && s.drawdownPct <= 35 && (s.profitFactor ?? 0) >= 1.3);
const byFunds = [...list].sort((a, b) => (b.fundsUSD ?? 0) - (a.fundsUSD ?? 0)).slice(0, 15);

const md = [`# MQL5 Signals: live track-record index (${stamp})`, '',
  `${list.length} public signals scraped (MQL5 quality ranking + largest subscriber funds). Real-money track records, not backtests.`, '',
  '**How to read it:** growth % is cumulative since the signal started and is not comparable across ages; weeks, drawdown and profit factor matter more. High growth with 50%+ drawdown is a martingale/grid risk profile, not a good sign. Past live results can still end abruptly. This is research input, not a recommendation.', '',
  `## Robust screen (real account, >=52 weeks, >=300 trades, drawdown <=35%, profit factor >=1.3): ${robust.length} signals`, '',
  '| Signal | Weeks | Trades | Win % | PF | Drawdown | Growth | Subscribers | Funds USD | Price/mo |', '|---|---|---|---|---|---|---|---|---|---|',
  ...robust.sort((a, b) => (b.fundsUSD ?? 0) - (a.fundsUSD ?? 0)).slice(0, 25).map((s) => `| [${s.name}](https://www.mql5.com/en/signals/${s.id}) | ${s.weeks} | ${s.trades} | ${f(s.winPct)} | ${f(s.profitFactor, 2)} | ${f(s.drawdownPct)}% | ${f(s.growthPct)}% | ${s.subscribers} | ${f(s.fundsUSD)} | ${f(s.priceUSD)} |`),
  '', '## By theme (keyword match on the signal name, so approximate)', '',
  '| Theme | Signals | Median weeks | Median drawdown | Median PF | Median trades | Total subscriber funds USD |', '|---|---|---|---|---|---|---|',
  ...Object.entries(THEMES).map(([t, re]) => { const g = list.filter((s) => re.test(s.name)); return `| ${t} | ${g.length} | ${f(med(g.map((s) => s.weeks)))} | ${f(med(g.map((s) => s.drawdownPct)))}% | ${f(med(g.map((s) => s.profitFactor)), 2)} | ${f(med(g.map((s) => s.trades)))} | ${f(g.reduce((a, s) => a + (s.fundsUSD || 0), 0))} |`; }),
  '', '## Where subscribers actually put money (top 15 by funds)', '',
  '| Signal | Funds USD | Subscribers | Weeks | Drawdown | PF | Growth |', '|---|---|---|---|---|---|---|',
  ...byFunds.map((s) => `| [${s.name}](https://www.mql5.com/en/signals/${s.id}) | ${f(s.fundsUSD)} | ${s.subscribers} | ${s.weeks} | ${f(s.drawdownPct)}% | ${f(s.profitFactor, 2)} | ${f(s.growthPct)}% |`), ''];
writeFileSync(join(OUT, `SIGNALS_INDEX_${PLATFORM}.md`), md.join('\n') + '\n');
console.log(`${list.length} signals, ${robust.length} pass the robust screen. Report: signals/SIGNALS_INDEX.md`);
