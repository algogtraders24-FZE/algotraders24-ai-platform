#!/usr/bin/env node
// Builds a trend index from the stored mql5dev posts (data/posts.jsonl): which themes the
// MQL5 community is publishing about, per quarter, and which are rising or fading.
// Output: trends/TREND_INDEX.md (+ trends/themes.json). Pure local, no network.
// NOTE: this measures what is being PUBLISHED, not what makes money. Live results are a
// separate dataset (MQL5 Signals) - see the section at the bottom of the generated report.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const posts = readFileSync(join(HERE, 'data', 'posts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((p) => p.datetime);

const THEMES = {
  'AI assistant / MCP / LLM': /\b(MCP|Model Context Protocol|AI Assistant|LLM|ChatGPT|Claude|agentic|AI agent|copilot)\b/i,
  'Machine learning / neural nets / ONNX': /\b(neural|machine learning|ONNX|transformer|LSTM|reinforcement|deep learning|gradient boost|random forest|CatBoost|XGBoost|embedding|autoencoder)\b/i,
  'Python integration': /\b(python|pandas|numpy|jupyter)\b/i,
  'Smart-money / ICT price action': /\b(smart money|SMC|ICT|order block|fair value gap|FVG|liquidity (sweep|grab|zone)|market structure|BOS|CHoCH|supply and demand)\b/i,
  'Breakout / range': /\b(breakout|range break|Donchian|opening range|channel break)\b/i,
  'Trend following / moving averages': /\b(trend[- ]follow|moving average|EMA|SMA|Supertrend|ADX|Ichimoku)\b/i,
  'Mean reversion / pairs / stat-arb': /\b(mean[- ]revert|pairs trading|cointegration|stat(istical)? arbitrage|z-?score|Bollinger)\b/i,
  'Grid / martingale / recovery': /\b(grid|martingale|averaging|recovery zone|hedg(e|ing))\b/i,
  'Volatility / regime detection': /\b(volatility|ATR|regime|Markov|hidden Markov|entropy|Hurst|GARCH)\b/i,
  'Risk / position sizing / drawdown': /\b(risk manage|position siz|Kelly|drawdown|prop firm|daily loss|stop[- ]?out|equity protection|risk of ruin)\b/i,
  'Strategy Tester / optimization / validation': /\b(strategy tester|backtest|optimi[sz]|walk[- ]forward|overfit|monte carlo|out[- ]of[- ]sample|OnTester|robust)\b/i,
  'Execution / spread / broker costs': /\b(spread|slippage|execution|latency|commission|swap|broker|fill(ing)? mode|OrderSend|OrderCheck)\b/i,
  'News / economic calendar': /\b(economic calendar|news (filter|trading)|NFP|FOMC|CalendarValue)\b/i,
  'Multi-symbol / portfolio / correlation': /\b(multi[- ]symbol|portfolio|correlation|basket|currency strength|cross[- ]pair)\b/i,
  'Dashboards / panels / tooling': /\b(dashboard|panel|heatmap|inspector|exporter|utility|journal|GUI|control panel)\b/i,
  'Data / storage / connectivity': /\b(SQLite|database|WebRequest|socket|REST|API|Telegram|CSV|JSON|WebSocket)\b/i,
  'Copy trading / signals': /\b(copy trad|trade copier|signal provider|signals? service|mirror)\b/i,
  'Order flow / market depth / ticks': /\b(order flow|market depth|DOM|tick data|footprint|volume profile|cumulative delta)\b/i,
  'Gold / XAUUSD': /\b(XAUUSD|gold)\b/i,
  'Crypto': /\b(crypto|bitcoin|BTCUSD|ethereum|ETHUSD|Binance)\b/i,
};

const q = (d) => { const dt = new Date(d); return `${dt.getUTCFullYear()}Q${Math.floor(dt.getUTCMonth() / 3) + 1}`; };
const byQ = {};
for (const p of posts) {
  const k = q(p.datetime);
  (byQ[k] ||= { total: 0 }).total++;
  const hay = `${p.text} ${(p.links || []).join(' ')}`;
  for (const [name, re] of Object.entries(THEMES)) if (re.test(hay)) byQ[k][name] = (byQ[k][name] || 0) + 1;
}
const quarters = Object.keys(byQ).sort();
const last = quarters.slice(-2);          // most recent ~6 months
const prev = quarters.slice(-6, -2);      // the 12 months before that
const share = (qs, name) => {
  const tot = qs.reduce((a, k) => a + byQ[k].total, 0);
  return tot ? qs.reduce((a, k) => a + (byQ[k][name] || 0), 0) / tot : 0;
};

const rows = Object.keys(THEMES).map((name) => {
  const s1 = share(last, name), s0 = share(prev, name);
  const ratio = s0 > 0 ? s1 / s0 : s1 > 0 ? Infinity : 1;
  return { name, recent: s1, before: s0, ratio, perQ: quarters.map((k) => byQ[k][name] || 0) };
}).sort((a, b) => b.recent - a.recent);

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const arrow = (r) => (r === Infinity || r >= 1.5 ? 'RISING' : r >= 1.15 ? 'up' : r <= 0.67 ? 'FADING' : r <= 0.87 ? 'down' : 'flat');
const spark = (arr) => { const m = Math.max(...arr, 1); return arr.slice(-12).map((v) => ' .:-=+*#%@'[Math.min(9, Math.round((v / m) * 9))]).join(''); };

const recentCut = new Date(Date.now() - 90 * 864e5).toISOString();
const topFor = (name) => posts.filter((p) => p.datetime >= recentCut && THEMES[name].test(`${p.text} ${(p.links || []).join(' ')}`))
  .slice(-4).reverse().map((p) => `  - ${p.datetime.slice(0, 10)} ${(p.text.split('\n').find(Boolean) || '').slice(0, 130)} (https://t.me/mql5dev/${p.id})`);

const out = [];
out.push('# MQL5 community trend index', '');
out.push(`Source: ${posts.length} mql5dev posts, ${quarters[0]} to ${quarters.at(-1)}. Generated ${new Date().toISOString().slice(0, 10)}.`);
out.push(`"Recent" = ${last.join('+')}; "before" = ${prev[0]}..${prev.at(-1)}. Share = % of all posts mentioning the theme (keyword match, so approximate).`);
out.push('', '**This shows what is being PUBLISHED about, not what earns money.** A rising theme is attention, not proof of profit.', '');
out.push('| Theme | Recent share | Before | Trend | Last 12 quarters |', '|---|---|---|---|---|');
for (const r of rows) out.push(`| ${r.name} | ${pct(r.recent)} | ${pct(r.before)} | ${arrow(r.ratio)} | \`${spark(r.perQ)}\` |`);
out.push('', '## Rising themes: latest posts (last 90 days)', '');
for (const r of rows.filter((x) => ['RISING', 'up'].includes(arrow(x.ratio)))) {
  out.push(`### ${r.name} (${arrow(r.ratio)}, ${pct(r.before)} -> ${pct(r.recent)})`, ...topFor(r.name), '');
}
out.push('## Not covered here: live / real-time results', '',
  'Community posts and articles mostly show backtests. Live track records live in MQL5 Signals (growth, drawdown, age, subscribers) and Market ratings; that data is not in this library yet.', '');

mkdirSync(join(HERE, 'trends'), { recursive: true });
writeFileSync(join(HERE, 'trends', 'TREND_INDEX.md'), out.join('\n') + '\n');
writeFileSync(join(HERE, 'trends', 'themes.json'), JSON.stringify({ quarters, rows }, null, 1));
console.log(out.slice(0, 32).join('\n'));
