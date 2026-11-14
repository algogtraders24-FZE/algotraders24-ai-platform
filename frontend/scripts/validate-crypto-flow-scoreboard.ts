// scripts/validate-crypto-flow-scoreboard.ts
// Validation for the Flow Zones forward scoreboard and alert rule (no network, no database): hand-worked cases for
// the typical hour range, touch detection, the reaction r, "pending" handling, de-duplication, the verdicts and the alert rule.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawKline } from "../services/crypto-flow/compute";
import {
  ALERT_COOLDOWN_MS,
  buildScoreboard,
  dedupeEvents,
  evaluateSnapshot,
  firstTouchIndex,
  scoreEvents,
  shouldAlert,
  typicalHourRangePct,
  type SnapshotZones,
} from "../services/crypto-flow/scoreboard";
import { parseZoneBars, type ZoneBar } from "../services/crypto-flow/zones";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const BAR = 5 * 60_000;
const bar = (i: number, low: number, high: number, close: number): ZoneBar => ({ t: 1_000_000 + i * BAR, high, low, close, volume: 1, trades: 1, takerBuy: 0.5 });

// ---- typical hour range: 24 chunks of 12 bars, each (high 101, low 100, close 100.5) -> 100 * 1 / 100.5 -------------------
const flat: ZoneBar[] = Array.from({ length: 288 }, (_, i) => bar(i, 100, 101, 100.5));
check("typical hour range of a flat series", near(typicalHourRangePct(flat) ?? NaN, (100 * 1) / 100.5, 1e-12));
check("typical hour range needs at least 6 hours of bars", typicalHourRangePct(flat.slice(0, 60)) === null);
// median, not mean: 23 quiet chunks and one huge one
const spike = flat.map((b, i) => (i >= 276 ? { ...b, high: 200 } : b));
check("typical hour range is a median (one wild hour does not move it)", near(typicalHourRangePct(spike) ?? NaN, (100 * 1) / 100.5, 1e-12));

// ---- touch and reaction ----------------------------------------------------------------------------------------------
// price 100, step 1 (stepPct 1), buyer zone 98, seller zone 102, X = 2 %
const snap: SnapshotZones = { price: 100, stepPct: 1, xRangePct: 2, buyerPrice: 98, sellerPrice: 102 };
// buyer touched when low <= 98.5, seller when high >= 101.5
const mid = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 99.6, 100.4, 100));
check("no touch in a flat window", firstTouchIndex("buyer", snap, mid(10)) === -1 && firstTouchIndex("seller", snap, mid(10)) === -1);
const series = mid(80);
series[5] = bar(5, 98.5, 100.2, 99); // buyer touch exactly at the edge (98.5), close 99
series[17] = bar(17, 99.5, 100.4, 100.98); // 12 bars after the touch: close 100.98
check("buyer touch at the exact edge counts", firstTouchIndex("buyer", snap, series) === 5);
const ev = evaluateSnapshot(snap, series);
check("evaluation is done", ev.state === "done");
if (ev.state === "done") {
  // r = (100.98 / 99 - 1) * 100 / 2 = 1.0
  check("buyer reaction r = +1.0 X", ev.buyer.touchAt === series[5].t && near(ev.buyer.r ?? NaN, (100 * (100.98 / 99 - 1)) / 2, 1e-12));
  check("seller zone never reached in the 6 h window", ev.seller.touchAt === null && ev.seller.r === null);
}
// seller touch with a falling market: direction is down, so a fall is a positive r
const sell = mid(80);
sell[3] = bar(3, 99.6, 101.5, 101);
sell[15] = bar(15, 99.6, 100.4, 99.99);
const evS = evaluateSnapshot(snap, sell);
check("seller reaction: a fall after the touch is positive", evS.state === "done" && near(evS.seller.r ?? NaN, (100 * -(99.99 / 101 - 1)) / 2, 1e-12) && (evS.seller.r ?? 0) > 0);
// pending: the touch is recent, its hour is not complete
check("pending while the reaction hour is incomplete", evaluateSnapshot(snap, series.slice(0, 12)).state === "pending");
check("pending while the watch window is incomplete and nothing touched", evaluateSnapshot(snap, mid(40)).state === "pending");
// no zone on a side: that side is simply untouched, the other still scores
const oneSide = evaluateSnapshot({ ...snap, sellerPrice: null }, series);
check("a missing zone is untouched, not pending", oneSide.state === "done" && oneSide.seller.touchAt === null);
// a touch after the 72nd bar does not count
const late = mid(100);
late[75] = bar(75, 97, 100.4, 99);
check("a touch after 6 hours is outside the window", evaluateSnapshot(snap, late).state === "done" && firstTouchIndex("buyer", snap, late.slice(0, 72)) === -1);

