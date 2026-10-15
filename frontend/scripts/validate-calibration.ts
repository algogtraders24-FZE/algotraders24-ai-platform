// Calibration scoreboard: the forecast is built only from live data in an open market, one per symbol per 4h slot
// (idempotent), settled only after it is due, voided (never counted) when the outcome candle is missing, and summarised
// with an honest interval and a "collecting" status for small samples. Offline: fake store / data.
import assert from "node:assert/strict";
import { buildForecast, settle, slotStart, summarise, pooled, pooledByWindow, wilson, MIN_SAMPLE, type StoredForecast, type NewForecast, type Settlement } from "../services/calibration/forecast";
import { runCalibrationWith, type CalibrationDeps } from "../services/calibration/runner";
import { rangesFor, rangeBriefLine, validatedEventsInWindow, EVENT_WIDEN, rangeClassFor } from "../services/smc/expected-range";

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

const H = 3_600_000;
const T0 = Date.parse("2026-10-14T08:00:00Z"); // a 4h slot start
const at = (ms: number) => new Date(ms);
const analysis = (over: Partial<{ price: number; atr: number; lastClosedTime: string }> = {}) => ({ price: 4150, atr: 6, lastClosedTime: new Date(T0 + 7 * 60_000 - H).toISOString(), ...over });

