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
import { computeCryptoFlow, parseClosedKlines, type RawKline } from "../services/crypto-flow/compute";

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
