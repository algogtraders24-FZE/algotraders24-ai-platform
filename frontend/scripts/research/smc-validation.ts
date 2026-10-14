// R&D (not part of the product): does the SMC structure score carry any information about
// what price does next? Rolls the production engine (analyzeSmc, unchanged) over historical
// 1h candles exactly as the live service does (500 closed 1h bars + 300 closed 4h bars,
// decision at the close of a bar, entry at the NEXT bar's open - no look-ahead) and measures
// the forward move in the lean's direction, in ATR units, with block-bootstrap confidence
// intervals and an in-sample / out-of-sample split.
//
// usage: npx tsx scripts/research/smc-validation.ts <ohlc.csv> [step=2] [out.json]
//   csv header: time,open,high,low,close,... (1h, UTC)
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeSmc, DEFAULT_SMC_PARAMS, atrSeries, type SmcCandle, type SmcAnalysis } from "../../services/smc/smc-engine";

const file = process.argv[2];
const STEP = Number(process.argv[3] ?? 2);
const outFile = process.argv[4];
if (!file) throw new Error("csv path required");

const rows = readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1);
const bars: SmcCandle[] = rows.map((r) => {
  const [t, o, h, l, c] = r.split(",");
  return { time: t.replace(" ", "T") + "Z", open: +o, high: +h, low: +l, close: +c };
});

// 4h bars from the 1h bars (UTC blocks 00-04-08-...); lastIdx = index of the 4h bar's last 1h bar.
interface H4 extends SmcCandle {
  lastIdx: number;
  key: string;
}
const h4: H4[] = [];
for (let i = 0; i < bars.length; i++) {
  const d = new Date(bars[i].time);
  const key = bars[i].time.slice(0, 10) + "-" + Math.floor(d.getUTCHours() / 4);
  const last = h4[h4.length - 1];
  if (last && last.key === key) {
    last.high = Math.max(last.high, bars[i].high);
    last.low = Math.min(last.low, bars[i].low);
    last.close = bars[i].close;
    last.lastIdx = i;
  } else {
    h4.push({ time: bars[i].time, open: bars[i].open, high: bars[i].high, low: bars[i].low, close: bars[i].close, lastIdx: i, key });
  }
}
// a 4h bar counts only when it is complete (starts on a block boundary and a later bar exists)
const h4Complete = h4.filter((b, k) => new Date(b.time).getUTCHours() % 4 === 0 && k + 1 < h4.length);

const atr14 = atrSeries(bars, 14);
const HORIZONS = [4, 12, 24];
const WARM = 520;

interface Obs {
  i: number;
  t: string;
  lean: SmcAnalysis["lean"];
  strength: SmcAnalysis["strength"];
  score: number;
  dir: 1 | -1 | 0;
  bias: SmcAnalysis["bias"];
  factors: SmcAnalysis["factors"];
  fwd: Record<number, number>;
}
const obs: Obs[] = [];

let h4ptr = 0;
const t0 = Date.now();
for (let i = WARM; i < bars.length - Math.max(...HORIZONS) - 2; i += STEP) {
  const closed = bars.slice(i - 499, i + 1);
  while (h4ptr + 1 < h4Complete.length && h4Complete[h4ptr + 1].lastIdx <= i) h4ptr++;
  const htf = h4Complete.slice(Math.max(0, h4ptr - 299), h4ptr + 1).filter((b) => b.lastIdx <= i);
  const entry = bars[i + 1].open;
  const a = analyzeSmc(closed, entry, htf.length >= 30 ? htf : null, DEFAULT_SMC_PARAMS);
  if (!a) continue;
  const atr = atr14[i];
  if (!atr) continue;
  const dir: 1 | -1 | 0 = a.lean === "bullish-leaning" ? 1 : a.lean === "bearish-leaning" ? -1 : 0;
  const fwd: Record<number, number> = {};
  for (const h of HORIZONS) fwd[h] = (bars[i + h].close - entry) / atr;
  obs.push({ i, t: bars[i].time, lean: a.lean, strength: a.strength, score: a.score, dir, bias: a.bias, factors: a.factors, fwd });
}
console.error("scanned " + obs.length + " decision points in " + ((Date.now() - t0) / 1000).toFixed(1) + "s (step " + STEP + ")");

