// Validates Live Sync alert rules: evaluation, edge-triggered state machine, severity, input validation. Pure.
import assert from "node:assert/strict";
import { alertSeverity, alertText, evaluateRule, KIND_INFO, nextTransition, validateRuleInput, ALERT_KINDS, type AlertContext } from "../services/live-sync/alerts";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const MIN = 60_000;
const ctx = (over: Partial<AlertContext> = {}): AlertContext => ({
  nowUtc: NOW, serverUtcOffsetSec: 0, lastSyncAt: NOW - MIN,
  snapshot: { balance: 1000, equity: 1000, margin: 0, positions: [] },
  dayStartBalance: 1000, peakEquity: 1000, ...over,
});

// ---- margin level
const m1 = evaluateRule({ kind: "margin_level", threshold: 200 }, ctx({ snapshot: { balance: 1000, equity: 1000, margin: 600, positions: [] } }));
eq([m1.breached, m1.value], [true, 166.7], "margin level 166.7% < 200% breaches");
eq(evaluateRule({ kind: "margin_level", threshold: 200 }, ctx({ snapshot: { balance: 1000, equity: 1000, margin: 300, positions: [] } })).breached, false, "333% is fine");
eq(evaluateRule({ kind: "margin_level", threshold: 200 }, ctx()).value, null, "no margin in use -> no value, no breach");
eq(evaluateRule({ kind: "margin_level", threshold: 200 }, ctx({ snapshot: null })).value, null, "no snapshot -> no value");

// ---- daily loss
const d1 = evaluateRule({ kind: "daily_loss", threshold: 5 }, ctx({ snapshot: { balance: 1000, equity: 940, margin: 0, positions: [] } }));
eq([d1.breached, d1.value], [true, 6], "equity 6% below the day start breaches a 5% limit");
eq(evaluateRule({ kind: "daily_loss", threshold: 5 }, ctx({ snapshot: { balance: 1000, equity: 980, margin: 0, positions: [] } })).breached, false, "2% loss does not");
eq(evaluateRule({ kind: "daily_loss", threshold: 5 }, ctx({ snapshot: { balance: 1000, equity: 1100, margin: 0, positions: [] } })).breached, false, "a gain is never a loss");
eq(evaluateRule({ kind: "daily_loss", threshold: 5 }, ctx({ dayStartBalance: null })).value, null, "no day-start balance -> no value");

// ---- drawdown from the 30-day peak
const g = evaluateRule({ kind: "drawdown", threshold: 20 }, ctx({ peakEquity: 2000, snapshot: { balance: 1000, equity: 1500, margin: 0, positions: [] } }));
eq([g.breached, g.value], [true, 25], "equity 25% below the peak breaches a 20% limit");
eq(evaluateRule({ kind: "drawdown", threshold: 20 }, ctx({ peakEquity: null })).value, null, "no peak -> no value");

// ---- EA offline
const o = evaluateRule({ kind: "ea_offline", threshold: 10 }, ctx({ lastSyncAt: NOW - 15 * MIN }));
eq([o.breached, o.value], [true, 15], "15 minutes of silence breaches a 10 minute limit");
eq(evaluateRule({ kind: "ea_offline", threshold: 10 }, ctx({ lastSyncAt: NOW - 2 * MIN })).breached, false, "recent data is fine");
eq(evaluateRule({ kind: "ea_offline", threshold: 10 }, ctx({ lastSyncAt: NOW + 5 * MIN })).value, 0, "a clock-skewed future timestamp counts as 0 minutes, not negative");

