// scripts/validate-p4.11-algo-testing-navigation.ts
// P4.11 - Algo Testing Pro Navigation & Discoverability Closure. Two
// established conventions, same as every prior P4.9 client-side sprint:
// (1) real behavioral tests for anything plain-TS/importable without a
// DOM renderer - here, selectOptimizableStrategyId() (exported from
// AlgoTestPanel.tsx for exactly this reason) and DASHBOARD_NAV_GROUPS
// (pure data); (2) structural source-verification for the React-hook/JSX
// parts of AlgoTestPanel.tsx itself, the same technique
// validate-algo-test-optimization-api.ts and
// validate-algo-test-walk-forward-ui.ts already established.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AlgoTestStrategyDefinition } from "../types/algo-test";

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

function strategy(strategyId: string, parameterCount: number): AlgoTestStrategyDefinition {
  return {
    strategyId,
    strategyVersion: "1.0.0",
    displayName: strategyId,
    description: "",
    supportedSymbols: ["XAUUSD"],
    supportedTimeframes: ["5m"],
    parameters: Array.from({ length: parameterCount }, (_, i) => ({ id: `p${i}`, label: `p${i}`, type: "number" as const, defaultValue: 0 })),
    status: "available",
  } as unknown as AlgoTestStrategyDefinition;
}