// -- stats ---------------------------------------------------------------
const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
function blockBootstrapCI(values: { v: number; block: number }[], reps = 600): [number, number] {
  if (values.length < 10) return [NaN, NaN];
  const blocks = new Map<number, number[]>();
  for (const { v, block } of values) {
    const b = blocks.get(block) ?? [];
    b.push(v);
    blocks.set(block, b);
  }
  const arr = [...blocks.values()];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    let n = 0;
    for (let k = 0; k < arr.length; k++) {
      const b = arr[Math.floor(rnd() * arr.length)];
      for (const v of b) {
        s += v;
        n++;
      }
    }
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]];
}
const blockOf = (o: Obs) => Math.floor(o.i / 120); // ~5 trading days: respects overlap / autocorrelation

interface Row {
  n: number;
  mean: number;
  hit: number;
  lo: number;
  hi: number;
}
function summarise(sel: Obs[], h: number, sign: (o: Obs) => number): Row {
  const vals = sel.map((o) => ({ v: sign(o) * o.fwd[h], block: blockOf(o) }));
  const m = mean(vals.map((x) => x.v));
  const [lo, hi] = blockBootstrapCI(vals);
  return { n: sel.length, mean: m, hit: vals.filter((x) => x.v > 0).length / (vals.length || 1), lo, hi };
}
const fmt = (r: Row) =>
  r.n === 0
    ? "n=0"
    : "n=" + String(r.n).padStart(5) + "  mean=" + r.mean.toFixed(3) + " ATR  hit=" + (r.hit * 100).toFixed(1) + "%  95%CI[" + r.lo.toFixed(3) + ", " + r.hi.toFixed(3) + "]" + (r.lo > 0 ? "  [significantly > 0]" : r.hi < 0 ? "  [significantly < 0]" : "");

const IS = (o: Obs) => o.t < "2025-01-01";
const lines: string[] = [];
const out = (s: string) => {
  lines.push(s);
  console.log(s);
};

out("file=" + file + " step=" + STEP + " points=" + obs.length + " from=" + obs[0]?.t + " to=" + obs[obs.length - 1]?.t);
out("\n== Baseline (all points, long): drift of the market itself");
for (const h of HORIZONS) out("  h=" + h + "h  " + fmt(summarise(obs, h, () => 1)));

const groups: [string, (o: Obs) => boolean][] = [
  ["lean any (bull+bear), signed in lean direction", (o) => o.dir !== 0],
  ["lean bullish-leaning", (o) => o.dir === 1],
  ["lean bearish-leaning", (o) => o.dir === -1],
  ["strength strong (>=70)", (o) => o.dir !== 0 && o.strength === "strong"],
  ["strength developing (55-69)", (o) => o.dir !== 0 && o.strength === "developing"],
  ["lean none (long-signed = market drift in those periods)", (o) => o.dir === 0],
];
const dirSign = (o: Obs) => (o.dir === 0 ? 1 : o.dir);
for (const [name, f] of groups) {
  out("\n== " + name);
  for (const h of HORIZONS) {
    const all = obs.filter(f);
    out("  h=" + String(h).padStart(2) + "h ALL " + fmt(summarise(all, h, dirSign)));
    out("        IS  " + fmt(summarise(all.filter(IS), h, dirSign)));
    out("        OOS " + fmt(summarise(all.filter((o) => !IS(o)), h, dirSign)));
  }
}

