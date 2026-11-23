// scripts/validate-chart-signals.ts - unit checks for the Pro Chart signal record: outcome rules, summary and the untrusted-body validation (no DB).
// Run: npx tsx scripts/validate-chart-signals.ts
import { resolveOutcome, type CandleLite, type SignalForOutcome } from "../lib/chart-engine/signals/outcome";
import { summarize } from "../lib/chart-engine/signals/stats";
import { dedupeKeyOf, parseRecordInput } from "../lib/chart-engine/signals/record-input";
import { PLAN_FILL_WINDOW, PLAN_MAX_HOLD } from "../lib/chart-engine/annotations/plan";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { if (ok) { pass++; console.log("  ok -", name); } else { fail++; console.log("  FAIL -", name); } };

const T0 = 1_800_000_000_000;
const H = 3_600_000;
const bar = (i: number, o: { high: number; low: number; close?: number }): CandleLite => ({ time: T0 + i * H, high: o.high, low: o.low, close: o.close ?? (o.high + o.low) / 2 });
const longLimit: SignalForOutcome = { dir: "long", entryType: "limit", entry: 100, stop: 95, target: 110, rr: 2, signalTime: T0 };
const longMarket: SignalForOutcome = { ...longLimit, entryType: "market" };
const shortMarket: SignalForOutcome = { dir: "short", entryType: "market", entry: 100, stop: 105, target: 90, rr: 2, signalTime: T0 };
const flat = (i: number): CandleLite => bar(i, { high: 102, low: 98 });

// --- limit entries
check("limit long: no candles after the signal = open", resolveOutcome(longLimit, [bar(0, { high: 120, low: 90 })]).status === "open");
check("limit long: fills, then the target is hit = target, +rr", (() => { const r = resolveOutcome(longLimit, [bar(1, { high: 103, low: 99.5 }), bar(2, { high: 104, low: 101 }), bar(3, { high: 111, low: 103 })]); return r.status === "target" && r.resultR === 2 && r.filledAt === T0 + H && r.closedAt === T0 + 3 * H; })());
check("limit long: filled and then the stop is hit = stop, -1", resolveOutcome(longLimit, [bar(1, { high: 101, low: 99 }), bar(2, { high: 99, low: 94 })]).resultR === -1);
check("limit long: the target is not credited on the bar that fills the order", resolveOutcome(longLimit, [bar(1, { high: 111, low: 99 })]).status === "live");
check("limit long: price goes through the stop before the entry = cancelled, no result", (() => { const r = resolveOutcome(longLimit, [bar(1, { high: 120, low: 94 })]); return r.status === "cancelled" && r.resultR === null; })());
check("limit long: entry never reached inside the fill window = unfilled", resolveOutcome(longLimit, Array.from({ length: PLAN_FILL_WINDOW }, (_, i) => bar(i + 1, { high: 110, low: 104 }))).status === "unfilled");
check("limit long: still waiting before the window is over = open", resolveOutcome(longLimit, Array.from({ length: 5 }, (_, i) => bar(i + 1, { high: 110, low: 104 }))).status === "open");