// ---- no stop loss (open time is broker time: utc + offset)
const OFF = 10_800; // +3h
const pos = (sl: number, openedMinAgo: number) => ({ ticket: 1, symbol: "US30", side: "sell" as const, volume: 1, priceOpen: 1, sl, tp: 0, profit: 0, timeMsc: NOW + OFF * 1000 - openedMinAgo * MIN });
const withPos = (...p: ReturnType<typeof pos>[]) => ctx({ serverUtcOffsetSec: OFF, snapshot: { balance: 1000, equity: 1000, margin: 10, positions: p } });
eq(evaluateRule({ kind: "no_stop_loss", threshold: 5 }, withPos(pos(0, 10))).value, 1, "position open 10 min with no SL is counted (broker offset handled)");
eq(evaluateRule({ kind: "no_stop_loss", threshold: 5 }, withPos(pos(1.5, 10))).breached, false, "a position with a stop loss is fine");
eq(evaluateRule({ kind: "no_stop_loss", threshold: 5 }, withPos(pos(0, 2))).breached, false, "a position inside the grace period is fine");
eq(evaluateRule({ kind: "no_stop_loss", threshold: 5 }, withPos(pos(0, 10), pos(0, 30), pos(2, 30))).value, 2, "counts only the bare positions");

// ---- state machine
const R = (over: Partial<Parameters<typeof nextTransition>[0]> = {}) => ({ state: "ok" as const, lastFiredAt: null, cooldownMin: 60, enabled: true, ...over });
const B = { breached: true, value: 5, detail: "" }, C = { breached: false, value: 1, detail: "" }, N = { breached: false, value: null, detail: "" };
eq(nextTransition(R(), B, NOW), { action: "fire", reminder: false }, "ok + breach -> fire once");
eq(nextTransition(R({ state: "firing", lastFiredAt: NOW - 10 * MIN }), B, NOW), { action: "none" }, "still breached inside the cooldown -> stay quiet");
eq(nextTransition(R({ state: "firing", lastFiredAt: NOW - 61 * MIN }), B, NOW), { action: "fire", reminder: true }, "still breached after the cooldown -> one reminder");
eq(nextTransition(R({ state: "firing", lastFiredAt: NOW - 5 * MIN }), C, NOW), { action: "resolve" }, "condition cleared -> resolve (no message)");
eq(nextTransition(R(), C, NOW), { action: "none" }, "ok + fine -> nothing");
eq(nextTransition(R({ state: "firing" }), N, NOW), { action: "none" }, "no data never changes the state");
eq(nextTransition(R({ lastFiredAt: NOW - 5 * MIN }), B, NOW), { action: "none" }, "re-breach right after a resolve waits for the cooldown (no flapping spam)");
eq(nextTransition(R({ enabled: false, state: "firing" }), B, NOW), { action: "resolve" }, "disabling a firing rule resets it");
eq(nextTransition(R({ enabled: false }), B, NOW), { action: "none" }, "disabled rules never fire");

// ---- severity + text
eq([alertSeverity("margin_level", 100), alertSeverity("margin_level", 150), alertSeverity("daily_loss", 9)], ["critical", "warning", "warning"], "margin level under 120% is critical");
const t = alertText("margin_level", m1, "Account a339ba", false);
ok(/Margin level is low/.test(t.title) && /Account a339ba/.test(t.title), "title names the alert and the account");
ok(/does not trade or close positions/.test(t.body), "every alert says it is information only");
ok(alertText("daily_loss", d1, "A", true).title.startsWith("Still: "), "reminders are marked");

// ---- input validation
const good = { kind: "margin_level", threshold: 200, enabled: true, notifyEmail: true, notifyBell: false, cooldownMin: 60 };
ok(validateRuleInput(good).ok, "valid rule accepted");
for (const [bad, why] of [
  [{ ...good, kind: "nope" }, "unknown kind"],
  [{ ...good, threshold: 5 }, "threshold below the minimum"],
  [{ ...good, threshold: 99999 }, "threshold above the maximum"],
  [{ ...good, threshold: "abc" }, "non-numeric threshold"],
  [{ ...good, enabled: "yes" }, "non-boolean flag"],
  [{ ...good, cooldownMin: 3 }, "cooldown too short"],
  [{ ...good, cooldownMin: 60.5 }, "non-integer cooldown"],
  [null, "null body"],
] as const) ok(!validateRuleInput(bad).ok, `rejects ${why}`);
ok(ALERT_KINDS.every((k) => { const i = KIND_INFO[k]; return i.defaultThreshold >= i.min && i.defaultThreshold <= i.max; }), "every default threshold is inside its own allowed range");

console.log(`validate-live-sync-alerts: ${checks} checks passed`);
