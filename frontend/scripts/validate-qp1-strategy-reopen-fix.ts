// scripts/validate-qp1-strategy-reopen-fix.ts
// QP-1 - Strategy Reopen Fix (docs/architecture/QUANT_PRO_MASTER_ARCHITECTURE_LOCK.md,
// §11/§12). Proves the real root cause and its fix using the exact two
// established conventions every prior client-side sprint in this program
// has used (no test framework exists in this repo, per package.json):
//
//   1. Real behavioral tests for the exported pure function
//      computeRegistrySymbolBlocked() (exported from AlgoTestPanel.tsx for
//      exactly this reason - this repo has no DOM renderer for a
//      validator to drive the component directly, matching
//      selectOptimizableStrategyId()'s own precedent from P4.11).
//   2. Structural source verification for the parts that are genuinely
//      React-hook/JSX-only and cannot be exercised without a renderer -
//      the same technique validate-algo-test-optimization-api.ts and
//      validate-p4.11-algo-testing-navigation.ts already established.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log("\n=== A - computeRegistrySymbolBlocked (real behavior - the actual root cause and its fix) ===");

  const { computeRegistrySymbolBlocked } = await import("../components/chart-engine/AlgoTestPanel");

  await test("THE BUG, reproduced directly: registry mode + mismatched pane symbol + NO run yet -> correctly blocked (this part was always correct - the setup-form gate)", () => {
    assert.equal(computeRegistrySymbolBlocked("registry", "XAUUSD", "BTCUSD", undefined), true);
  });

  await test("THE FIX, proven directly: registry mode + mismatched pane symbol + a run ALREADY exists (reopen, or a fresh submission the user then navigated away from and back to) -> NOT blocked - this is the exact production defect (a real completed run, XAUUSD, reopened while the active pane defaulted to BTCUSD, rendered nothing)", () => {
    const reopenedRun = { testId: "cmtk8n45m000104kz1461rd01", status: "completed", strategyId: "golden", symbol: "XAUUSD" };
    assert.equal(computeRegistrySymbolBlocked("registry", "XAUUSD", "BTCUSD", reopenedRun), false);
  });

  await test("matching symbol, no run -> not blocked (the ordinary, always-worked setup case)", () => {
    assert.equal(computeRegistrySymbolBlocked("registry", "XAUUSD", "XAUUSD", undefined), false);
  });

  await test("matching symbol, run exists -> not blocked (never was broken, still not blocked)", () => {
    assert.equal(computeRegistrySymbolBlocked("registry", "XAUUSD", "XAUUSD", { testId: "x" }), false);
  });

  await test("AI mode is never blocked by this gate, run or no run, matching the existing locked comment (AI mode has no pre-known symbol)", () => {
    assert.equal(computeRegistrySymbolBlocked("ai", "XAUUSD", "BTCUSD", undefined), false);
    assert.equal(computeRegistrySymbolBlocked("ai", "XAUUSD", "BTCUSD", { testId: "x" }), false);
  });

  await test("a strategy with no declared supported-symbol match (registrySupportedSymbol undefined, e.g. still loading) is never blocked", () => {
    assert.equal(computeRegistrySymbolBlocked("registry", undefined, "BTCUSD", undefined), false);
  });

  await test("a falsy-but-present run (e.g. an empty object, never actually possible from real state, but the gate's own `!run` check must be a plain existence check, not a truthiness assumption about the run's own fields) still counts as 'a run exists'", () => {
    assert.equal(computeRegistrySymbolBlocked("registry", "XAUUSD", "BTCUSD", {}), false);
  });

  console.log("\n=== B - AlgoTestPanel.tsx structural checks (the fix is wired correctly, nothing else changed) ===");

  const url = new URL("../components/chart-engine/AlgoTestPanel.tsx", import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) throw new Error("AlgoTestPanel.tsx does not exist");
  const PANEL = readFileSync(path, "utf8");

  await test("the render-time early-return gate calls the exported, testable function - never a re-inlined condition", () => {
    assert.ok(/const registrySymbolBlocked = computeRegistrySymbolBlocked\(mode, registrySupportedSymbol, symbol, run\);/.test(PANEL));
  });

  await test("computeRegistrySymbolBlocked is exported and its own logic includes the !run check proven above - never modified back to the pre-fix shape by accident", () => {
    assert.ok(/export function computeRegistrySymbolBlocked/.test(PANEL));
    const fnBody = PANEL.slice(PANEL.indexOf("export function computeRegistrySymbolBlocked"));
    const bodyEnd = fnBody.indexOf("\n}");
    const body = fnBody.slice(0, bodyEnd);
    assert.ok(/&&\s*!run/.test(body), "the fix's own !run exclusion must be present in the function body");
  });

  await test("the reopen effect itself (mount-time fetchAlgoTestRun via ?algoTestId=) is unmodified by this fix - QP-1 changed only the RENDER gate, never the fetch/state path, matching the diagnosed root cause exactly", () => {
    assert.ok(PANEL.includes("REOPEN_QUERY_PARAM"));
    assert.ok(PANEL.includes("fetchAlgoTestRun(testId)"));
    // The reopen effect's own setRun/setReopening calls are untouched -
    // structurally verified by their continued presence, not a byte-diff
    // (this validator has no access to the pre-fix file to diff against).
    assert.ok(/setRun\(fetched\)/.test(PANEL));
  });

  await test("the P4.11 'Next steps' CTA gating and its own optimizableStrategyId logic are untouched by this fix (QP-1 does not touch P4.11)", () => {
    assert.ok(/export function selectOptimizableStrategyId/.test(PANEL));
    assert.ok(/optimizableStrategyId: string \| undefined/.test(PANEL));
    assert.ok(/\{optimizableStrategyId && \(/.test(PANEL));
  });

  await test("the downstream symbol-mismatch handling this fix now allows the render to reach is itself unmodified (AlgoTestResults' own overlaidOnThisChart notice, not a new one invented for this fix)", () => {
    assert.ok(/overlaidOnThisChart/.test(PANEL));
    assert.ok(PANEL.replace(/\s+/g, " ").includes("results are shown below but not overlaid on this chart"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
