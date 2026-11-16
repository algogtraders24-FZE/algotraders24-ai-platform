// scripts/validate-swing-lab.ts
// Validation for the Swing Lab maths (no network, no database):
//  1) hand-worked cases: trend states, weekly bars, ATR(14), swing-level detection and nearest levels, the position planner;
//  2) an independent Python implementation (scripts/fixtures/make_swing_fixture.py) run on real BTCUSDT and ETHUSDT daily and
//     4-hour klines: trends, alignment, ATR, nearest support and resistance and the range position must match.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAY_MS, alignmentOf, atr14, computeSwingMap, computeSwingMapFromBars, levelCandidates, nearestLevels, parseBars, parseBridgeCandles, trendOf, weeklyBars, type Bar, type RawKline } from "../services/swing-lab/compute";
import { planSwing } from "../services/swing-lab/planner";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, open: o, high: h, low: l, close: c });

// ---- trend -------------------------------------------------------------------------------------------------------------
const ramp = (from: number, step: number, n: number): Bar[] => Array.from({ length: n }, (_, i) => bar(i * DAY_MS, 0, from + step * i + 1, from + step * i - 1, from + step * i));
check("trend: a steady rise is up", trendOf(ramp(100, 1, 60)) === "up");
check("trend: a steady fall is down", trendOf(ramp(200, -1, 60)) === "down");
const dip = ramp(100, 1, 60);
dip[59] = bar(59 * DAY_MS, 0, 160, 100, 120); // close back below the 20-bar average but the 20 is still above the 50
check("trend: a sharp last-bar drop is mixed", trendOf(dip) === "mixed");
check("trend: fewer than 50 bars is unknown", trendOf(ramp(100, 1, 49)) === null);
check("alignment", alignmentOf("up", "up", "up") === "aligned up" && alignmentOf("down", "down", "down") === "aligned down" && alignmentOf("up", "up", "mixed") === "mixed" && alignmentOf(null, "up", "up") === "mixed");

// ---- weekly bars: epoch day 0 is a Thursday, so Monday 1970-01-05 is day 4 ---------------------------------------------
const days: Bar[] = [];
for (let d = 4; d < 4 + 14 + 3; d++) days.push(bar(d * DAY_MS, 10 + d, 20 + d, 5 + d, 11 + d)); // two full weeks from the first Monday, then 3 days of a third
const wk = weeklyBars(days);
check("weekly bars: two complete weeks, the partial third is dropped", wk.length === 2);
check("weekly bar aggregates (open of Monday, max high, min low, close of Sunday)", wk[0].t === 4 * DAY_MS && wk[0].open === 14 && wk[0].high === 20 + 10 && wk[0].low === 5 + 4 && wk[0].close === 11 + 10);
const partialStart = days.slice(1); // starts Tuesday: the first week has 6 bars and is dropped
check("a week that starts mid-week is dropped", weeklyBars(partialStart).length === 1);

// ---- ATR(14) by hand ---------------------------------------------------------------------------------------------------
const atrBars: Bar[] = Array.from({ length: 16 }, (_, i) => bar(i * DAY_MS, 0, 101, 99, 100)); // range 2 every day, no gaps
atrBars[15] = bar(15 * DAY_MS, 0, 110, 100, 105); // true range = max(10, |110-100|, |100-100|) = 10
// last 14 true ranges: 13 of them 2 and one 10 => (13 * 2 + 10) / 14
check("ATR(14) with one wide day", near(atr14(atrBars) ?? NaN, (13 * 2 + 10) / 14, 1e-12));
check("ATR needs 15 bars", atr14(atrBars.slice(0, 14)) === null);

