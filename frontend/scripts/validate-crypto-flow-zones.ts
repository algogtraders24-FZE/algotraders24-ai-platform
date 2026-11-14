// scripts/validate-crypto-flow-zones.ts
// Validation for Flow Zones (no network): the pure maths in services/crypto-flow/zones.ts is checked against
//  1) hand-worked profile cases (bucket rounding, point of control, 70 % value area, buyer / seller zone choice, wall bands);
//  2) an independent Python implementation (scripts/fixtures/make_zones_fixture.py) run on real BTCUSDT 1m / 5m / 15m
//     klines and one real order-book snapshot: POC, value area, state, zones and walls must match for all three lookbacks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawKline } from "../services/crypto-flow/compute";
import {
  bookWalls,
  bucketIndex,
  buildProfile,
  computeFlowZones,
  parseZoneBars,
  pickZones,
  pointOfControl,
  valueArea,
  type ZoneBar,
} from "../services/crypto-flow/zones";
import { CRYPTO_FLOW_LOOKBACKS, type CryptoFlowLookback } from "../types/crypto-flow";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- 1) hand-worked cases -------------------------------------------------------------------------------------
check("bucket index rounds half up", bucketIndex(100.5, 1) === 101 && bucketIndex(99.5, 1) === 100 && bucketIndex(0.5, 1) === 1 && bucketIndex(100.49, 1) === 100);

// one bar per price (high = low = close = price), step = 100 * 1 % = 1. Order: 98, 99, 101, 102, 100 (the last close is 100).
const mk = (price: number, buy: number, sell: number): ZoneBar => ({ t: 0, high: price, low: price, close: price, volume: buy + sell, trades: 100, takerBuy: buy });
const bars = [mk(98, 5, 1), mk(99, 2, 2), mk(101, 3, 3), mk(102, 1, 5), mk(100, 1, 9)];
const prof = buildProfile(bars, 1);
check("profile covers 98..102 with total 32", prof !== null && prof.minIdx === 98 && prof.maxIdx === 102 && prof.buckets.length === 5 && prof.total === 32);
if (prof) {
  const poc = pointOfControl(prof);
  check("POC = the 100 bucket (volume 10)", prof.minIdx + poc === 100);
  const [lo, hi] = valueArea(prof, poc);
  // 10 -> +6 (101) = 16 -> +6 (102) = 22 (< 22.4) -> nothing above, so +4 (99) = 26
  check("70 % value area grows 101, 102, then 99 => 99..102", prof.minIdx + lo === 99 && prof.minIdx + hi === 102);
  const z = pickZones(prof, 100);
  check("buyer zone = 98 with net 4 (12.5 % of volume)", z.buyer !== null && z.buyer.price === 98 && near(z.buyer.netSharePct, 12.5) && near(z.buyer.distancePct, -2));
  check("seller zone = 102 with net 4 (12.5 % of volume)", z.seller !== null && z.seller.price === 102 && near(z.seller.netSharePct, 12.5) && near(z.seller.distancePct, 2));
  const none = pickZones(prof, 98.2);
  check("no buyer zone when every bucket below the price is not net-buy", none.buyer === null);
}
// tie: two equal buyer buckets, the one nearer to the price wins; two equal seller buckets, the nearer wins
const tie = buildProfile([mk(96, 4, 0), mk(97, 4, 0), mk(103, 0, 4), mk(104, 0, 4), mk(100, 1, 1)], 1);
if (tie) {
  const z = pickZones(tie, 100);
  check("tie goes to the bucket nearer the price", z.buyer?.price === 97 && z.seller?.price === 103);
}

// walls: bands of 0.2 % of the price (0.2 at a price of 100)
const book = bookWalls(
  { bids: [["99.9", "10"], ["99.85", "10"], ["99.5", "1"]], asks: [["100.1", "5"], ["100.3", "20"], ["100.45", "1"]] },
  100,
);
check("book produced", book !== null);
if (book) {
  check("bid wall: 99.9 and 99.85 share one band worth 1997.5", book.bids.length === 2 && near(book.bids[0].notional, 99.9 * 10 + 99.85 * 10) && near(book.bids[0].price, 99.9, 1e-6));
  check("ask wall: the 100.3 band (2006) is bigger than the 100.1 band (500.5)", near(book.asks[0].notional, 100.3 * 20) && near(book.asks[1].notional, 100.1 * 5));
  check("coverage = the smaller reach (0.45 % on the ask side is bigger than 0.5 % on the bid side?)", near(book.coveragePct, 0.45, 1e-6));
}
check("empty book gives null", bookWalls({ bids: [], asks: [] }, 100) === null);

// closed-bar rule and malformed rows
const rows: RawKline[] = [
  [0, "1", "2", "1", "1.5", "10", 59999, "0", 5, "6", "0", "0"],
  [60000, "1", "2", "1", "1.5", "10", 119999, "0", 5, "6", "0", "0"],
  ["x", "1", "2", "1", "1.5", "10", 179999, "0", 5, "6", "0", "0"],
  [120000, "1", "2", "1", "1.5", "10", 179999, "0", 5],
];
check("parseZoneBars drops the open bar and malformed rows", parseZoneBars(rows, 100000).length === 1);