// ---- de-duplication, scoring, verdicts -------------------------------------------------------------------------------
const H = 3_600_000;
const dd = dedupeEvents([
  { symbol: "BTCUSDT", side: "buyer", touchAt: 0, r: 1 },
  { symbol: "BTCUSDT", side: "buyer", touchAt: 0.5 * H, r: 5 }, // overlaps the first hour -> dropped
  { symbol: "BTCUSDT", side: "buyer", touchAt: 1 * H, r: 2 }, // exactly 60 minutes later -> kept
  { symbol: "BTCUSDT", side: "seller", touchAt: 0.5 * H, r: 3 }, // another side -> kept
  { symbol: "ETHUSDT", side: "buyer", touchAt: 0.2 * H, r: 4 }, // another symbol -> kept
]);
check("de-duplication keeps 4 of 5", dd.length === 4 && !dd.some((e) => e.r === 5));
const few = scoreEvents([1, 2, 3]);
check("fewer than 30 events is COLLECTING", few.verdict === "COLLECTING" && few.n === 3 && near(few.meanR ?? NaN, 2) && near(few.hitPct ?? NaN, 100));
// 40 events alternating +1.2 / -0.8 -> mean 0.2, sd = 1.0 * sqrt(40/39) -> t = 0.2 / (sd / sqrt(40))
const alt = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1.2 : -0.8));
const altS = scoreEvents(alt);
const sd = Math.sqrt((40 * 1.0 * 1.0) / 39);
check("t statistic by hand", near(altS.meanR ?? NaN, 0.2) && near(altS.t ?? NaN, 0.2 / (sd / Math.sqrt(40)), 1e-12) && altS.verdict === "NO EDGE SHOWN", `(t=${altS.t?.toFixed(3)})`);
const strong = scoreEvents(Array.from({ length: 40 }, (_, i) => 1 + (i % 2 === 0 ? 0.1 : -0.1)));
check("a consistent positive result is flagged POSITIVE ON THIS HISTORY", strong.verdict === "POSITIVE ON THIS HISTORY");
const neg = scoreEvents(Array.from({ length: 40 }, (_, i) => -1 + (i % 2 === 0 ? 0.1 : -0.1)));
check("a consistent negative result is flagged NEGATIVE ON THIS HISTORY", neg.verdict === "NEGATIVE ON THIS HISTORY");
check("all-equal results have no t and no verdict claim", scoreEvents(Array.from({ length: 40 }, () => 0.5)).verdict === "NO EDGE SHOWN" && scoreEvents(Array.from({ length: 40 }, () => 0.5)).t === null);
const board = buildScoreboard(
  [
    { symbol: "BTCUSDT", side: "buyer", touchAt: 0, r: 1 },
    { symbol: "BTCUSDT", side: "buyer", touchAt: 2 * H, r: -1 },
  ],
  [{ symbol: "BTCUSDT", side: "seller" }, { symbol: "BTCUSDT", side: "buyer" }],
  3,
  5,
);
const btcBuyer = board.rows.find((r) => r.symbol === "BTCUSDT" && r.side === "buyer");
check("scoreboard row counts events and untouched", btcBuyer?.n === 2 && btcBuyer.untouched === 1 && board.open === 3 && board.done === 5 && board.rows.length === 2);

// ---- alert rule ------------------------------------------------------------------------------------------------------
const now = 10 * H;
const base = { touchBarOpenMs: now - 10 * 60_000, nowMs: now, obsId: "o2", lastObsId: "o1" as string | null, lastAtMs: null as number | null };
check("alert: a fresh touch of a new snapshot is sent", shouldAlert(base));
check("alert: the same snapshot is never sent twice", !shouldAlert({ ...base, lastObsId: "o2" }));
check("alert: cooldown of 3 hours", !shouldAlert({ ...base, lastAtMs: now - ALERT_COOLDOWN_MS + 1 }) && shouldAlert({ ...base, lastAtMs: now - ALERT_COOLDOWN_MS }));
check("alert: a touch that is more than 30 minutes old is stale", !shouldAlert({ ...base, touchBarOpenMs: now - 50 * 60_000 }));

// ---- the real fixture: parseZoneBars on real 5m bars gives a typical hour range in a sensible band --------------------
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "crypto-flow-zones-fixture.json"), "utf8")) as { nowMs: number; klines: { "24h": RawKline[] } };
const x = typicalHourRangePct(parseZoneBars(fx.klines["24h"], fx.nowMs));
check("typical hour range on real BTC 5m bars is plausible (0.1 % to 3 %)", x !== null && x > 0.1 && x < 3, `(${x?.toFixed(3)} %)`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
