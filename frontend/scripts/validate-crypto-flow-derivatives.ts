// scripts/validate-crypto-flow-derivatives.ts
// Validation for the derivatives positioning maths (no network, no database):
//  1) hand-worked cases for funding labels, the open-interest regime table, the crowd labels and malformed rows;
//  2) an independent Python implementation (scripts/fixtures/make_derivatives_fixture.py) run on real BTCUSDT and ETHUSDT
//     USDS-M futures responses: funding, annualised funding, open-interest change and price at the snapshots, regime,
//     long/short shares and the taker ratio must match.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  crowdOf,
  fundingLabel,
  fundingRows,
  latestRatio,
  latestTakerRatio,
  oiRegime,
  oiWindow,
  parseOiHistory,
  type RawOiPoint,
  type RawPremium,
  type RawRatioPoint,
} from "../services/crypto-flow/derivatives";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- 1) hand-worked cases --------------------------------------------------------------------------------------------
check("funding labels", fundingLabel(4.99) === "neutral" && fundingLabel(-4.99) === "neutral" && fundingLabel(5) === "longs paying" && fundingLabel(19.9) === "longs paying" && fundingLabel(20) === "longs paying a lot" && fundingLabel(-5) === "shorts paying" && fundingLabel(-20) === "shorts paying a lot");
check("regime: the four quadrants", oiRegime(3, 1) === "new longs" && oiRegime(3, -1) === "new shorts" && oiRegime(-3, 1) === "short covering" && oiRegime(-3, -1) === "long unwinding");
check("regime: small moves are flat", oiRegime(0.99, 5) === "flat" && oiRegime(-0.99, -5) === "flat" && oiRegime(5, 0.19) === "flat" && oiRegime(1, 0.2) === "new longs");
check("crowd labels", crowdOf(0.6) === "long-heavy" && crowdOf(0.59) === "balanced" && crowdOf(0.4) === "short-heavy" && crowdOf(0.41) === "balanced");

// funding: rate 0.0001 per 8 h = 0.0001 * 3 * 365 * 100 = 10.95 % a year; per 4 h = 21.9 %; negative rate keeps its sign
const rows = fundingRows(
  [
    { symbol: "AAAUSDT", markPrice: "100", lastFundingRate: "0.0001", nextFundingTime: 5 },
    { symbol: "BBBUSDT", markPrice: "2", lastFundingRate: "0.0001", nextFundingTime: 6 },
    { symbol: "CCCUSDT", markPrice: "3", lastFundingRate: "-0.0003", nextFundingTime: 7 },
    { symbol: "BADUSDT", markPrice: "x", lastFundingRate: "0.0001", nextFundingTime: 8 },
  ],
  new Map([["BBBUSDT", 4]]),
  ["AAAUSDT", "BBBUSDT", "CCCUSDT", "BADUSDT", "MISSINGUSDT"],
);
check("funding rows: missing and malformed symbols are skipped", rows.length === 3);
check("funding annualised (8 h and 4 h intervals, negative sign)", near(rows[0].annualPct, 10.95) && near(rows[1].annualPct, 21.9) && near(rows[2].annualPct, -32.85) && rows[1].label === "longs paying a lot" && rows[2].label === "shorts paying a lot" && near(rows[0].fundingPct, 0.01));

