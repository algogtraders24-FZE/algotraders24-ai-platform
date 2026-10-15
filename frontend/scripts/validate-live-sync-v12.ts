// Validates the EA v1.2 wire additions: position pips / riskToSl, pending orders, and the live summary's risk-to-SL line. Pure.
import assert from "node:assert/strict";
import { validateIngestBody } from "../services/live-sync/validate";
import { summarizeLive, type SnapshotRow } from "../services/live-sync/live-summary";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const T = Date.parse("2026-10-10T12:00:00Z");
const pos = (extra: Record<string, unknown> = {}) => ({ ticket: 1, symbol: "US30", side: "buy", volume: 0.1, priceOpen: 40000, sl: 39900, tp: 0, profit: 12.5, timeMsc: T, ...extra });
const order = (extra: Record<string, unknown> = {}) => ({ ticket: 9, symbol: "XAUUSD", type: "buy_limit", volume: 0.2, price: 2300.5, sl: 2290, tp: 2320, timeMsc: T, ...extra });
const body = (snapshot: Record<string, unknown>) => ({
  v: 1, accountKey: "a".repeat(64),
  account: { currency: "USD", mode: "demo", marginMode: "hedging", leverage: 100, serverUtcOffsetSec: 0, terminalBuild: 5000 },
  deals: [], snapshot,
});
const snap = (extra: Record<string, unknown> = {}) => ({ timeMsc: T, balance: 1000, equity: 1010, margin: 50, freeMargin: 960, positions: [pos()], ...extra });
const good = (s: Record<string, unknown>) => { const r = validateIngestBody(body(s)); assert.ok(r.ok, r.ok ? "" : r.message); return r.ok ? r.body : null; };
const bad = (s: Record<string, unknown>) => { const r = validateIngestBody(body(s)); assert.ok(!r.ok, "should be rejected"); checks++; return r.ok ? "" : r.message; };

// ---- broker symbol suffixes (a "+" suffix used to be refused, so the whole batch got 422 forever)
for (const sym of ["XAUUSD+", "EURUSD.m", "GOLD#", "US30!", "BTCUSD.", "XAUUSDm", "EURUSD-ECN", "US30.cash"]) {
  eq(good(snap({ positions: [pos({ symbol: sym })], orders: [order({ symbol: sym })] }))!.snapshot!.positions[0]!.symbol, sym, `symbol ${sym} accepted in positions and orders`);
}
for (const sym of ["US 30", "X;DROP", "<b>", "A\"B", "A'B", "A/B"]) bad(snap({ positions: [pos({ symbol: sym })] }));

// ---- old EAs (no new fields) still pass unchanged
eq(good(snap())!.snapshot!.positions[0], pos(), "a v1.1 snapshot is accepted exactly as before");
ok(good(snap())!.snapshot!.orders === undefined, "no orders key = no orders");

// ---- new position fields
const withNew = good(snap({ positions: [pos({ pips: -12.4, riskToSl: 10 })] }))!.snapshot!.positions[0]!;
eq([withNew.pips, withNew.riskToSl], [-12.4, 10], "pips and riskToSl are kept");
ok(bad(snap({ positions: [pos({ riskToSl: -1 })] })).includes("riskToSl"), "negative riskToSl is refused");
ok(bad(snap({ positions: [pos({ pips: "3" })] })).includes("pips"), "non-numeric pips refused");
ok(bad(snap({ positions: [pos({ extra: 1 })] })).length > 0, "unknown position field still refused (closed schema)");

// ---- pending orders
const o = good(snap({ orders: [order(), order({ ticket: 10, type: "sell_stop" })] }))!.snapshot!.orders!;
eq(o.length, 2, "two pending orders accepted");
eq(o[0], order(), "order fields kept exactly");
eq(good(snap({ orders: [] }))!.snapshot!.orders, [], "an empty list means the EA reports none");
ok(bad(snap({ orders: [order({ type: "market" })] })).includes("type"), "unknown order type refused");
ok(bad(snap({ orders: [order({ volume: 0 })] })).includes("volume"), "zero volume refused");
ok(bad(snap({ orders: [order({ login: 123 })] })).length > 0, "unknown order field refused (no identity smuggling)");
ok(bad(snap({ orders: Array.from({ length: 51 }, (_, i) => order({ ticket: i + 1 })) })).includes("orders"), "more than 50 orders refused");
ok(bad(snap({ orders: "x" })).includes("orders"), "orders must be an array");
ok(bad(snap({ orders: [order({ symbol: "<script>" })] })).includes("symbol"), "odd symbol refused");

// ---- summary: risk to stop loss
const row = (positions: SnapshotRow["positions"], orders?: SnapshotRow["orders"]): SnapshotRow => ({ time: T, balance: 1000, equity: 1000, margin: 50, freeMargin: 950, positions, orders });
const p = (extra: Partial<SnapshotRow["positions"][number]>) => ({ ticket: 1, symbol: "US30", side: "buy" as const, volume: 0.1, priceOpen: 1, sl: 0.5, tp: 0, profit: 0, timeMsc: T, ...extra });
{
  const s = summarizeLive([row([p({ riskToSl: 10 }), p({ ticket: 2, riskToSl: 15 }), p({ ticket: 3, sl: 0 })])], T);
  eq([s.riskToSl, s.riskToSlPct, s.withoutStopLoss], [25, 2.5, 1], "risk 25 on equity 1000 = 2.5%; the position without SL is counted separately, not as zero risk");
  eq(s.pendingOrders, null, "an older EA does not report orders: null, not an empty list");
}
{
  const s = summarizeLive([row([p({})])], T);
  eq([s.riskToSl, s.riskToSlPct], [null, null], "no EA v1.2 risk data = unknown, never 0");
}
{
  const s = summarizeLive([row([], [order() as never])], T);
  eq(s.pendingOrders!.length, 1, "pending orders pass through");
  eq(summarizeLive([row([], [])], T).pendingOrders, [], "an EA that reports none = empty list");
}

console.log(`validate-live-sync-v12: ${checks} checks passed`);
