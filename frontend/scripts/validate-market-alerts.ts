// Market alerts: the pure evaluator, the edge-triggered runner (fire once, cooldown, resolve and re-arm, compare-and-set,
// no data = no change, one data fetch per symbol), the alert wording and the rule validation. Offline: fake store / data.
import assert from "node:assert/strict";
import { evaluateMarketRule, marketAlertText, validateMarketRuleInput, labelFor, MARKET_ALERT_INFO, type MarketAlertContext } from "../services/market-alerts/alerts";
import { runMarketAlertsWith, type RunnerDeps, type StoredRule } from "../services/market-alerts/runner";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${(e as Error).message}`);
  }
}

const NOW = Date.parse("2026-10-14T10:00:00Z");
const smc = (over: Partial<NonNullable<MarketAlertContext["smc"]>> = {}): NonNullable<MarketAlertContext["smc"]> => ({
  price: 4150,
  atr: 6,
  pools: [
    { kind: "PDH", price: 4153, status: "untouched" },
    { kind: "PDL", price: 4100, status: "untouched" },
    { kind: "EQH", price: 4160, status: "untouched" },
  ],
  volatility: "Normal",
  volatilityRatio: 1.0,
  ...over,
});
const ctxOf = (over: Partial<MarketAlertContext> = {}): MarketAlertContext => ({ nowUtc: NOW, smc: smc(), events: [], ...over });
const ev = (minsFromNow: number, title = "CPI m/m", impact = "high") => ({ title, currency: "USD", eventTime: new Date(NOW + minsFromNow * 60000).toISOString(), impact });

async function main() {
  // ── evaluator ──
  await test("level_near: within the threshold of an unswept PDH/PDL -> breached, with the distance in ATR and in price", () => {
    const e = evaluateMarketRule({ kind: "level_near", threshold: 0.5, symbol: "XAUUSD" }, ctxOf());
    assert.equal(e.breached, true); // PDH is 3 away = 0.5 ATR
    assert.equal(e.value, 0.5);
    assert.match(e.detail, /Gold is 0\.50 ATR \(3\.00\) below yesterday's high 4153\.00/);
    assert.equal(evaluateMarketRule({ kind: "level_near", threshold: 0.25, symbol: "XAUUSD" }, ctxOf()).breached, false);
  });

  await test("level_near: a swept level is ignored; both swept or no ATR -> no data (null), never a guess", () => {
    const swept = smc({ pools: [{ kind: "PDH", price: 4153, status: "swept" }, { kind: "PDL", price: 4149, status: "untouched" }] });
    const e = evaluateMarketRule({ kind: "level_near", threshold: 1, symbol: "XAUUSD" }, ctxOf({ smc: swept }));
    assert.match(e.detail, /yesterday's low 4149\.00/);
    const bothSwept = smc({ pools: [{ kind: "PDH", price: 4153, status: "swept" }, { kind: "PDL", price: 4149, status: "swept" }] });
    assert.equal(evaluateMarketRule({ kind: "level_near", threshold: 1, symbol: "XAUUSD" }, ctxOf({ smc: bothSwept })).value, null);
    assert.equal(evaluateMarketRule({ kind: "level_near", threshold: 1, symbol: "XAUUSD" }, ctxOf({ smc: null })).value, null);
    assert.equal(evaluateMarketRule({ kind: "level_near", threshold: 1, symbol: "XAUUSD" }, ctxOf({ smc: smc({ atr: 0 }) })).value, null);
  });

  await test("vol_high: breached above 1.3x; not at 1.0x; no reading -> null", () => {
    assert.equal(evaluateMarketRule({ kind: "vol_high", threshold: 1.3, symbol: "BTCUSD" }, ctxOf({ smc: smc({ volatility: "High", volatilityRatio: 1.62 }) })).breached, true);
    assert.equal(evaluateMarketRule({ kind: "vol_high", threshold: 1.3, symbol: "BTCUSD" }, ctxOf()).breached, false);
    assert.equal(evaluateMarketRule({ kind: "vol_high", threshold: 1.3, symbol: "BTCUSD" }, ctxOf({ smc: smc({ volatility: "--", volatilityRatio: null }) })).value, null);
  });

  await test("event_soon: next high-impact timed event inside the window; holidays, all-day, past and low impact never count; simultaneous releases are listed together", () => {
    const e = evaluateMarketRule({ kind: "event_soon", threshold: 30, symbol: "XAUUSD" }, ctxOf({ events: [ev(25), ev(25, "Core CPI m/m"), ev(-10, "old"), ev(20, "minor", "low"), { ...ev(10, "Bank Holiday"), isHoliday: true }] }));
    assert.equal(e.breached, true);
    assert.equal(e.value, 25);
    assert.match(e.detail, /USD CPI m\/m, USD Core CPI m\/m in 25 min/);
    assert.equal(evaluateMarketRule({ kind: "event_soon", threshold: 15, symbol: "XAUUSD" }, ctxOf({ events: [ev(25)] })).breached, false);
    assert.equal(evaluateMarketRule({ kind: "event_soon", threshold: 30, symbol: "XAUUSD" }, ctxOf({ events: null })).value, null);
    assert.equal(evaluateMarketRule({ kind: "event_soon", threshold: 30, symbol: "XAUUSD" }, ctxOf({ events: [] })).breached, false); // a real "no event"
  });

  // ── runner ──
  const baseRule = (over: Partial<StoredRule> = {}): StoredRule => ({ id: "r1", userId: "u1", symbol: "XAUUSD", kind: "level_near", threshold: 0.5, enabled: true, cooldownMin: 240, state: "ok", lastFiredAt: null, ...over });
  function harness(rules: StoredRule[], ctx: { smc?: MarketAlertContext["smc"]; events?: MarketAlertContext["events"] } = {}) {
    const store = rules.map((r) => ({ ...r }));
    const sent: { userId: string; title: string; body: string }[] = [];
    const calls = { smc: 0, events: 0 };
    let casLoses = false;
    const deps: RunnerDeps = {
      listEnabledRules: async () => store.filter((r) => r.enabled).map((r) => ({ ...r })),
      cas: async (rule, data) => {
        const cur = store.find((r) => r.id === rule.id)!;
        if (casLoses || cur.state !== rule.state || (cur.lastFiredAt?.getTime() ?? null) !== (rule.lastFiredAt?.getTime() ?? null)) return false;
        cur.state = data.state;
        if (data.lastFiredAt) cur.lastFiredAt = data.lastFiredAt;
        return true;
      },
      getSmc: async () => (calls.smc++, ctx.smc === undefined ? smc() : ctx.smc),
      getEvents: async () => (calls.events++, ctx.events === undefined ? [] : ctx.events),
      notify: async (userId, n) => void sent.push({ userId, title: n.title, body: n.body }),
    };
    return { store, sent, calls, deps, loseCas: () => (casLoses = true) };
  }

  await test("runner: a breach is announced once; the next run inside the cooldown stays silent", async () => {
    const h = harness([baseRule()]);
    const r1 = await runMarketAlertsWith(h.deps, new Date(NOW));
    assert.equal(r1.fired, 1);
    assert.equal(h.store[0].state, "firing");
    const r2 = await runMarketAlertsWith(h.deps, new Date(NOW + 5 * 60000));
    assert.equal(r2.fired, 0);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].title, /Gold: near yesterday's high or low/);
    assert.ok(/not a trade call/.test(h.sent[0].body));
  });

  await test("runner: condition clears -> re-armed silently; next breach announces again (after the cooldown)", async () => {
    const h = harness([baseRule({ cooldownMin: 10 })]);
    await runMarketAlertsWith(h.deps, new Date(NOW));
    // price moves away: resolve, no message
    const away = harness([{ ...h.store[0] }], { smc: smc({ price: 4120 }) });
    await runMarketAlertsWith(away.deps, new Date(NOW + 15 * 60000));
    assert.equal(away.store[0].state, "ok");
    assert.equal(away.sent.length, 0);
    // comes back later
    const back = harness([{ ...away.store[0] }]);
    const r = await runMarketAlertsWith(back.deps, new Date(NOW + 60 * 60000));
    assert.equal(r.fired, 1);
  });

  await test("runner: still breached after the cooldown -> a reminder prefixed 'Still:'", async () => {
    const h = harness([baseRule({ state: "firing", lastFiredAt: new Date(NOW - 300 * 60000), cooldownMin: 240 })]);
    const r = await runMarketAlertsWith(h.deps, new Date(NOW));
    assert.equal(r.fired, 1);
    assert.match(h.sent[0].title, /^Still: /);
  });

  await test("runner: compare-and-set loss (another run got there first) sends nothing", async () => {
    const h = harness([baseRule()]);
    h.loseCas();
    const r = await runMarketAlertsWith(h.deps, new Date(NOW));
    assert.equal(r.fired, 0);
    assert.equal(h.sent.length, 0);
  });

  await test("runner: no data (SMC unavailable) changes nothing and is counted as skipped; a disabled rule is never read", async () => {
    const h = harness([baseRule(), baseRule({ id: "r2", userId: "u2", enabled: false })], { smc: null });
    const r = await runMarketAlertsWith(h.deps, new Date(NOW));
    assert.equal(r.fired, 0);
    assert.equal(r.skipped, 1);
    assert.equal(r.rules, 1);
    assert.equal(h.store[0].state, "ok");
  });

  await test("runner: data is fetched once per symbol however many users watch it; only the needed feeds are fetched", async () => {
    const rules = [1, 2, 3].map((i) => baseRule({ id: `r${i}`, userId: `u${i}` }));
    const h = harness(rules);
    const r = await runMarketAlertsWith(h.deps, new Date(NOW));
    assert.equal(r.symbols, 1);
    assert.equal(h.calls.smc, 1);
    assert.equal(h.calls.events, 0);
    assert.equal(r.fired, 3);
    assert.deepEqual(h.sent.map((s) => s.userId).sort(), ["u1", "u2", "u3"]);
    const e = harness([baseRule({ kind: "event_soon", threshold: 30 })], { events: [ev(20)] });
    await runMarketAlertsWith(e.deps, new Date(NOW));
    assert.equal(e.calls.smc, 0);
    assert.equal(e.calls.events, 1);
    assert.match(e.sent[0].title, /^Gold: high-impact event in 20 min$/);
  });

  await test("runner: a failing store read (table absent) returns an empty result instead of throwing", async () => {
    const r = await runMarketAlertsWith({ ...harness([]).deps, listEnabledRules: async () => { throw new Error("relation does not exist"); } }, new Date(NOW));
    assert.deepEqual(r, { rules: 0, symbols: 0, fired: 0, skipped: 0 });
  });

  // ── wording + validation ──
  await test("wording: titles name the instrument; nothing reads as a trade instruction", () => {
    for (const kind of ["level_near", "vol_high", "event_soon"] as const) {
      const t = marketAlertText(kind, "BTCUSD", { breached: true, value: 20, detail: "x" }, false);
      assert.ok(t.title.startsWith("Bitcoin:"), t.title);
      assert.ok(!/(buy|sell)(?!-side)|(entry|stop[- ]?loss|take[- ]?profit|target)/i.test(t.title + " " + t.body), t.title + t.body);
    }
    assert.equal(labelFor("XAUUSD"), "Gold");
    assert.equal(labelFor("ZZZ"), "ZZZ");
  });

  await test("validation: known symbol / kind / boolean enabled; threshold only from the allowed options; defaults applied", () => {
    const syms = ["XAUUSD", "BTCUSD"];
    assert.equal(validateMarketRuleInput({ symbol: "XAUUSD", kind: "level_near", enabled: true, threshold: 0.25 }, syms).ok, true);
    assert.equal(validateMarketRuleInput({ symbol: "DOGE", kind: "level_near", enabled: true }, syms).ok, false);
    assert.equal(validateMarketRuleInput({ symbol: "XAUUSD", kind: "nope", enabled: true }, syms).ok, false);
    assert.equal(validateMarketRuleInput({ symbol: "XAUUSD", kind: "level_near", enabled: "yes" }, syms).ok, false);
    assert.equal(validateMarketRuleInput({ symbol: "XAUUSD", kind: "event_soon", enabled: true, threshold: 7 }, syms).ok, false);
    const d = validateMarketRuleInput({ symbol: "XAUUSD", kind: "vol_high", enabled: true, threshold: 99 }, syms);
    assert.ok(d.ok && d.value.threshold === MARKET_ALERT_INFO.vol_high.defaultThreshold, "vol_high has no threshold choice: the default is used");
    const dflt = validateMarketRuleInput({ symbol: "BTCUSD", kind: "event_soon", enabled: false }, syms);
    assert.ok(dflt.ok && dflt.value.threshold === 30);
    assert.equal(validateMarketRuleInput(null, syms).ok, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
main();