// ---- levels ------------------------------------------------------------------------------------------------------------
// flat 100 with one clear swing high 120 at index 20 and one clear swing low 80 at index 30
const lv: Bar[] = Array.from({ length: 60 }, (_, i) => bar(i * DAY_MS, 0, 101, 99, 100));
lv[20] = bar(20 * DAY_MS, 0, 120, 99, 100);
lv[30] = bar(30 * DAY_MS, 0, 101, 80, 100);
const cands = levelCandidates(lv, []);
check("swing high and swing low are found", cands.some((c) => c.price === 120 && c.source === "daily swing high") && cands.some((c) => c.price === 80 && c.source === "daily swing low"));
check("a bar equal to its neighbours is not a swing", !cands.some((c) => c.price === 101 && c.source === "daily swing high"));
const nl = nearestLevels(cands, 100, 2);
check("nearest levels: resistance is the 20-day high or swing above, support the nearest below, with distances", nl.resistance !== null && nl.support !== null && nl.resistance.price > 100 && nl.support.price < 100 && near(nl.resistance.distanceAtr, (nl.resistance.price - 100) / 2));
const nl2 = nearestLevels([{ price: 150, source: "20-day high" }, { price: 130, source: "daily swing high" }, { price: 70, source: "daily swing low" }, { price: 90, source: "20-day low" }], 100, 5);
check("nearest picks the closest above and below", nl2.resistance?.price === 130 && nl2.support?.price === 90 && near(nl2.resistance.distancePct, 30) && near(nl2.support.distanceAtr, -2));

// ---- planner by hand ---------------------------------------------------------------------------------------------------
const p = planSwing({ account: 10000, riskPct: 1, entry: 100, stop: 95, target: 115, side: "long", atrPct: 4 });
// risk 100; stop distance 5 -> 20 units, notional 2000, leverage 0.2; R = 15 / 5 = 3; reward 300; break-even win rate 25 %; ATR = 4 -> 1.25 ATR stop => ok
check("planner: long trade", p.ok && near(p.riskAmount, 100) && near(p.units, 20) && near(p.notional, 2000) && near(p.leverage, 0.2) && near(p.rMultiple ?? NaN, 3) && near(p.rewardAmount ?? NaN, 300) && near(p.breakEvenWinPct ?? NaN, 25) && near(p.stopAtr ?? NaN, 1.25) && p.stopNote === "ok");
const s = planSwing({ account: 5000, riskPct: 0.5, entry: 50, stop: 52, target: 44, side: "short", atrPct: 20 });
// risk 25; distance 2 -> 12.5 units; R = 6 / 2 = 3; stop = 2 / (0.2 * 50) = 0.2 ATR => tight
check("planner: short trade and a tight stop", s.ok && near(s.units, 12.5) && near(s.rMultiple ?? NaN, 3) && s.stopNote === "tight");
check("planner: wide stop flag", planSwing({ account: 1000, riskPct: 1, entry: 100, stop: 70, side: "long", atrPct: 5 }).stopNote === "wide");
check("planner: a stop on the wrong side is an error", !planSwing({ account: 1000, riskPct: 1, entry: 100, stop: 105, side: "long" }).ok && !planSwing({ account: 1000, riskPct: 1, entry: 100, stop: 95, side: "short" }).ok);
check("planner: a target on the wrong side is an error", !planSwing({ account: 1000, riskPct: 1, entry: 100, stop: 95, target: 90, side: "long" }).ok);
check("planner: risk above 5 % or zero account is rejected", !planSwing({ account: 1000, riskPct: 6, entry: 100, stop: 95, side: "long" }).ok && !planSwing({ account: 0, riskPct: 1, entry: 100, stop: 95, side: "long" }).ok);

// planner with a quote currency: USDJPY, entry 150, stop 149, risk 1 % of 10,000 = 100 USD. One yen of stop = 1/150 USD per unit,
// so units = 100 / (1 * (1/150)) = 15,000 and notional = 15,000 * 150 * (1/150) = 15,000 USD (leverage 1.5).
const jpy = planSwing({ account: 10000, riskPct: 1, entry: 150, stop: 149, side: "long", quoteToUsd: 1 / 150 });
check("planner: yen-quoted pair converts the risk through the quote rate", jpy.ok && near(jpy.units, 15000, 1e-9) && near(jpy.notional, 15000, 1e-9) && near(jpy.leverage, 1.5, 1e-9));
check("planner: a missing quote rate defaults to 1 and a bad one is rejected", near(planSwing({ account: 10000, riskPct: 1, entry: 100, stop: 95, side: "long" }).units, 20) && !planSwing({ account: 10000, riskPct: 1, entry: 100, stop: 95, side: "long", quoteToUsd: 0 }).ok);