// --- market entries and shorts
check("market long: target first", resolveOutcome(longMarket, [bar(1, { high: 105, low: 99 }), bar(2, { high: 112, low: 104 })]).status === "target");
check("market long: both stop and target inside one bar = the stop counts (conservative)", resolveOutcome(longMarket, [bar(1, { high: 112, low: 94 })]).status === "stop");
check("market long: neither yet = live", resolveOutcome(longMarket, [flat(1), flat(2)]).status === "live");
check("short: stop above is hit = stop, -1", resolveOutcome(shortMarket, [bar(1, { high: 106, low: 99 })]).resultR === -1);
check("short: the target below is hit = target, +rr", resolveOutcome(shortMarket, [bar(1, { high: 101, low: 89 })]).resultR === 2);
check("a trade held for the maximum bars is marked to market (expired, R from the close)", (() => { const cs = Array.from({ length: PLAN_MAX_HOLD + 1 }, (_, i) => bar(i + 1, { high: 102, low: 98, close: 102.5 })); const r = resolveOutcome(longMarket, cs); return r.status === "expired" && Math.abs((r.resultR ?? 0) - 0.5) < 1e-9; })());
check("only candles AFTER the signal time are used", resolveOutcome(longMarket, [bar(0, { high: 200, low: 50 }), flat(1)]).status === "live");
check("a degenerate signal (stop = entry) never resolves", resolveOutcome({ ...longMarket, stop: 100 }, [flat(1)]).status === "open");
check("resolvedThrough is the last candle that was looked at", resolveOutcome(longMarket, [flat(1), flat(2), flat(3)]).resolvedThrough === T0 + 3 * H);

// --- summary
const rows = [
  { status: "target" as const, resultR: 2, rr: 2 }, { status: "target" as const, resultR: 2, rr: 2 }, { status: "stop" as const, resultR: -1, rr: 2 },
  { status: "expired" as const, resultR: 0.5, rr: 2 }, { status: "cancelled" as const, resultR: null, rr: 2 }, { status: "live" as const, resultR: null, rr: 2 }, { status: "open" as const, resultR: null, rr: 2 },
];
const sm = summarize(rows);
check("summary counts by outcome", sm.total === 7 && sm.target === 2 && sm.stop === 1 && sm.expired === 1 && sm.cancelled === 1 && sm.live === 1 && sm.open === 1 && sm.closed === 4);
check("summary: target share = targets / finished trades, average R over finished trades", sm.targetShare === 0.5 && Math.abs((sm.avgR ?? 0) - 0.875) < 1e-9);
check("summary: break-even share for rr 2 is one third", Math.abs((sm.breakEvenShare ?? 0) - 1 / 3) < 1e-9);
check("summary: too few finished trades is flagged, nothing finished gives nulls", sm.enoughData === false && summarize([]).targetShare === null && summarize([]).avgR === null);

// --- untrusted body
const good = { symbol: "BTCUSD", timeframe: "1h", dir: "long", entryType: "limit", entry: 59556, stop: 58943, target: 60782, rr: 2, score: 4, scoreMax: 6, confluences: ["Inside OTE (61.8-78.6 %)", "Entry in discount"], signalTime: Date.now() - 3_600_000, lastClose: 60800 };
const throws = (b: unknown) => { try { parseRecordInput(b); return false; } catch { return true; } };
check("a valid body is accepted", !throws(good));
check("the dedupe key is stable for the same plan on the same candle and differs for another candle", dedupeKeyOf(parseRecordInput(good)) === dedupeKeyOf(parseRecordInput({ ...good })) && dedupeKeyOf(parseRecordInput(good)) !== dedupeKeyOf(parseRecordInput({ ...good, signalTime: good.signalTime - H })));
check("an unknown timeframe, a bad direction or a bad symbol is refused", throws({ ...good, timeframe: "7m" }) && throws({ ...good, dir: "up" }) && throws({ ...good, symbol: "BTC USD;--" }));
check("numbers in the wrong order for the direction are refused", throws({ ...good, stop: 61000 }) && throws({ ...good, dir: "short" }));
check("NaN, negative and string numbers are refused", throws({ ...good, entry: Number.NaN }) && throws({ ...good, target: -1 }) && throws({ ...good, stop: "58943" }));
check("a signalTime in the future or in the 1970s is refused", throws({ ...good, signalTime: Date.now() + 86_400_000 }) && throws({ ...good, signalTime: 5 }));
check("confluences are capped and cleaned", (() => { const p = parseRecordInput({ ...good, confluences: ["x".repeat(500), 5, ...Array(20).fill("a")] }); return p.confluences.length === 8 && p.confluences[0].length === 80; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
