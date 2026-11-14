// scripts/validate-crypto-flow.ts
// Validation for Crypto Flow (no network): checks the pure maths in services/crypto-flow/compute.ts against
//  1) TRUE per-minute delta computed from Binance aggregate trades with the aggressor side (buyer-aggressor volume
//     minus seller-aggressor volume): on every minute where the downloaded trade list is complete (its volume equals the
//     kline volume) the delta derived from the klines' taker-buy volume must be identical;
//  2) independent window aggregates (15 min, 1 h, 4 h) computed in Python from the same klines;
//  3) the closed-bar rule (the bar that is still open at "now" is dropped) and rejection of malformed rows.
// Fixture: scripts/fixtures/crypto-flow-fixture.json (300 real BTCUSDT 1-minute klines).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeCryptoFlow, flowBias, parseClosedKlines, type RawKline } from "../services/crypto-flow/compute";
import type { CryptoFlowWindow } from "../types/crypto-flow";

interface Fixture {
  symbol: "BTCUSDT";
  nowMs: number;
  klines: RawKline[];
  trueDeltaFrom: number;
  trueDelta: number[];
  trueVolume: number[];
  expected: {
    m15: Record<string, number>;
    h1: Record<string, number>;
    h4: Record<string, number>;
    lastPrice: number;
    asOf: number;
    points: number;
    cumLast: number;
  };
}

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "crypto-flow-fixture.json"), "utf8")) as Fixture;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const close = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// 1) delta from the klines equals the true aggregate-trade delta on complete minutes
const pts = parseClosedKlines(fx.klines, fx.nowMs);
check("all 300 bars are closed at the fixture time", pts.length === fx.expected.points, `(${pts.length})`);
let complete = 0;
let maxErr = 0;
for (let b = 0; b < fx.trueDelta.length; b++) {
  const p = pts[fx.trueDeltaFrom + b];
  if (!p || Math.abs(p.volume - fx.trueVolume[b]) > 1e-6) continue; // trade list incomplete for this minute (download paging), not comparable
  complete += 1;
  maxErr = Math.max(maxErr, Math.abs(p.delta - fx.trueDelta[b]));
}
check("kline delta equals the true aggressor delta on complete minutes", complete >= 10 && maxErr < 1e-6, `(${complete} minutes compared, max error ${maxErr.toExponential(2)})`);

// 2) windows against the independent Python numbers
const res = computeCryptoFlow(fx.symbol, fx.klines, fx.nowMs);
check("computeCryptoFlow returns a result", res !== null);
if (res) {
  const wins: Array<["m15" | "h1" | "h4", Record<string, number>]> = [
    ["m15", fx.expected.m15],
    ["h1", fx.expected.h1],
    ["h4", fx.expected.h4],
  ];
  for (const [key, exp] of wins) {
    const w = res.windows[key];
    const ok = w.minutes === exp.minutes && close(w.delta, exp.delta) && close(w.volume, exp.volume) && close(w.deltaPct, exp.deltaPct) && close(w.buyPct, exp.buyPct) && close(w.priceChangePct, exp.priceChangePct);
    check(`window ${key} identical to Python`, ok, `(delta ${w.delta.toFixed(3)}, ${w.deltaPct.toFixed(2)}% of volume)`);
  }
  check("last price, as-of bar and cumulative delta", close(res.lastPrice, fx.expected.lastPrice) && res.asOf === fx.expected.asOf && close(res.series[res.series.length - 1].cum, fx.expected.cumLast));
}

// 2b) bias summary: thresholds and the weighted score (cases worked out by hand)
const w = (buyPct: number): CryptoFlowWindow => ({ minutes: 1, delta: 0, volume: 1, deltaPct: 2 * (buyPct - 50), buyPct, priceChangePct: 0 });
const b1 = flowBias({ m15: w(50), h1: w(51), h4: w(50) }); // score 0.5 -> balanced
check("bias: near 50% is balanced", b1.side === "balanced" && b1.strength === null && !b1.consistent);
const b2 = flowBias({ m15: w(46), h1: w(46), h4: w(46) }); // score -4 -> sellers, mild, consistent
check("bias: 46% everywhere = sellers, mild, consistent", b2.side === "sellers" && b2.strength === "mild" && b2.consistent && Math.abs(b2.score + 4) < 1e-9);
const b3 = flowBias({ m15: w(60), h1: w(56), h4: w(52) }); // score (10 + 12 + 2) / 4 = 6 -> buyers, moderate, consistent
check("bias: weighted score 6 = buyers, moderate", b3.side === "buyers" && b3.strength === "moderate" && b3.consistent && Math.abs(b3.score - 6) < 1e-9);
const b4 = flowBias({ m15: w(70), h1: w(65), h4: w(60) }); // score (20 + 30 + 10) / 4 = 15 -> buyers, strong
check("bias: weighted score 15 = buyers, strong", b4.side === "buyers" && b4.strength === "strong");
const b5 = flowBias({ m15: w(40), h1: w(56), h4: w(54) }); // score (-10 + 12 + 4) / 4 = 1.5 -> balanced, not consistent
check("bias: mixed windows are not consistent", b5.side === "balanced" && !b5.consistent);
if (res) check("response carries the bias", res.bias.side === flowBias(res.windows).side && Math.abs(res.bias.score - flowBias(res.windows).score) < 1e-12);

// 3) closed-bar rule and malformed rows
const lastOpen = fx.klines[fx.klines.length - 1];
const duringLast = Number(lastOpen[0]) + 30_000; // 30 s into the last minute: that bar is still open
check("the bar still open at 'now' is dropped", parseClosedKlines(fx.klines, duringLast).length === fx.klines.length - 1);
check("malformed rows are skipped", parseClosedKlines([[1, 2, 3], ["x", "y", "z", "a", "b", "c", "d", "e", "f", "g", "h"], ...fx.klines], fx.nowMs).length === fx.klines.length);
check("too few bars returns null", computeCryptoFlow(fx.symbol, fx.klines.slice(0, 30), fx.nowMs) === null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Crypto Flow checks passed");
