// scripts/validate-mt5-symbol-groups.ts - the admin MT5 symbols diagnostic's grouping. Pure.
import assert from "node:assert/strict";
import { groupMt5Symbols } from "../services/market-data/mt5-symbol-groups";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const SAMPLE = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "USDX", "US500", "USTEC", "US30", "XTIUSD", "XBRUSD", "VIX", "AUDCAD", "EURGBP", "XAUUSDm", "EURUSD.a"];

test("indices, dollar index, oil and volatility are sorted into their groups", () => {
  const r = groupMt5Symbols(SAMPLE);
  assert.equal(r.count, SAMPLE.length);
  assert.deepEqual(r.groups.dollarIndex, ["USDX"]);
  assert.deepEqual(r.groups.stockIndices, ["US30", "US500", "USTEC"]);
  assert.deepEqual(r.groups.oil, ["XBRUSD", "XTIUSD"]);
  assert.deepEqual(r.groups.volatility, ["VIX"]);
  assert.deepEqual(r.groups.yields, []);
});

test("already-mapped instruments are recognised, including account suffixes", () => {
  const r = groupMt5Symbols(SAMPLE);
  for (const s of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "XAUUSDm", "EURUSD.a"]) assert.ok(r.groups.alreadyMapped.includes(s), s);
  assert.ok(!r.groups.alreadyMapped.includes("AUDCAD"));
});

test("unrelated symbols match no group; an empty list is fine", () => {
  const r = groupMt5Symbols(["AUDCAD", "EURGBP"]);
  assert.ok(Object.values(r.groups).every((g) => g.length === 0));
  assert.equal(groupMt5Symbols([]).count, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
