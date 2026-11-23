// scripts/validate-indicator-golden.ts - accuracy check of the chart indicators against golden files (real MT5 candles + reference values from
// independent implementations, see scripts/indicator-golden/make_reference.py). Run: npx tsx scripts/validate-indicator-golden.ts <golden.json> [more.json]
// Indicators that start from a seed (EMA, RSI, ATR, MACD, ADX, SAR) are compared only after a warm-up, because a different seed converges away
// (error shrinks geometrically); windowed ones (SMA, Bollinger, CCI, Williams %R, AO, Ichimoku, Stochastic) are compared from their first value.
import { readFileSync } from "node:fs";
import { adxSeries, atrMt5, macdMt5, atrSeries, atrSmaSeries, macdSeriesMt5, awesomeOscillatorSeries, bollingerSeries, cciSeries, emaSeries, ichimokuSeries, macdSeries, parabolicSarSeries, rsiSeries, smaSeries, stochasticSeries, williamsPercentRSeries } from "../lib/market-data/indicators";

type Golden = { symbol: string; candles: { time: number; open: number; high: number; low: number; close: number }[]; ref: Record<string, (number | null)[]> };

const WARM = 300;
let fails = 0;
const rows: string[] = [];

function compare(label: string, ours: (number | undefined)[], ref: (number | null)[], from: number, tolRel: number, scale: number, maxMissing = 0) {
  let maxAbs = 0, n = 0, missing = 0;
  for (let i = from; i < ref.length; i++) {
    const r = ref[i], o = ours[i];
    if (r === null || r === undefined) continue;
    if (o === undefined) { missing++; continue; }
    maxAbs = Math.max(maxAbs, Math.abs(o - r));
    n++;
  }
  const rel = maxAbs / scale;
  const ok = n > 0 && missing <= maxMissing && rel <= tolRel;
  if (!ok) fails++;
  rows.push(`${ok ? "ok  " : "FAIL"} ${label.padEnd(14)} n=${String(n).padEnd(5)} max|diff|=${maxAbs.toExponential(2).padEnd(10)} rel=${rel.toExponential(2)} (tol ${tolRel.toExponential(0)})${missing ? `  missing=${missing}` : ""}`);
}

for (const file of process.argv.slice(2)) {
  const g = JSON.parse(readFileSync(file, "utf8")) as Golden;
  const cs = g.candles;
  const closes = cs.map((c) => c.close);
  const scale = Math.max(...closes) - Math.min(...closes); // errors are judged against the price range of the sample
  rows.push(`\n== ${g.symbol} H1, ${cs.length} candles`);
  const R = g.ref;
  const first = (a: (number | null)[]) => a.findIndex((v) => v !== null);

  compare("SMA 20", smaSeries(closes, 20), R.sma20, 0, 1e-9, scale);
  compare("EMA 20", emaSeries(closes, 20) ? padTail(emaSeries(closes, 20)!, cs.length) : [], R.ema20, WARM, 1e-6, scale);
  compare("EMA 50", emaSeries(closes, 50) ? padTail(emaSeries(closes, 50)!, cs.length) : [], R.ema50, WARM, 1e-6, scale);
  compare("RSI 14", rsiSeries(closes, 14), R.rsi14, WARM, 1e-6, 100);
  compare("ATR 14 (Wilder)", atrSeries(cs, 14), R.atr14, WARM, 1e-6, scale);
  const m = macdSeries(closes, 12, 26, 9);
  compare("MACD line", m.map((x) => x?.macd), R.macd, WARM, 1e-6, scale);
  compare("MACD sig (EMA)", m.map((x) => x?.signal), R.macd_signal, WARM, 1e-6, scale);
  compare("MACD hist (EMA)", m.map((x) => x?.histogram), R.macd_hist, WARM, 1e-6, scale);
  // MT5 conventions (what the chart panels show): ATR = SMA of the true range, MACD signal = SMA of the MACD line
  compare("ATR 14 (MT5)", atrSmaSeries(cs, 14), R.atr14_mt5, 0, 1e-9, scale);
  const mm = macdSeriesMt5(closes, 12, 26, 9);
  compare("MACD sig (MT5)", mm.map((x) => x?.signal), R.macd_signal_mt5, WARM, 1e-6, scale);
  compare("MACD hist (MT5)", mm.map((x) => x?.histogram), R.macd_hist_mt5, WARM, 1e-6, scale);
  // the scalar values the AI layer reads are the chart's last values (one convention everywhere)
  const lastAtr = atrSmaSeries(cs, 14).at(-1), lastMacd = macdSeriesMt5(closes, 12, 26, 9).at(-1);
  rows.push(`${atrMt5(cs, 14) === lastAtr && macdMt5(closes)?.signal === lastMacd?.signal && macdMt5(closes)?.macd === lastMacd?.macd ? "ok  " : "FAIL"} AI-layer scalars equal the chart's last ATR / MACD (MT5)`);
  if (atrMt5(cs, 14) !== lastAtr || macdMt5(closes)?.signal !== lastMacd?.signal) fails++;
  const b = bollingerSeries(closes, 20, 2);
  compare("BB upper", b.map((x) => x?.upper), R.bb_upper, 0, 1e-9, scale);
  compare("BB middle", b.map((x) => x?.middle), R.bb_mid, 0, 1e-9, scale);
  compare("BB lower", b.map((x) => x?.lower), R.bb_lower, 0, 1e-9, scale);
  compare("CCI 14", cciSeries(cs, 14), R.cci14, 0, 1e-9, 100);
  compare("Williams %R 14", williamsPercentRSeries(cs, 14), R.willr14, 0, 1e-9, 100);
  compare("Awesome Osc.", awesomeOscillatorSeries(cs), R.ao, 0, 1e-9, scale);
  const st = stochasticSeries(cs, 5, 3, 3);
  // our %K is shown only once %D exists too (2 leading values later than MT5 draws them); every value shown must still match
  compare("Stoch %K 5-3-3", st.map((x) => x?.k), R.stoch_k, 0, 1e-9, 100, 2);
  compare("Stoch %D 5-3-3", st.map((x) => x?.d), R.stoch_d, 0, 1e-9, 100);
  const ad = adxSeries(cs, 14);
  compare("ADX 14", ad.map((x) => x?.adx), R.adx14, WARM, 1e-6, 100);
  compare("+DI 14", ad.map((x) => x?.plusDI), R.plus_di14, WARM, 1e-6, 100);
  compare("-DI 14", ad.map((x) => x?.minusDI), R.minus_di14, WARM, 1e-6, 100);
  const ich = ichimokuSeries(cs.map((c) => ({ ...c })), 9, 26, 52);
  compare("Ichimoku Tenkan", ich.tenkan.map((p) => p.value), R.ichi_tenkan, 0, 1e-9, scale);
  compare("Ichimoku Kijun", ich.kijun.map((p) => p.value), R.ichi_kijun, 0, 1e-9, scale);
  const sar = parabolicSarSeries(cs, 0.02, 0.2);
  // the last bar is left out: MT5's indicator does not test the newest bar for a reversal, ours does (the forming candle may already have crossed it)
  compare("Parabolic SAR", sar.slice(0, -1).map((x) => x?.value), R.psar.slice(0, -1), WARM, 1e-6, scale);
}

function padTail(tail: number[], total: number): (number | undefined)[] {
  return [...new Array(total - tail.length).fill(undefined), ...tail];
}

console.log(rows.join("\n"));
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} comparison(s) outside tolerance`);
process.exit(fails === 0 ? 0 : 1);
