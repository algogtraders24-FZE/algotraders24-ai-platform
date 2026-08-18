// scripts/validate-workspace-header-symbol-switch.ts
// Sprint D2.8.16 - regression coverage for a real, live-reproduced bug on
// production: switching the active symbol (e.g. EURUSD -> BTCUSD) reset
// WorkspaceHeader's loading `state` but never cleared its `snapshot`
// object, so the PREVIOUS symbol's price/provider/timestamp stayed
// rendered under the NEW symbol's title until (if ever) the new fetch
// resolved - "BTCUSD" was shown with EURUSD's stale $1.15744 "price".
// Source-inspection style, matching this codebase's own convention (no
// component test framework - see D2.6.11/D2.6.12's own structural checks).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const source = readFileSync(join(__dirname, "..", "components/workspace/WorkspaceHeader.tsx"), "utf8");

function regressionTests(): void {
  test("1: the symbol-change effect clears snapshot to null, never lets a previous symbol's data render under the new symbol's title", () => {
    const effectBody = source.slice(source.indexOf("useEffect(() => {"), source.indexOf("}, [symbol]);"));
    assert.match(effectBody, /setSnapshot\(null\)/);
  });

  test("2: setSnapshot(null) runs BEFORE the fetch call, not after (a call issued after the fetch would still race a fast response)", () => {
    const effectBody = source.slice(source.indexOf("useEffect(() => {"), source.indexOf("}, [symbol]);"));
    const clearIndex = effectBody.indexOf("setSnapshot(null)");
    const fetchIndex = effectBody.indexOf("fetch(");
    assert.ok(clearIndex !== -1 && fetchIndex !== -1 && clearIndex < fetchIndex, "setSnapshot(null) must precede the fetch call");
  });

  test("3: the effect is still keyed on [symbol] - the fix doesn't accidentally widen or narrow when a refetch happens", () => {
    assert.match(source, /\}, \[symbol\]\);/);
  });
}

async function main(): Promise<void> {
  regressionTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