async function main() {
  await test("slotStart: floors to 00/04/08... UTC", () => {
    assert.equal(slotStart(at(T0 + 3 * H + 59 * 60_000)).toISOString(), "2026-10-14T08:00:00.000Z");
    assert.equal(slotStart(at(T0 + 4 * H)).toISOString(), "2026-10-14T12:00:00.000Z");
  });

  await test("buildForecast: bands are the validated ATR*sqrt(h)*multiplier; stale candle (market closed) or no ATR -> no forecast", () => {
    const f = buildForecast("XAUUSD", analysis(), at(T0 + 7 * 60_000))!;
    assert.equal(f.issuedAt.toISOString(), "2026-10-14T08:00:00.000Z");
    assert.ok(Math.abs(f.band12 - 6 * Math.sqrt(12) * 0.9) < 1e-9);
    assert.ok(Math.abs(f.band24 - 6 * Math.sqrt(24) * 0.95) < 1e-9);
    assert.equal(buildForecast("XAUUSD", analysis({ lastClosedTime: new Date(T0 - 30 * H).toISOString() }), at(T0 + 7 * 60_000)), null);
    assert.equal(buildForecast("XAUUSD", analysis({ atr: 0 }), at(T0 + 7 * 60_000)), null);
  });

  const stored = (over: Partial<StoredForecast> = {}): StoredForecast => ({ id: "f1", symbol: "XAUUSD", issuedAt: at(T0), price: 4150, band12: 20, band24: 30, settled12: false, settled24: false, ...over });

  const cpi = (hoursAhead: number, title = "CPI m/m", currency = "USD") => ({ title, currency, eventTime: new Date(T0 + 7 * 60_000 + hoursAhead * H).toISOString(), impact: "high" });
  const NOWX = T0 + 7 * 60_000;

  await test("event widening: only USD CPI / payrolls / Fed decisions inside the window count; other releases, other currencies, holidays and past events are ignored", () => {
    const ev = [cpi(3), cpi(5, "Non-Farm Employment Change"), cpi(8, "Federal Funds Rate"), cpi(2, "Retail Sales m/m"), cpi(2, "CPI y/y", "EUR"), cpi(-1), { ...cpi(4), isHoliday: true }, cpi(30)];
    const got = validatedEventsInWindow(ev, NOWX, 12).map((e) => e.label);
    assert.deepEqual(got, ["US CPI", "US payrolls", "Fed decision"]);
    assert.deepEqual(validatedEventsInWindow(ev, NOWX, 24).length, 3); // the one at +30h is outside 24h
    assert.deepEqual(validatedEventsInWindow(null, NOWX, 12), []);
  });

  await test("event widening: factors per class and horizon exactly as fitted; a release only widens the horizons whose window contains it", () => {
    assert.equal(rangeClassFor("XAUUSD"), "metals-fx");
    assert.equal(rangeClassFor("EURUSD"), "metals-fx");
    assert.equal(rangeClassFor("BTCUSD"), "crypto");
    assert.equal(rangeClassFor("ETHUSD"), "crypto");
    const a = { atr: 6, price: 4150 };
    const plain = rangesFor(a, { symbol: "XAUUSD", nowMs: NOWX, events: [] })!;
    const inWin = rangesFor(a, { symbol: "XAUUSD", nowMs: NOWX, events: [cpi(3)] })!;
    assert.equal(inWin.r12.factor, EVENT_WIDEN["metals-fx"][12]);
    assert.equal(inWin.r24.factor, EVENT_WIDEN["metals-fx"][24]);
    assert.ok(Math.abs(inWin.r12.dist - plain.r12.dist * 2.0) < 1e-9 && Math.abs(inWin.r24.dist - plain.r24.dist * 1.4) < 1e-9);
    const late = rangesFor(a, { symbol: "XAUUSD", nowMs: NOWX, events: [cpi(18)] })!; // only inside the 24h window
    assert.equal(late.r12.factor, 1);
    assert.equal(late.r24.factor, 1.4);
    const btc = rangesFor(a, { symbol: "BTCUSD", nowMs: NOWX, events: [cpi(3)] })!;
    assert.deepEqual([btc.r12.factor, btc.r24.factor], [1.3, 1]);
    assert.equal(rangesFor({ atr: 0, price: 1 }), null);
  });

  await test("event widening: the brief says so and by how much; with no release the line is the plain one", () => {
    const plain = rangeBriefLine({ atr: 6, price: 4150 }, { symbol: "XAUUSD", nowMs: NOWX, events: [] })!;
    assert.ok(!/Widened/.test(plain));
    const w = rangeBriefLine({ atr: 6, price: 4150 }, { symbol: "XAUUSD", nowMs: NOWX, events: [cpi(3)] })!;
    assert.match(w, /12h \+\/-37\.41 \(0\.90%\), 24h \+\/-39\.09 \(0\.94%\)/);
    assert.match(w, /Widened \(12h x2, 24h x1\.4\) because US CPI \(\d\d:\d\d UTC\) falls inside the window/);
    assert.equal(rangeBriefLine({ atr: 6, price: 4150 }), plain); // no context: plain
  });

  await test("buildForecast: stores the widened band and flags exactly the horizons that contain a release", () => {
    const f = buildForecast("XAUUSD", analysis(), at(NOWX), [cpi(18)])!;
    assert.deepEqual([f.event12, f.event24], [false, true]);
    assert.ok(Math.abs(f.band24 - 6 * Math.sqrt(24) * 0.95 * 1.4) < 1e-9);
    assert.ok(Math.abs(f.band12 - 6 * Math.sqrt(12) * 0.9) < 1e-9);
    const g = buildForecast("XAUUSD", analysis(), at(NOWX), null)!;
    assert.deepEqual([g.event12, g.event24], [false, false]);
  });

  await test("pooledByWindow: each horizon splits on its own flag; voided rows excluded", () => {
    const r = (e12: boolean, e24: boolean, i12: boolean | null, i24: boolean | null) => ({ symbol: "XAUUSD", event12: e12, event24: e24, inside12: i12, inside24: i24 });
    const rows = [r(true, true, true, false), r(true, true, false, true), r(false, true, true, null), r(false, false, true, true), r(false, false, null, false)];
    const s = pooledByWindow(rows);
    const get = (arr: ReturnType<typeof pooledByWindow>["normal"], h: number) => arr.find((x) => x.horizon === h)!;
    assert.deepEqual([get(s.event, 12).n, get(s.event, 12).inside], [2, 1]);
    assert.deepEqual([get(s.normal, 12).n, get(s.normal, 12).inside], [2, 2]); // the voided row is excluded
    assert.deepEqual([get(s.event, 24).n, get(s.event, 24).inside], [2, 1]); // the null (voided) 24h of the third row is excluded
    assert.deepEqual([get(s.normal, 24).n, get(s.normal, 24).inside], [2, 1]);
  });

  await test("settle: not due yet -> nothing; due -> inside/outside by |close - price| <= band, with the price recorded", () => {
    const close = (v: number | null) => () => v;
    assert.deepEqual(settle(stored(), at(T0 + 11 * H), close(4151)), []);
    assert.deepEqual(settle(stored(), at(T0 + 12 * H + 6 * 60_000), close(4165)), [{ horizon: 12, inside: true, priceLater: 4165 }]);
    assert.deepEqual(settle(stored(), at(T0 + 12 * H + 6 * 60_000), close(4175)), [{ horizon: 12, inside: false, priceLater: 4175 }]);
    assert.deepEqual(settle(stored(), at(T0 + 12 * H + 6 * 60_000), close(4130)), [{ horizon: 12, inside: true, priceLater: 4130 }]); // -20 is on the edge: inside
    const both = settle(stored(), at(T0 + 24 * H + 6 * 60_000), (h) => (h === 12 ? 4160 : 4190));
    assert.deepEqual(both.map((s) => [s.horizon, s.inside]), [[12, true], [24, false]]);
  });

  await test("settle: a missing outcome candle waits, then voids after 6h - never counted as inside; settled horizons are not redone", () => {
    assert.deepEqual(settle(stored(), at(T0 + 12 * H + 30 * 60_000), () => null), []);
    assert.deepEqual(settle(stored(), at(T0 + 19 * H), () => null).map((s) => [s.horizon, s.inside]), [[12, null]]);
    assert.deepEqual(settle(stored({ settled12: true }), at(T0 + 13 * H), () => 4150), []);
  });

  await test("wilson: wide for small samples, tight for large, bounded 0..1", () => {
    const small = wilson(8, 10);
    const big = wilson(800, 1000);
    assert.ok(small.hi - small.lo > 0.3);
    assert.ok(big.hi - big.lo < 0.06);
    assert.ok(big.lo < 0.8 && big.hi > 0.8);
    assert.deepEqual(wilson(0, 0), { lo: 0, hi: 1 });
    assert.ok(wilson(10, 10).hi <= 1 && wilson(0, 10).lo >= 0);
  });

  await test("summarise: voided rows excluded; <30 = collecting; verdict from the interval; pooled across symbols", () => {
    const mk = (symbol: string, n: number, insideN: number) => Array.from({ length: n }, (_, i) => ({ symbol, inside12: i < insideN, inside24: null as boolean | null }));
    const rows = [...mk("XAUUSD", 20, 16), ...mk("BTCUSD", 400, 320), ...mk("EURUSD", 400, 200), ...mk("ETHUSD", 400, 380), { symbol: "XAUUSD", inside12: null, inside24: null }];
    const s = summarise(rows, ["XAUUSD", "BTCUSD", "EURUSD", "ETHUSD", "GBPUSD"]);
    const get = (sym: string, h: number) => s.find((r) => r.symbol === sym && r.horizon === h)!;
    assert.equal(get("XAUUSD", 12).n, 20);
    assert.equal(get("XAUUSD", 12).status, "collecting");
    assert.ok(20 < MIN_SAMPLE);
    assert.equal(get("BTCUSD", 12).status, "on-target");
    assert.equal(get("EURUSD", 12).status, "below");
    assert.equal(get("ETHUSD", 12).status, "above");
    assert.equal(get("GBPUSD", 12).n, 0);
    assert.equal(get("GBPUSD", 12).rate, null);
    assert.equal(get("BTCUSD", 24).n, 0); // 24h not settled yet
    const p = pooled(rows).find((r) => r.horizon === 12)!;
    assert.equal(p.n, 1220);
    assert.equal(p.inside, 16 + 320 + 200 + 380);
  });

  // ── runner ──
  function harness(opts: { analysis?: ReturnType<typeof analysis> | null; hourly?: Array<{ openMs: number; close: number }> } = {}) {
    const rows = new Map<string, StoredForecast & { inside12?: boolean | null; inside24?: boolean | null }>();
    const saved: Array<{ id: string; s: Settlement }> = [];
    const deps: CalibrationDeps = {
      symbols: ["XAUUSD"],
      getAnalysis: async () => (opts.analysis === undefined ? analysis() : opts.analysis),
      insertForecast: async (f: NewForecast) => {
        const key = `${f.symbol}|${f.issuedAt.getTime()}`;
        if (rows.has(key)) return false;
        rows.set(key, { id: key, symbol: f.symbol, issuedAt: f.issuedAt, price: f.price, band12: f.band12, band24: f.band24, settled12: false, settled24: false });
        return true;
      },
      listUnsettled: async () => [...rows.values()].filter((r) => !r.settled12 || !r.settled24),
      getHourly: async () => opts.hourly ?? [],
      saveSettlement: async (id, s) => {
        saved.push({ id, s });
        const r = rows.get(id)!;
        if (s.horizon === 12) r.settled12 = true;
        else r.settled24 = true;
      },
    };
    return { rows, saved, deps };
  }

  await test("runner: one forecast per symbol per slot - a re-run in the same slot is a duplicate, the next slot issues again", async () => {
    const h = harness();
    const r1 = await runCalibrationWith(h.deps, at(T0 + 7 * 60_000));
    assert.deepEqual([r1.issued, r1.duplicates], [1, 0]);
    const r2 = await runCalibrationWith(h.deps, at(T0 + 30 * 60_000));
    assert.deepEqual([r2.issued, r2.duplicates], [0, 1]);
    assert.equal(h.rows.size, 1);
    const next = await runCalibrationWith({ ...h.deps, getAnalysis: async () => analysis({ lastClosedTime: new Date(T0 + 4 * H + 7 * 60_000 - H).toISOString() }) }, at(T0 + 4 * H + 7 * 60_000));
    assert.equal(next.issued, 1);
    assert.equal(h.rows.size, 2);
  });

  await test("runner: no data / closed market issues nothing and counts noData", async () => {
    const h = harness({ analysis: null });
    const r = await runCalibrationWith({ ...h.deps, retryDelayMs: 0 }, at(T0 + 7 * 60_000));
    assert.equal(r.issued, 0);
    assert.equal(r.noData, 1);
  });

  await test("runner: a transient failure is retried once with fresh data; a persistent one is not retried again", async () => {
    const calls: Array<boolean | undefined> = [];
    const h = harness();
    const flaky: CalibrationDeps = { ...h.deps, retryDelayMs: 0, getAnalysis: async (_s, fresh) => (calls.push(fresh), fresh ? analysis() : null) };
    const r = await runCalibrationWith(flaky, at(T0 + 7 * 60_000));
    assert.deepEqual(calls, [undefined, true]);
    assert.equal(r.issued, 1);
    const dead: CalibrationDeps = { ...h.deps, retryDelayMs: 0, getAnalysis: async (_s, fresh) => (calls.push(fresh), null) };
    calls.length = 0;
    const r2 = await runCalibrationWith(dead, at(T0 + 4 * H + 7 * 60_000));
    assert.deepEqual(calls, [undefined, true]);
    assert.equal(r2.noData, 1);
  });

  await test("runner: settles from the hourly candle that ENDS at the horizon (opens one hour earlier); voids when it never appears", async () => {
    const issued = harness();
    await runCalibrationWith(issued.deps, at(T0 + 7 * 60_000)); // forecast: price 4150, band12 ~18.7
    const hourly = [{ openMs: T0 + 11 * H, close: 4160 }, { openMs: T0 + 12 * H, close: 9999 }];
    const later = { ...issued.deps, getAnalysis: async () => null, getHourly: async () => hourly };
    const r = await runCalibrationWith(later, at(T0 + 12 * H + 7 * 60_000));
    assert.equal(r.settled, 1);
    assert.deepEqual(issued.saved.map((x) => [x.s.horizon, x.s.inside, x.s.priceLater]), [[12, true, 4160]]);

    const gap = harness();
    await runCalibrationWith(gap.deps, at(T0 + 7 * 60_000));
    const r2 = await runCalibrationWith({ ...gap.deps, getAnalysis: async () => null, getHourly: async () => [] }, at(T0 + 19 * H));
    assert.equal(r2.voided, 1);
    assert.equal(gap.saved[0].s.inside, null);
  });

  await test("runner: a failing symbol does not stop the others", async () => {
    const h = harness();
    const deps: CalibrationDeps = { ...h.deps, symbols: ["XAUUSD", "BAD"], getAnalysis: async (s) => { if (s === "BAD") throw new Error("boom"); return analysis(); } };
    const r = await runCalibrationWith(deps, at(T0 + 7 * 60_000));
    assert.equal(r.issued, 1);
    assert.equal(r.noData, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
main();
