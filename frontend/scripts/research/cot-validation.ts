// R&D (not part of the product): does CFTC Commitment-of-Traders positioning carry information about
// the next weeks' price moves? Legacy report, non-commercial ("speculator") net position as a share of
// open interest. Hypotheses, both tested out-of-sample with no look-ahead:
//   contrarian: crowded-long speculators (percentile >= 90) are followed by weaker returns than crowded-short (<= 10)
//   trend:      a rising net position (4-week change > 0) is followed by stronger returns than a falling one
// Timing: the report is "as of" Tuesday but published Friday ~19:30 UTC; the earliest tradable entry used is the NEXT
// Monday's daily open (forward returns measured from that open at +1, +2, +4 weeks). The percentile is computed on the
// trailing 156 weeks only (expanding before that, min 52), never on later data.
//
// usage: npx tsx scripts/research/cot-validation.ts <cotDir> <pricesDir>
//   cotDir contains x2017..x2026/annual.txt ; pricesDir contains PAXGUSDT_D.csv, EURUSDT_D.csv, BTCUSDT_D.csv
import { readFileSync, existsSync } from "node:fs";

const cotDir = process.argv[2];
const priceDir = process.argv[3];
if (!cotDir || !priceDir) throw new Error("usage: cot-validation.ts <cotDir> <pricesDir>");

