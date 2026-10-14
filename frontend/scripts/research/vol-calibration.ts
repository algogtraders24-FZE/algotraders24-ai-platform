// R&D (not part of the product): is a volatility-based "expected range" honest and useful?
// Direction is hard to forecast (see smc-validation.ts); the SIZE of the next move is not: volatility
// clusters. This tests whether an ATR-scaled band, fitted on the first part of the sample, covers the
// out-of-sample move at its stated rate in every volatility regime - and compares it with a
// constant-percentage band, which should over-cover quiet periods and under-cover busy ones.
//
// usage: npx tsx scripts/research/vol-calibration.ts <ohlc.csv> [splitDate=2025-01-01]
import { readFileSync } from "node:fs";
import { atrSeries, type SmcCandle } from "../../services/smc/smc-engine";

const file = process.argv[2];
const SPLIT = process.argv[3] ?? "2025-01-01";
if (!file) throw new Error("csv path required");
const bars: (SmcCandle & { t: string })[] = readFileSync(file, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((r) => {
    const [t, o, h, l, c] = r.split(",");
    return { time: t.replace(" ", "T") + "Z", t, open: +o, high: +h, low: +l, close: +c };
  });

const atr = atrSeries(bars, 14);
const HORIZONS = [4, 12, 24];
const LEVELS = [0.5, 0.8, 0.9];
const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

interface P { i: number; t: string; ratio: number; atrPct: number; absMove: Record<number, number>; atrUnits: Record<number, number> }
const pts: P[] = [];
for (let i = 60; i < bars.length - 25; i++) {
  const a = atr[i];
  const avg = atr.slice(i - 48, i + 1).filter((v): v is number => v !== undefined);
  if (!a || avg.length < 40) continue;
  const mean49 = avg.reduce((s, v) => s + v, 0) / avg.length;
  const entry = bars[i + 1].open;
  const absMove: Record<number, number> = {};
  const atrUnits: Record<number, number> = {};
  for (const h of HORIZONS) {
    const m = Math.abs(bars[i + h].close - entry);
    absMove[h] = m / entry; // percent of price
    atrUnits[h] = m / (a * Math.sqrt(h)); // in sqrt-time ATR units
  }
  pts.push({ i, t: bars[i].t, ratio: a / mean49, atrPct: a / entry, absMove, atrUnits });
}
const IS = pts.filter((p) => p.t < SPLIT);
const OOS = pts.filter((p) => p.t >= SPLIT);
console.log("file=" + file + "  points=" + pts.length + "  in-sample=" + IS.length + "  out-of-sample=" + OOS.length + "  split=" + SPLIT);

const regime = (p: P) => (p.ratio > 1.3 ? "high" : p.ratio < 0.7 ? "low" : "normal");
for (const h of HORIZONS) {
  console.log("\n== horizon " + h + "h  (coverage of |move|; target vs achieved, OUT-OF-SAMPLE)");
  // ATR-scaled band: multiplier fitted on IS (quantile of |move| / (ATR*sqrt(h)))
  const mult: Record<number, number> = {};
  const constBand: Record<number, number> = {};
  for (const L of LEVELS) {
    mult[L] = q(IS.map((p) => p.atrUnits[h]), L);
    constBand[L] = q(IS.map((p) => p.absMove[h]), L);
  }
  console.log("  fitted ATR multipliers (x ATR*sqrt(h)): " + LEVELS.map((L) => L + "->" + mult[L].toFixed(2)).join("  "));
  for (const L of LEVELS) {
    const row: string[] = [];
    for (const reg of ["low", "normal", "high", "ALL"]) {
      const sel = OOS.filter((p) => reg === "ALL" || regime(p) === reg);
      if (sel.length < 30) { row.push(reg + ": n/a"); continue; }
      const atrCov = sel.filter((p) => p.atrUnits[h] <= mult[L]).length / sel.length;
      const cstCov = sel.filter((p) => p.absMove[h] <= constBand[L]).length / sel.length;
      row.push(reg + "(n=" + sel.length + "): ATR-band " + (atrCov * 100).toFixed(0) + "%  const-band " + (cstCov * 100).toFixed(0) + "%");
    }
    console.log("  target " + (L * 100).toFixed(0) + "%  " + row.join("   |   "));
  }
}
// how much of the next move's size does current volatility explain?
const corr = (x: number[], y: number[]) => {
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < x.length; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
for (const h of HORIZONS) {
  console.log("corr(current ATR% , realised |move|% @" + h + "h) OOS = " + corr(OOS.map((p) => p.atrPct), OOS.map((p) => p.absMove[h])).toFixed(3));
}

// per-regime multipliers (fitted in-sample per volatility regime) and their out-of-sample coverage at 80%
console.log("\n== per-regime 80% multipliers (x ATR*sqrt(h)), fitted in-sample; OOS coverage in brackets");
for (const h of HORIZONS) {
  const parts: string[] = [];
  for (const reg of ["low", "normal", "high"]) {
    const fit = IS.filter((p) => regime(p) === reg);
    const test = OOS.filter((p) => regime(p) === reg);
    if (fit.length < 50 || test.length < 30) { parts.push(reg + ": n/a"); continue; }
    const m = q(fit.map((p) => p.atrUnits[h]), 0.8);
    parts.push(reg + " " + m.toFixed(2) + " [" + ((test.filter((p) => p.atrUnits[h] <= m).length / test.length) * 100).toFixed(0) + "%]");
  }
  console.log("  h=" + h + "h  " + parts.join("   "));
}
