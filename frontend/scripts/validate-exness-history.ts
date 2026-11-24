// scripts/validate-exness-history.ts - Algo Test history from the Exness API: window filtering, caching, the fallback and the refusal of long windows without Exness.
// Run: npx tsx scripts/validate-exness-history.ts
import assert from "node:assert/strict";
import type { HistoricalBarsRequest, HistoricalBarsResult } from "../services/algo-test/historical-data/types";
import { CompositeHistoricalDataProvider, ExnessHistoricalDataProvider, exnessMaxRangeDaysFor } from "../services/algo-test/historical-data/exness-provider";
import type { ExnessApiClient, ExnessCandle } from "../lib/market-data/exness-api";

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { failed++; console.error(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

const HOUR = 3_600_000;
const END = Date.parse("2026-11-20T00:00:00Z");
function hourly(n: number): ExnessCandle[] {
  const out: ExnessCandle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = END - i * HOUR;
    out.push({ datetime: new Date(t).toISOString(), open: 100, high: 101, low: 99, close: 100.5, volume: 1 });
  }
  return out;
}
function fakeClient(enabled: boolean, candles: ExnessCandle[], calls: { n: number; args: unknown[][] }): ExnessApiClient {
  return { isEnabled: () => enabled, getCandlesPaged: async (...args: unknown[]) => { calls.n++; calls.args.push(args); return candles; } } as unknown as ExnessApiClient;
}
const req = (days: number): HistoricalBarsRequest => ({ symbol: "XAUUSD", timeframe: "H1", startTime: new Date(END - days * 86_400_000).toISOString(), endTime: new Date(END).toISOString() });
const twelve = (bars: number): { id: string; getBars: (r: HistoricalBarsRequest) => Promise<HistoricalBarsResult>; calls: number } => {
  const o = { id: "twelve-data", calls: 0, async getBars() { o.calls++; return { bars: [], rejected: [], source: "twelve" } as HistoricalBarsResult; } };
  void bars;
  return o;
};

(async () => {
  await test("range caps: two years for H1 and slower, shorter for fast timeframes", () => {
    assert.equal(exnessMaxRangeDaysFor("H1"), 730);
    assert.equal(exnessMaxRangeDaysFor("H4"), 730);
    assert.equal(exnessMaxRangeDaysFor("M30"), 730);
    assert.equal(exnessMaxRangeDaysFor("M15"), 416);
    assert.equal(exnessMaxRangeDaysFor("M5"), 138);
    assert.equal(exnessMaxRangeDaysFor("M1"), 27);
  });
  await test("bars outside the window are dropped and the rest are valid, ordered bars named after the source", async () => {
    const calls = { n: 0, args: [] as unknown[][] };
    const p = new ExnessHistoricalDataProvider(fakeClient(true, hourly(24 * 10), calls));
    const r = await p.getBars(req(5));
    assert.ok(r.bars.length > 100 && r.bars.length <= 5 * 24 + 1, `bars ${r.bars.length}`);
    for (let i = 1; i < r.bars.length; i++) assert.ok(r.bars[i].timestamp > r.bars[i - 1].timestamp);
    assert.match(r.source, /^exness-api/);
    assert.equal(calls.args[0][1], "1h");
  });
  await test("the same window is served from the cache (one Exness call)", async () => {
    const calls = { n: 0, args: [] as unknown[][] };
    const p = new ExnessHistoricalDataProvider(fakeClient(true, hourly(24 * 10), calls));
    await p.getBars(req(5)); await p.getBars(req(5));
    assert.equal(calls.n, 1);
  });
  await test("a long window asks Exness for enough bars (2 years of H1 = 17,520 bars)", async () => {
    const calls = { n: 0, args: [] as unknown[][] };
    const p = new ExnessHistoricalDataProvider(fakeClient(true, hourly(100), calls));
    await p.getBars(req(730));
    assert.ok((calls.args[0][2] as number) >= 17_520 && (calls.args[0][2] as number) <= 40_000);
  });
  await test("composite uses Exness when it is enabled and never touches Twelve Data", async () => {
    const calls = { n: 0, args: [] as unknown[][] };
    const tw = twelve(0);
    const c = new CompositeHistoricalDataProvider(new ExnessHistoricalDataProvider(fakeClient(true, hourly(24 * 10), calls)), tw);
    const r = await c.getBars(req(5));
    assert.match(r.source, /exness/);
    assert.equal(tw.calls, 0);
  });
  await test("Exness off: a short window falls back to Twelve Data", async () => {
    const tw = twelve(0);
    const c = new CompositeHistoricalDataProvider(new ExnessHistoricalDataProvider(fakeClient(false, [], { n: 0, args: [] })), tw);
    await c.getBars(req(5));
    assert.equal(tw.calls, 1);
  });
  await test("Exness off: a long window is refused, never answered with a silently shortened series", async () => {
    const tw = twelve(0);
    const c = new CompositeHistoricalDataProvider(new ExnessHistoricalDataProvider(fakeClient(false, [], { n: 0, args: [] })), tw);
    await assert.rejects(() => c.getBars(req(400)), /not available right now/);
    assert.equal(tw.calls, 0);
  });
  await test("an unsupported instrument goes to the fallback (short window)", async () => {
    const tw = twelve(0);
    const c = new CompositeHistoricalDataProvider(new ExnessHistoricalDataProvider(fakeClient(true, hourly(10), { n: 0, args: [] })), tw);
    await c.getBars({ ...req(5), symbol: "ZZZUSD" });
    assert.equal(tw.calls, 1);
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
