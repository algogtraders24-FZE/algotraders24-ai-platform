#!/usr/bin/env node
// Top-20 research: (A) live signals by category (gold / index / bitcoin / general FX) built from the
// public signal pages (traded-symbol distribution), (B) MQL5 Market EAs by category (rating, review
// count, price, author). Output: research/TOP20.md + research/*.json. Resumable (details cache).
// Usage: node research-top20.mjs signals|market|report
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'research');
mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (compatible; AT24-research-feed; personal R&D archive)';
const DELAY = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => { const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } }); return { status: r.status, text: r.status === 200 ? await r.text() : '' }; };
const mode = process.argv[2] || 'report';
const num = (s) => { const m = String(s ?? '').replace(/[\s  ]/g, '').match(/-?[\d.]+/); return m ? Number(m[0]) : null; };
const decode = (s) => (s || '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const DETAILS = join(OUT, 'signal-details.json');
const details = existsSync(DETAILS) ? JSON.parse(readFileSync(DETAILS, 'utf8')) : {};

function loadSignals() {
  const dir = join(HERE, 'signals');
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => /^signals-.*\.json$/.test(x))) {
    const plat = /mt4/.test(f) ? 'MT4' : 'MT5';
    for (const s of JSON.parse(readFileSync(join(dir, f), 'utf8'))) out.set(`${plat}:${s.id}`, { ...s, platform: plat });
  }
  const list = [...out.values()].filter((s) => s.real && s.weeks >= 52 && s.trades >= 300 && s.drawdownPct != null && s.growthPct != null && s.drawdownPct <= 40);
  for (const s of list) { s.annRet = (Math.pow(1 + s.growthPct / 100, 52 / s.weeks) - 1) * 100; s.retDD = s.annRet / Math.max(s.drawdownPct, 5); }
  return list;
}

if (mode === 'signals') {
  const list = loadSignals();
  const hint = /gold|xau|btc|bitcoin|crypto|us30|nas|dax|index|indice|dow|sp500|spx|ger|ndx/i;
  const picks = new Map();
  for (const s of list.filter((x) => hint.test(x.name))) picks.set(`${s.platform}:${s.id}`, s);
  for (const s of [...list].sort((a, b) => b.retDD - a.retDD).slice(0, 110)) picks.set(`${s.platform}:${s.id}`, s);
  const todo = [...picks.values()].filter((s) => !details[`${s.platform}:${s.id}`]);
  console.log(`${list.length} eligible signals, ${picks.size} picked, ${todo.length} to fetch`);
  let fails = 0, n = 0;
  for (const s of todo) {
    const { status, text } = await get(`https://www.mql5.com/en/signals/${s.id}`);
    if (status !== 200) { fails++; if (fails >= 5) { console.log('too many failures, stopping (resume later)'); break; } await sleep(60000); continue; }
    fails = 0;
    const syms = [...text.matchAll(/<td class="col-symbol">([^<]+)<\/td>\s*<td class="col-buy-sell col-right">(\d+)<\/td>/g)].map((m) => [m[1].trim(), Number(m[2])]);
    const hold = (text.match(/Average holding time[^<]*<[^>]*>\s*([^<]+)</i) || [])[1];
    details[`${s.platform}:${s.id}`] = { symbols: syms, hold: hold ? decode(hold) : null };
    if (++n % 20 === 0) { writeFileSync(DETAILS, JSON.stringify(details)); console.log(`${n}/${todo.length}`); }
    await sleep(DELAY);
  }
  writeFileSync(DETAILS, JSON.stringify(details));
  console.log('signals done');
}