// open-interest window by hand: 3 points, price = value / contracts
const pts: RawOiPoint[] = [
  { timestamp: 3, sumOpenInterest: "110", sumOpenInterestValue: "11550" }, // price 105
  { timestamp: 1, sumOpenInterest: "100", sumOpenInterestValue: "10000" }, // price 100
  { timestamp: 2, sumOpenInterest: "bad", sumOpenInterestValue: "1" },
  { timestamp: 4, sumOpenInterest: "121", sumOpenInterestValue: "13310" }, // price 110
];
const series = parseOiHistory(pts);
check("history is sorted and malformed points are dropped", series.length === 3 && series[0].t === 1 && series[2].t === 4 && near(series[1].price, 105));
const w = oiWindow(series, 2);
check("window: OI +21 %, price +10 % over 2 steps => new longs", w !== null && near(w.oiChangePct, 21) && near(w.priceChangePct, 10) && w.regime === "new longs");
check("window needs hours + 1 points", oiWindow(series, 3) === null);
check("latestRatio reads the newest valid point", latestRatio([{ longAccount: "0.5" }, { longAccount: "0.7" }, { longAccount: "x" }])?.longPct === 70 && latestRatio([]) === null && latestRatio([{ longAccount: "1.4" }]) === null);
check("latestTakerRatio", latestTakerRatio([{ buySellRatio: "0.9" }, { buySellRatio: "1.25" }]) === 1.25 && latestTakerRatio([]) === null);

// ---- 2) independent Python numbers on real data --------------------------------------------------------------------
interface Exp {
  n: number;
  oiNow: number;
  usd: number;
  h4: { oi: number; px: number; regime: string };
  h24: { oi: number; px: number; regime: string };
  funding: { pct: number; interval: number; annual: number; label: string; mark: number };
  acc: { long: number; crowd: string };
  top: { long: number; crowd: string };
  taker: number;
}
interface Fx {
  premium: RawPremium[];
  fundingInfo: Array<{ symbol: string; fundingIntervalHours: number }>;
  symbols: Record<string, { oi: RawOiPoint[]; acc: RawRatioPoint[]; top: RawRatioPoint[]; taker: Array<{ buySellRatio: string }> }>;
  expected: Record<string, Exp>;
}
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "crypto-flow-derivatives-fixture.json"), "utf8")) as Fx;
const intervals = new Map(fx.fundingInfo.map((i) => [i.symbol, Number(i.fundingIntervalHours)]));
for (const symbol of Object.keys(fx.symbols)) {
  const e = fx.expected[symbol];
  const d = fx.symbols[symbol];
  const tag = `[${symbol}]`;
  const f = fundingRows(fx.premium, intervals, [symbol])[0];
  check(`${tag} funding rate, interval, annualised, label, mark`, !!f && near(f.fundingPct, e.funding.pct, 1e-9) && f.intervalHours === e.funding.interval && near(f.annualPct, e.funding.annual, 1e-9) && f.label === e.funding.label && near(f.markPrice, e.funding.mark), `(${f?.annualPct.toFixed(2)} %/yr)`);
  const s = parseOiHistory(d.oi);
  check(`${tag} history length and latest open interest`, s.length === e.n && near(s[s.length - 1].oi, e.oiNow) && near(s[s.length - 1].value, e.usd), `(${s.length} points)`);
  const w4 = oiWindow(s, 4);
  const w24 = oiWindow(s, 24);
  check(`${tag} 4 h open interest and price change, regime`, !!w4 && near(w4.oiChangePct, e.h4.oi, 1e-9) && near(w4.priceChangePct, e.h4.px, 1e-9) && w4.regime === e.h4.regime, `(${w4?.regime})`);
  check(`${tag} 24 h open interest and price change, regime`, !!w24 && near(w24.oiChangePct, e.h24.oi, 1e-9) && near(w24.priceChangePct, e.h24.px, 1e-9) && w24.regime === e.h24.regime, `(${w24?.regime})`);
  const a = latestRatio(d.acc);
  const t = latestRatio(d.top);
  check(`${tag} account and top-trader long share and crowd`, !!a && !!t && near(a.longPct, e.acc.long, 1e-9) && a.crowd === e.acc.crowd && near(t.longPct, e.top.long, 1e-9) && t.crowd === e.top.crowd, `(${a?.longPct.toFixed(1)} % / ${t?.longPct.toFixed(1)} %)`);
  check(`${tag} taker ratio`, near(latestTakerRatio(d.taker) ?? NaN, e.taker, 1e-9));
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