// Direction spread: the market drifted (Gold 1826 -> 4290 in this sample), so "signed return > 0" flatters
// bullish leans. The honest question is whether bullish-leaning is followed by a better move than
// bearish-leaning (and than no lean) - a difference of RAW forward means, resampled by week blocks.
function spreadCI(a: Obs[], b: Obs[], h: number, reps = 800): { diff: number; lo: number; hi: number } {
  const ba = new Map<number, number[]>();
  const bb = new Map<number, number[]>();
  for (const o of a) (ba.get(blockOf(o)) ?? ba.set(blockOf(o), []).get(blockOf(o))!).push(o.fwd[h]);
  for (const o of b) (bb.get(blockOf(o)) ?? bb.set(blockOf(o), []).get(blockOf(o))!).push(o.fwd[h]);
  const keys = [...new Set([...ba.keys(), ...bb.keys()])];
  const diffOf = (ks: number[]) => {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (const k of ks) {
      for (const v of ba.get(k) ?? []) { sa += v; na++; }
      for (const v of bb.get(k) ?? []) { sb += v; nb++; }
    }
    return na && nb ? sa / na - sb / nb : NaN;
  };
  const diff = diffOf(keys);
  let seed = 777;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const ds: number[] = [];
  for (let r = 0; r < reps; r++) {
    const ks: number[] = [];
    for (let k = 0; k < keys.length; k++) ks.push(keys[Math.floor(rnd() * keys.length)]);
    const d = diffOf(ks);
    if (!Number.isNaN(d)) ds.push(d);
  }
  ds.sort((x, y) => x - y);
  return { diff, lo: ds[Math.floor(ds.length * 0.025)], hi: ds[Math.floor(ds.length * 0.975)] };
}
const fmtSpread = (s: { diff: number; lo: number; hi: number }) =>
  "bull - bear raw fwd mean = " + s.diff.toFixed(3) + " ATR  95%CI[" + s.lo.toFixed(3) + ", " + s.hi.toFixed(3) + "]" + (s.lo > 0 ? "  [significant: bullish > bearish]" : s.hi < 0 ? "  [significant: wrong way]" : "  [not significant]");
out("\n== Direction spread (does bullish-leaning beat bearish-leaning, market drift removed?)");
const bull = obs.filter((o) => o.dir === 1);
const bear = obs.filter((o) => o.dir === -1);
const none = obs.filter((o) => o.dir === 0);
for (const h of HORIZONS) {
  out("  h=" + String(h).padStart(2) + "h raw fwd means: bull=" + mean(bull.map((o) => o.fwd[h])).toFixed(3) + "  none=" + mean(none.map((o) => o.fwd[h])).toFixed(3) + "  bear=" + mean(bear.map((o) => o.fwd[h])).toFixed(3));
  out("        ALL " + fmtSpread(spreadCI(bull, bear, h)));
  out("        IS  " + fmtSpread(spreadCI(bull.filter(IS), bear.filter(IS), h)));
  out("        OOS " + fmtSpread(spreadCI(bull.filter((o) => !IS(o)), bear.filter((o) => !IS(o)), h)));
}
out("  by strength, h=12h (bull - bear):");
for (const st of ["developing", "strong"] as const) {
  out("    " + st.padEnd(11) + " " + fmtSpread(spreadCI(bull.filter((o) => o.strength === st), bear.filter((o) => o.strength === st), 12)));
}
out("  by calendar year, h=12h (bull - bear):");
for (const y of ["2023", "2024", "2025", "2026"]) {
  out("    " + y + "        " + fmtSpread(spreadCI(bull.filter((o) => o.t.startsWith(y)), bear.filter((o) => o.t.startsWith(y)), 12)));
}

out("\n== Score bands among leaned points (signed in lean direction), h=12h");
for (const [lo, hi] of [
  [0, 55],
  [55, 62],
  [62, 70],
  [70, 101],
] as const) {
  out("  score " + lo + "-" + (hi - 1) + ": " + fmt(summarise(obs.filter((o) => o.dir !== 0 && o.score >= lo && o.score < hi), 12, dirSign)));
}

out("\n== Factor attribution (direction = chart bias; factor points > 0), h=12h, ALL / OOS");
const labels = [...new Set(obs.flatMap((o) => o.factors.map((f) => f.label)))];
const biasDir = (o: Obs) => (o.bias === "Bullish" ? 1 : o.bias === "Bearish" ? -1 : 0);
for (const label of labels) {
  const sel = obs.filter((o) => biasDir(o) !== 0 && (o.factors.find((f) => f.label === label)?.points ?? 0) > 0);
  out("  " + label.padEnd(22) + " ALL " + fmt(summarise(sel, 12, biasDir)));
  out("  " + "".padEnd(22) + " OOS " + fmt(summarise(sel.filter((o) => !IS(o)), 12, biasDir)));
}
out("  " + "(bias alone)".padEnd(22) + " ALL " + fmt(summarise(obs.filter((o) => biasDir(o) !== 0), 12, biasDir)));

if (outFile) writeFileSync(outFile, JSON.stringify({ file, step: STEP, points: obs.length, report: lines }, null, 2));