// ---- bridge candles: the forming (last) candle is dropped, bad rows are skipped, order is oldest first ------------------------
const cand = parseBridgeCandles([
  { datetime: "2026-11-03T00:00:00+00:00", open: 1, high: 3, low: 0.5, close: 2 },
  { datetime: "2026-11-02T00:00:00+00:00", open: 1, high: 2, low: 0.5, close: 1.5 },
  { datetime: "bad", open: 1, high: 2, low: 0.5, close: 1.5 },
  { datetime: "2026-11-04T00:00:00+00:00", open: 1, high: 0.4, low: 0.5, close: 1 }, // high below low
  { datetime: "2026-11-05T00:00:00+00:00", open: 2, high: 4, low: 1, close: 3 }, // newest = still forming
]);
check("bridge candles: sorted, bad rows skipped, forming candle dropped", cand.length === 2 && cand[0].t < cand[1].t && cand[1].close === 2);
// a forex-like series (5 trading days a week): weekly trend comes from the supplied weekly bars, the map is built from bars directly
const fxDaily: Bar[] = Array.from({ length: 120 }, (_, i) => bar(i * DAY_MS, 0, 101 + i * 0.1, 99 + i * 0.1, 100 + i * 0.1));
const fxH4: Bar[] = Array.from({ length: 80 }, (_, i) => bar(i * 4 * 3_600_000, 0, 112, 111, 111.5 + i * 0.01));
const fxWeekly: Bar[] = Array.from({ length: 60 }, (_, i) => bar(i * 7 * DAY_MS, 0, 110, 90, 90 + i * 0.5));
const fxRow = computeSwingMapFromBars("EURUSD", fxDaily, fxH4, fxWeekly);
check("map from bars: trends, as-of bar time and price", fxRow !== null && fxRow.w1 === "up" && fxRow.d1 === "up" && fxRow.h4 === "up" && fxRow.alignment === "aligned up" && fxRow.asOfBar === 79 * 4 * 3_600_000 && near(fxRow.price, 111.5 + 79 * 0.01));
check("map from bars: too little daily history gives no row", computeSwingMapFromBars("X", fxDaily.slice(0, 59), fxH4, fxWeekly) === null);

// ---- real data against the independent Python numbers --------------------------------------------------------------------
interface ExpLevel { price: number; pct: number; atr: number; source: string }
interface Exp { price: number; atrPct: number; w1: string | null; d1: string | null; h4: string | null; alignment: string; resistance: ExpLevel | null; support: ExpLevel | null; rangePos: number; weeks: number }
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "swing-lab-fixture.json"), "utf8")) as { nowMs: number; symbols: Record<string, { daily: RawKline[]; h4: RawKline[] }>; expected: Record<string, Exp> };
for (const symbol of Object.keys(fx.symbols)) {
  const e = fx.expected[symbol];
  const d = fx.symbols[symbol];
  const r = computeSwingMap(symbol, d.daily, d.h4, fx.nowMs);
  const tag = `[${symbol}]`;
  check(`${tag} map produced`, r !== null);
  if (!r) continue;
  check(`${tag} weekly bar count`, weeklyBars(parseBars(d.daily, fx.nowMs)).length === e.weeks, `(${e.weeks})`);
  check(`${tag} price and ATR percent`, near(r.price, e.price) && near(r.atrPct, e.atrPct, 1e-9), `(${r.atrPct.toFixed(2)} %)`);
  check(`${tag} trends and alignment`, r.w1 === e.w1 && r.d1 === e.d1 && r.h4 === e.h4 && r.alignment === e.alignment, `(${r.w1}/${r.d1}/${r.h4})`);
  const same = (a: { price: number; distancePct: number; distanceAtr: number; source: string } | null, b: ExpLevel | null) => (a === null && b === null) || (a !== null && b !== null && near(a.price, b.price) && near(a.distancePct, b.pct, 1e-9) && near(a.distanceAtr, b.atr, 1e-9) && a.source === b.source);
  check(`${tag} nearest resistance`, same(r.resistance, e.resistance), `(${r.resistance?.price} ${r.resistance?.source})`);
  check(`${tag} nearest support`, same(r.support, e.support), `(${r.support?.price} ${r.support?.source})`);
  check(`${tag} range position`, near(r.rangePosPct, e.rangePos, 1e-9));
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