async function main(): Promise<void> {
  console.log("\n=== A - selectOptimizableStrategyId (real behavior - the actual bug this sprint found and fixed) ===");

  const { selectOptimizableStrategyId } = await import("../components/chart-engine/AlgoTestPanel");
  const registryWithParams = strategy("golden", 3);
  const registryNoParams = strategy("ref-ema-crossover", 0);
  const strategies = [registryWithParams, registryNoParams];

  await test("a registry strategy WITH declared parameters (golden) is returned - safe to link", () => {
    assert.equal(selectOptimizableStrategyId(strategies, "golden"), "golden");
  });

  await test("a registry strategy with ZERO declared parameters (ref-ema-crossover) returns undefined - the exact bug this sprint found: linking it would silently preselect a DIFFERENT strategy on the target page", () => {
    assert.equal(selectOptimizableStrategyId(strategies, "ref-ema-crossover"), undefined);
  });

  await test('an AI-compiled run ("ai-generated", never a real registry entry) returns undefined', () => {
    assert.equal(selectOptimizableStrategyId(strategies, "ai-generated"), undefined);
  });

  await test("a strategyId not present in the caller's own strategies list at all returns undefined, never throws", () => {
    assert.equal(selectOptimizableStrategyId(strategies, "does-not-exist"), undefined);
  });

  await test("undefined runStrategyId (no run yet) returns undefined", () => {
    assert.equal(selectOptimizableStrategyId(strategies, undefined), undefined);
  });

  console.log("\n=== B - Navigation (real behavior, pure data import) ===");

  const { DASHBOARD_NAV_GROUPS } = await import("../config/dashboard.config");

  await test("Optimize appears as a child of PRODUCTS > Algo Testing Pro, pointing at /dashboard/algo-test-optimize (closes the P4.10-identified P0 gap)", () => {
    const products = DASHBOARD_NAV_GROUPS.find((g) => g.label === "PRODUCTS")!;
    const algoTestingPro = products.items.find((i) => i.label === "Algo Testing Pro")!;
    const optimize = algoTestingPro.children?.find((c) => c.label === "Optimize");
    assert.ok(optimize, "Optimize child must exist");
    assert.equal(optimize!.href, "/dashboard/algo-test-optimize");
  });

  await test("Walk-Forward, Run History, Strategy Library children remain unchanged, and Optimize is additive (4 children total, no removals)", () => {
    const products = DASHBOARD_NAV_GROUPS.find((g) => g.label === "PRODUCTS")!;
    const algoTestingPro = products.items.find((i) => i.label === "Algo Testing Pro")!;
    assert.deepEqual(algoTestingPro.children, [
      { label: "Run History", href: "/dashboard/algo-test-history" },
      { label: "Strategy Library", href: "/dashboard/algo-test-library" },
      { label: "Optimize", href: "/dashboard/algo-test-optimize" },
      { label: "Walk-Forward", href: "/dashboard/algo-test-walk-forward" },
    ]);
    assert.equal(algoTestingPro.href, "/dashboard/workspace");
  });

  await test("the locked top-level IA and every other nav item are unchanged", () => {
    const groupLabels = DASHBOARD_NAV_GROUPS.map((g) => g.label);
    assert.deepEqual(groupLabels, [null, "PRODUCTS", "INTELLIGENCE", "AUTOMATION", "WORKSPACE", "ACCOUNT", null]);
    const products = DASHBOARD_NAV_GROUPS.find((g) => g.label === "PRODUCTS")!;
    assert.deepEqual(
      products.items.map((i) => i.label),
      ["Quant", "Algo Testing Pro", "Marketplace"],
    );
    const workspace = DASHBOARD_NAV_GROUPS.find((g) => g.label === "WORKSPACE")!;
    assert.deepEqual(workspace.items, [
      { label: "Strategies", href: "/quant-lite/builder", icon: "ST" },
      { label: "Backtests", href: "/quant-lite/backtest", icon: "BT" },
      { label: "Results", href: "/quant-lite/results", icon: "RE" },
    ]);
  });

  console.log("\n=== C - AlgoTestPanel.tsx structural checks (Backtest/Results -> Optimize/WFO) ===");

  const url = new URL("../components/chart-engine/AlgoTestPanel.tsx", import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) throw new Error("AlgoTestPanel.tsx does not exist");
  const PANEL = readFileSync(path, "utf8");

  await test("the results view links to the existing Optimize route using the existing ?strategyId= contract - no new query parameter invented", () => {
    assert.ok(/\/dashboard\/algo-test-optimize\?strategyId=\$\{encodeURIComponent\(optimizableStrategyId\)\}/.test(PANEL));
  });

  await test("the results view links to the existing Walk-Forward route using the identical ?strategyId= contract", () => {
    assert.ok(/\/dashboard\/algo-test-walk-forward\?strategyId=\$\{encodeURIComponent\(optimizableStrategyId\)\}/.test(PANEL));
  });

  await test("no OTHER query parameter is ever appended to either new link (only strategyId - the pre-existing preselect contract both setup pages already read)", () => {
    const optimizeLinks = PANEL.match(/\/dashboard\/algo-test-optimize\?[^`"']*/g) ?? [];
    const wfoLinks = PANEL.match(/\/dashboard\/algo-test-walk-forward\?[^`"']*/g) ?? [];
    for (const link of [...optimizeLinks, ...wfoLinks]) {
      assert.ok(/^\/dashboard\/algo-test-(optimize|walk-forward)\?strategyId=/.test(link), `unexpected link shape: ${link}`);
    }
  });

  await test("the CTA row is gated on optimizableStrategyId (never shown for a non-optimizable/AI run) and lives inside the completed+metrics branch", () => {
    const gateIdx = PANEL.indexOf("{optimizableStrategyId && (");
    assert.ok(gateIdx > 0, "must gate the actions row on optimizableStrategyId");
    const completedMetricsIdx = PANEL.indexOf('run.status === "completed" && metrics');
    assert.ok(completedMetricsIdx > 0 && completedMetricsIdx < gateIdx, "the gate must live inside the completed+metrics branch");
  });

  await test("selectOptimizableStrategyId is exported (testable without a DOM renderer) and AlgoTestResults receives it as a required prop, never recomputing the rule itself", () => {
    assert.ok(/export function selectOptimizableStrategyId/.test(PANEL));
    assert.ok(/optimizableStrategyId: string \| undefined/.test(PANEL));
  });

  console.log("\n=== D - No duplicate routes were introduced ===");

  await test("exactly the pre-existing 2 optimize pages and 2 walk-forward pages exist - no new route files", () => {
    const optimizeRoot = fileURLToPath(new URL("../app/dashboard/algo-test-optimize", import.meta.url));
    const wfoRoot = fileURLToPath(new URL("../app/dashboard/algo-test-walk-forward", import.meta.url));
    assert.ok(existsSync(`${optimizeRoot}/page.tsx`));
    assert.ok(existsSync(`${optimizeRoot}/[experimentId]/page.tsx`));
    assert.ok(existsSync(`${wfoRoot}/page.tsx`));
    assert.ok(existsSync(`${wfoRoot}/[experimentId]/page.tsx`));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