interface Cot { date: string; net: number; oi: number }
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function loadCot(code: string): Cot[] {
  const rows: Cot[] = [];
  for (let y = 2017; y <= 2026; y++) {
    const f = cotDir + "/x" + y + "/annual.txt";
    if (!existsSync(f)) continue;
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    const head = parseCsvLine(lines[0]);
    const iDate = head.indexOf("As of Date in Form YYYY-MM-DD");
    const iCode = head.indexOf("CFTC Contract Market Code");
    const iOi = head.indexOf("Open Interest (All)");
    const iL = head.indexOf("Noncommercial Positions-Long (All)");
    const iS = head.indexOf("Noncommercial Positions-Short (All)");
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const c = parseCsvLine(line);
      if (c[iCode] !== code) continue;
      const oi = Number(c[iOi]);
      if (!oi) continue;
      rows.push({ date: c[iDate], net: Number(c[iL]) - Number(c[iS]), oi });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  // dedupe (a contract can appear in more than one annual file around year ends)
  return rows.filter((r, i) => i === 0 || r.date !== rows[i - 1].date);
}
interface Day { date: string; open: number }
function loadPrices(name: string): Day[] {
  return readFileSync(priceDir + "/" + name, "utf8").trim().split(/\r?\n/).slice(1).map((l) => {
    const [d, o] = l.split(",");
    return { date: d, open: +o };
  });
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

const HORIZONS = [1, 2, 4]; // weeks
interface Obs { date: string; pct: number | null; chg4: number | null; fwd: Record<number, number> }

function build(cot: Cot[], px: Day[]): Obs[] {
  const idx = new Map(px.map((d, i) => [d.date, i]));
  const share = cot.map((c) => c.net / c.oi);
  const obs: Obs[] = [];
  for (let k = 0; k < cot.length; k++) {
    // published Friday after the Tuesday as-of date; entry = open of the Monday after that
    const entryDate = addDays(cot[k].date, 6);
    const ei = idx.get(entryDate);
    if (ei === undefined) continue;
    const fwd: Record<number, number> = {};
    let ok = true;
    for (const h of HORIZONS) {
      const xi = idx.get(addDays(entryDate, 7 * h));
      if (xi === undefined) { ok = false; break; }
      fwd[h] = (px[xi].open - px[ei].open) / px[ei].open;
    }
    if (!ok) continue;
    const hist = share.slice(Math.max(0, k - 155), k + 1);
    const pct = hist.length >= 52 ? hist.filter((v) => v <= share[k]).length / hist.length : null;
    const chg4 = k >= 4 ? share[k] - share[k - 4] : null;
    obs.push({ date: cot[k].date, pct, chg4, fwd });
  }
  return obs;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
function diffCI(a: Obs[], b: Obs[], h: number, reps = 1000): { diff: number; lo: number; hi: number } {
  const blk = (o: Obs) => Math.floor(Date.parse(o.date) / (8 * 7 * 86400000));
  const A = new Map<number, number[]>();
  const B = new Map<number, number[]>();
  for (const o of a) { const k = blk(o); (A.get(k) ?? A.set(k, []).get(k)!).push(o.fwd[h]); }
  for (const o of b) { const k = blk(o); (B.get(k) ?? B.set(k, []).get(k)!).push(o.fwd[h]); }
  const keys = [...new Set([...A.keys(), ...B.keys()])];
  const dOf = (ks: number[]) => {
    const xa: number[] = [], xb: number[] = [];
    for (const k of ks) { xa.push(...(A.get(k) ?? [])); xb.push(...(B.get(k) ?? [])); }
    return xa.length && xb.length ? mean(xa) - mean(xb) : NaN;
  };
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const ds: number[] = [];
  for (let r = 0; r < reps; r++) {
    const ks: number[] = [];
    for (let i = 0; i < keys.length; i++) ks.push(keys[Math.floor(rnd() * keys.length)]);
    const d = dOf(ks);
    if (!Number.isNaN(d)) ds.push(d);
  }
  ds.sort((x, y) => x - y);
  return { diff: dOf(keys), lo: ds[Math.floor(ds.length * 0.025)], hi: ds[Math.floor(ds.length * 0.975)] };
}
const f = (x: number) => (x * 100).toFixed(2) + "%";
const sig = (r: { lo: number; hi: number }) => (r.lo > 0 ? "[significantly > 0]" : r.hi < 0 ? "[significantly < 0]" : "[not significant]");

const OOS_FROM = "2022-01-01";
const markets: [string, string, string][] = [
  ["Gold (COMEX 088691) vs PAXG proxy", "088691", "PAXGUSDT_D.csv"],
  ["Euro FX (CME 099741) vs EURUSDT proxy", "099741", "EURUSDT_D.csv"],
  ["Bitcoin (CME 133741) vs BTCUSDT", "133741", "BTCUSDT_D.csv"],
];
for (const [name, code, pf] of markets) {
  const cot = loadCot(code);
  const px = loadPrices(pf);
  const obs = build(cot, px);
  console.log("\n######## " + name + "   COT weeks=" + cot.length + "  usable observations=" + obs.length + "  " + obs[0]?.date + " .. " + obs[obs.length - 1]?.date);
  const crowdedLong = obs.filter((o) => o.pct !== null && o.pct >= 0.9);
  const crowdedShort = obs.filter((o) => o.pct !== null && o.pct <= 0.1);
  const rising = obs.filter((o) => o.chg4 !== null && o.chg4 > 0);
  const falling = obs.filter((o) => o.chg4 !== null && o.chg4 < 0);
  console.log("  unconditional mean fwd return: " + HORIZONS.map((h) => h + "w " + f(mean(obs.map((o) => o.fwd[h])))).join("  "));
  for (const h of HORIZONS) {
    const all = diffCI(crowdedLong, crowdedShort, h);
    const oos = diffCI(crowdedLong.filter((o) => o.date >= OOS_FROM), crowdedShort.filter((o) => o.date >= OOS_FROM), h);
    console.log("  CONTRARIAN h=" + h + "w  crowded-long(n=" + crowdedLong.length + ") minus crowded-short(n=" + crowdedShort.length + "): " + f(all.diff) + " CI[" + f(all.lo) + ", " + f(all.hi) + "] " + sig(all) + "   OOS(2022+): " + f(oos.diff) + " CI[" + f(oos.lo) + ", " + f(oos.hi) + "] " + sig(oos));
  }
  for (const h of HORIZONS) {
    const all = diffCI(rising, falling, h);
    const oos = diffCI(rising.filter((o) => o.date >= OOS_FROM), falling.filter((o) => o.date >= OOS_FROM), h);
    console.log("  TREND      h=" + h + "w  rising(n=" + rising.length + ") minus falling(n=" + falling.length + "): " + f(all.diff) + " CI[" + f(all.lo) + ", " + f(all.hi) + "] " + sig(all) + "   OOS(2022+): " + f(oos.diff) + " CI[" + f(oos.lo) + ", " + f(oos.hi) + "] " + sig(oos));
  }
}