// ---- 2) independent Python numbers on real data --------------------------------------------------------------------
interface ExpectedBook {
  bids: Array<{ price: number; notional: number }>;
  asks: Array<{ price: number; notional: number }>;
  coveragePct: number;
  imbalancePct: number;
}
interface Expected {
  lastPrice: number;
  asOf: number;
  bars: number;
  step: number;
  tradesPerMinute: number;
  thin: boolean;
  buckets: number;
  poc: number;
  pocShare: number;
  vaLow: number;
  vaHigh: number;
  state: string;
  buyer: { price: number; share: number } | null;
  seller: { price: number; share: number } | null;
  profileFirst: number[];
  profileLast: number[];
  book: ExpectedBook;
}
interface Fixture {
  symbol: string;
  nowMs: number;
  book: { bids: string[][]; asks: string[][] };
  klines: Record<CryptoFlowLookback, RawKline[]>;
  expected: Record<CryptoFlowLookback, Expected>;
}
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "crypto-flow-zones-fixture.json"), "utf8")) as Fixture;

for (const cfg of CRYPTO_FLOW_LOOKBACKS) {
  const e = fx.expected[cfg.id];
  const r = computeFlowZones(fx.symbol, fx.klines[cfg.id], fx.book, fx.nowMs, "Binance spot", cfg);
  const tag = `[${cfg.id}]`;
  check(`${tag} result produced`, r !== null);
  if (!r) continue;
  check(`${tag} last price and asOf`, near(r.lastPrice, e.lastPrice) && r.asOf === e.asOf);
  check(`${tag} trades per minute and thin flag`, r.tradesPerMinute === e.tradesPerMinute && r.thin === e.thin, `(${r.tradesPerMinute}/min)`);
  check(`${tag} bucket count`, r.profile.length === e.buckets, `(${r.profile.length})`);
  check(`${tag} profile first / last bucket`, near(r.profile[0].price, e.profileFirst[0]) && near(r.profile[0].buy, e.profileFirst[1]) && near(r.profile[0].sell, e.profileFirst[2]) &&
    near(r.profile[r.profile.length - 1].price, e.profileLast[0]) && near(r.profile[r.profile.length - 1].buy, e.profileLast[1]) && near(r.profile[r.profile.length - 1].sell, e.profileLast[2]));
  check(`${tag} POC price and volume share`, r.poc !== null && near(r.poc.price, e.poc) && near(r.poc.netSharePct, e.pocShare, 1e-7), `(${r.poc?.price.toFixed(1)})`);
  check(`${tag} value area`, r.valueAreaLow !== null && near(r.valueAreaLow, e.vaLow) && near(r.valueAreaHigh ?? NaN, e.vaHigh), `(${r.valueAreaLow?.toFixed(1)} - ${r.valueAreaHigh?.toFixed(1)})`);
  check(`${tag} price state vs value area`, r.state === e.state, `(${r.state})`);
  check(`${tag} buyer zone`, (r.buyerZone === null) === (e.buyer === null) && (e.buyer === null || (near(r.buyerZone!.price, e.buyer.price) && near(r.buyerZone!.netSharePct, e.buyer.share, 1e-7))), `(${r.buyerZone?.price.toFixed(1)})`);
  check(`${tag} seller zone`, (r.sellerZone === null) === (e.seller === null) && (e.seller === null || (near(r.sellerZone!.price, e.seller.price) && near(r.sellerZone!.netSharePct, e.seller.share, 1e-7))), `(${r.sellerZone?.price.toFixed(1)})`);
  const b = r.book;
  check(`${tag} book coverage and imbalance`, b !== null && near(b.coveragePct, e.book.coveragePct, 1e-7) && near(b.imbalancePct, e.book.imbalancePct, 1e-7), `(imbalance ${b?.imbalancePct.toFixed(1)} %)`);
  check(`${tag} top walls (price and notional)`, b !== null && e.book.bids.every((w, i) => near(b.bids[i]?.price ?? NaN, w.price) && near(b.bids[i]?.notional ?? NaN, w.notional, 1e-7)) &&
    e.book.asks.every((w, i) => near(b.asks[i]?.price ?? NaN, w.price) && near(b.asks[i]?.notional ?? NaN, w.notional, 1e-7)));
}

// thin market: no profile, no zones
const thinRows: RawKline[] = Array.from({ length: 20 }, (_, i) => [i * 60000, "1", "1.1", "0.9", "1", "5", i * 60000 + 59999, "0", 3, "2", "0", "0"]);
const thinRes = computeFlowZones("X", thinRows, null, 20 * 60000 + 1, "Binance spot", CRYPTO_FLOW_LOOKBACKS[0]);
check("a thin market returns no profile and no zones", thinRes !== null && thinRes.thin && thinRes.profile.length === 0 && thinRes.buyerZone === null && thinRes.poc === null);
check("too few bars returns null", computeFlowZones("X", thinRows.slice(0, 5), null, 20 * 60000 + 1, "Binance spot", CRYPTO_FLOW_LOOKBACKS[0]) === null);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