if (mode === 'market') {
  const MARKET = join(OUT, 'market.json');
  const prods = existsSync(MARKET) ? JSON.parse(readFileSync(MARKET, 'utf8')) : {};
  const queries = { gold: ['gold', 'xauusd'], bitcoin: ['bitcoin', 'btcusd'], index: ['us30', 'nasdaq', 'dax', 'indices', 'us500'], general: [''] };
  for (const plat of ['mt5', 'mt4']) {
    for (const [cat, qs] of Object.entries(queries)) {
      for (const q of qs) {
        for (let p = 1; p <= (cat === 'general' ? 3 : 2); p++) {
          const url = `https://www.mql5.com/en/market/${plat}/expert${p > 1 ? `/page${p}` : ''}${q ? `?Filter=${q}` : ''}`;
          const { status, text } = await get(url);
          if (status !== 200) { console.log(status, url); await sleep(30000); continue; }
          for (const card of text.split('<div class="product-card">').slice(1)) {
            const id = (card.match(/\/en\/market\/product\/(\d+)/) || [])[1];
            if (!id) continue;
            const key = `${plat}:${id}`;
            const title = decode((card.match(/product-card__title-wrapper">([\s\S]*?)<\/span>/) || [])[1]);
            const rating = num((card.match(/g-rating__info">\s*([\d.]+)/) || [])[1]);
            const reviews = num((card.match(/g-rating__info">\s*[\d.]+\s*\((\d+)\)/) || [])[1]);
            const price = num((card.match(/product-card__price">\s*([\d.\s]+)USD/) || [])[1]);
            const author = decode((card.match(/product-card__author">([\s\S]*?)<\/div>/) || [])[1]);
            const desc = decode((card.match(/product-card__description">([\s\S]*?)<\/div>/) || [])[1]);
            const prev = prods[key] || { cats: [] };
            prods[key] = { key, id, platform: plat.toUpperCase(), title, author, price, rating, reviews, desc: desc.slice(0, 260), cats: [...new Set([...prev.cats, cat])] };
          }
          writeFileSync(MARKET, JSON.stringify(prods, null, 1));
          console.log(`${plat} ${cat} "${q}" p${p}: total ${Object.keys(prods).length}`);
          await sleep(DELAY);
        }
      }
    }
  }
  writeFileSync(MARKET, JSON.stringify(prods, null, 1));
  console.log('market done');
}

if (mode === 'report') {
  const list = loadSignals();
  const f0 = (x) => (x == null ? '-' : Math.round(x));
  const catOf = (s) => {
    const d = details[`${s.platform}:${s.id}`];
    if (!d || !d.symbols.length) return null;
    const tot = d.symbols.reduce((a, [, n]) => a + n, 0) || 1;
    const share = (re) => d.symbols.filter(([sym]) => re.test(sym)).reduce((a, [, n]) => a + n, 0) / tot;
    if (share(/XAU|GOLD/i) >= 0.6) return 'gold';
    if (share(/BTC|ETH|LTC|XRP/i) >= 0.6) return 'bitcoin';
    if (share(/US30|DJ|NAS|NDX|US100|USTEC|SPX|US500|SP500|DAX|GER|DE40|DE30|UK100|JP225|NIK|HK50|INDEX|\.cash/i) >= 0.6) return 'index';
    return 'fx';
  };
  const symStr = (s) => { const d = details[`${s.platform}:${s.id}`]; if (!d) return '-'; const tot = d.symbols.reduce((a, [, n]) => a + n, 0) || 1; return d.symbols.slice(0, 3).map(([k, n]) => `${k} ${Math.round((n / tot) * 100)}%`).join(', '); };
  const md = ['# Top-20 research (live signals + MQL5 Market EAs)', '', `Generated ${new Date().toISOString().slice(0, 10)}. Signals: real accounts, >=52 weeks, >=300 trades, drawdown <=40%; ranked by annualized return divided by drawdown (return/DD, drawdown floored at 5%). Annualized return is derived from MQL5's growth % and weeks live, so it reflects each signal's own risk setting. Survivorship-biased (top-ranked lists only), keyword/symbol-share classification, not a recommendation.`, ''];
  const withCat = list.map((s) => ({ ...s, cat: catOf(s) })).filter((s) => s.cat);
  md.push(`Signal pages classified: ${withCat.length} (symbol distribution fetched from each signal page).`, '');
  const sigTable = (rows) => ['| # | Signal | Plat | Main symbols | Ann. return | DD | Ret/DD | Weeks | PF | Win | Trades/wk | Funds $K |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((s, i) => `| ${i + 1} | [${s.name.slice(0, 30)}](https://www.mql5.com/en/signals/${s.id}) | ${s.platform} | ${symStr(s)} | ${f0(s.annRet)}% | ${f0(s.drawdownPct)}% | ${s.retDD.toFixed(1)} | ${s.weeks} | ${s.profitFactor ?? '-'} | ${f0(s.winPct)}% | ${(s.trades / s.weeks).toFixed(1)} | ${f0((s.fundsUSD || 0) / 1000)} |`)];
  md.push('## A. Top 20 live signals overall (by return/DD)', '', ...sigTable([...withCat].sort((a, b) => b.retDD - a.retDD).slice(0, 20)), '');
  for (const [cat, title] of [['gold', 'Gold (XAU) signals'], ['index', 'Index signals'], ['bitcoin', 'Bitcoin / crypto signals'], ['fx', 'General FX signals']]) {
    const rows = withCat.filter((s) => s.cat === cat).sort((a, b) => b.retDD - a.retDD).slice(0, 20);
    md.push(`## A. Top 20 ${title} (${withCat.filter((s) => s.cat === cat).length} qualifying found)`, '', ...(rows.length ? sigTable(rows) : ['_none qualified in the fetched set_']), '');
  }
  const MARKET = join(OUT, 'market.json');
  if (existsSync(MARKET)) {
    const prods = Object.values(JSON.parse(readFileSync(MARKET, 'utf8')));
    const score = (p) => (p.reviews || 0) * Math.pow((p.rating || 0) / 5, 3);
    const mt = (p) => ['| # | EA | Plat | Author | Price USD | Rating (reviews) | Snippet |', '|---|---|---|---|---|---|---|',
      ...p.map((x, i) => `| ${i + 1} | [${x.title.slice(0, 40)}](https://www.mql5.com/en/market/product/${x.id}) | ${x.platform} | ${x.author.slice(0, 22)} | ${x.price ?? '-'} | ${x.rating ?? '-'} (${x.reviews ?? 0}) | ${x.desc.slice(0, 110).replace(/\|/g, '/')} |`)];
    md.push('## B. MQL5 Market EAs (ranked by review count x rating^3; reviews are a popularity proxy, not profit proof)', '');
    for (const [cat, title] of [['gold', 'Gold'], ['index', 'Index'], ['bitcoin', 'Bitcoin'], ['general', 'General']]) {
      for (const plat of ['MT5', 'MT4']) {
        const rows = prods.filter((p) => p.cats.includes(cat) && p.platform === plat).sort((a, b) => score(b) - score(a)).slice(0, 20);
        md.push(`### ${title} EAs - ${plat} (top ${rows.length})`, '', ...(rows.length ? mt(rows) : ['_none_']), '');
      }
    }
  }
  writeFileSync(join(OUT, 'TOP20.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 40).join('\n'));
}
