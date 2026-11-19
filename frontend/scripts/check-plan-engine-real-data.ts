// scripts/check-plan-engine-real-data.ts
// One-off sanity run of the Pro Chart plan engine on REAL Exness H1 history (CSV exports in E:/at24_kill/live).
// Reports: how often a card is produced (market / limit / stand aside), geometry sanity, and the measured record per symbol and pooled.
// Run: npx tsx scripts/check-plan-engine-real-data.ts
import { readFileSync, readdirSync } from "node:fs";
import { planAt, measurePlanRecord, PLAN_RR } from "../lib/chart-engine/annotations/plan";
import type { ChartCandle } from "../types/chart-data";

const DIR = "E:/at24_kill/live";
const BARS = 2000;
const files = readdirSync(DIR).filter((f) => /^KX_.*_H1\.csv$/.test(f) && !f.includes("XAUEUR")).sort();

function load(f: string): ChartCandle[] {
  const lines = readFileSync(`${DIR}/${f}`, "utf8").trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const ix = (n: string) => head.indexOf(n);
  const out: ChartCandle[] = [];
  const seen = new Set<number>();
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    const t = Date.parse(c[ix("time")].replace(/\./g, "-").replace(" ", "T") + ":00Z");
    if (!Number.isFinite(t) || seen.has(t)) continue;
    seen.add(t);
    out.push({ time: t, open: +c[ix("open")], high: +c[ix("high")], low: +c[ix("low")], close: +c[ix("close")] });
  }
  return out.sort((a, b) => a.time - b.time);
}

function placebo(c: ChartCandle[], seed: number): ChartCandle[] {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const shapes = c.slice(1).map((k, i) => ({ gap: k.open - c[i].close, body: k.close - k.open, up: k.high - Math.max(k.open, k.close), dn: Math.min(k.open, k.close) - k.low }));
  for (let i = shapes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shapes[i], shapes[j]] = [shapes[j], shapes[i]]; }
  const out: ChartCandle[] = [{ ...c[0] }];
  shapes.forEach((sh, i) => {
    const prev = out[out.length - 1];
    const open = prev.close + sh.gap;
    const close = open + sh.body;
    out.push({ time: c[i + 1].time, open, close, high: Math.max(open, close) + sh.up, low: Math.min(open, close) - sh.dn });
  });
  return out;
}

let pooledN = 0, pooledR = 0, pooledHits = 0, symbolsWithRecord = 0, positive = 0;
let cards = { market: 0, limit: 0, aside: 0 };
let geometryBad = 0, geometryChecked = 0;
console.log("symbol".padEnd(10), "card now".padEnd(30), "trades", "avg R", "target-first");
for (const f of files) {
  const sym = f.split("_")[1];
  const all = load(f);
  if (all.length < 400) continue;
  const c = all.slice(-BARS);
  // geometry + card frequency on sampled bars (every 20th of the last 1000 bars)
  for (let i = Math.max(200, c.length - 1000); i < c.length; i += 20) {
    const p = planAt(c.slice(Math.max(0, i - 199), i + 1));
    if (p.state === "standAside") { cards.aside++; continue; }
    p.entryType === "market" ? cards.market++ : cards.limit++;
    geometryChecked++;
    const long = p.dir === "long";
    const ok = long ? p.stop < p.entry && p.entry < p.target : p.target < p.entry && p.entry < p.stop;
    const rr = Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop);
    if (!ok || Math.abs(rr - PLAN_RR) > 0.05) geometryBad++;
  }
  const now = planAt(c);
  const rec = measurePlanRecord(c);
  const nowText = now.state === "plan" ? `${now.dir} ${now.entryType} score ${now.score}` : "stand aside";
  console.log(sym.padEnd(10), nowText.padEnd(30), rec ? String(rec.n).padEnd(6) : "-".padEnd(6), rec ? rec.avgR.toFixed(2).padStart(5) : "  -  ", rec ? (rec.targetShare * 100).toFixed(0) + " %" : "");
  if (rec) { pooledN += rec.n; pooledR += rec.avgR * rec.n; pooledHits += rec.targetShare * rec.n; symbolsWithRecord++; if (rec.avgR > 0) positive++; }
}
const tot = cards.market + cards.limit + cards.aside;
console.log("\nCard frequency over sampled bars:", `market ${(cards.market / tot * 100).toFixed(0)} %, limit ${(cards.limit / tot * 100).toFixed(0)} %, stand aside ${(cards.aside / tot * 100).toFixed(0)} %  (n=${tot})`);
console.log(`Geometry: ${geometryChecked - geometryBad}/${geometryChecked} plans have stop < entry < target (or mirrored) and R:R = ${PLAN_RR}`);
console.log(`Pooled record (rule replayed, before spread/commission): ${pooledN} trades, avg ${(pooledR / pooledN).toFixed(3)} R, target first ${(pooledHits / pooledN * 100).toFixed(1)} %, symbols positive ${positive}/${symbolsWithRecord}`);
let pn = 0, pr = 0, ph = 0;
for (const f of files) {
  const all = load(f);
  if (all.length < 400) continue;
  const rec = measurePlanRecord(placebo(all.slice(-BARS), 20261119));
  if (rec) { pn += rec.n; pr += rec.avgR * rec.n; ph += rec.targetShare * rec.n; }
}
console.log(`PLACEBO (same candle shapes shuffled in time, structure destroyed): ${pn} trades, avg ${(pr / pn).toFixed(3)} R, target first ${(ph / pn * 100).toFixed(1)} %`);
console.log("Break-even target-first share for 2R with no costs = 33.3 %");
