// scripts/validate-qp3-strategy-chart-preview.ts
// QP-3 - Strategy + Chart Preview. Same two established conventions every
// prior sprint in this program uses (no test framework exists here, per
// package.json):
//   1. Real behavioral tests, including a fake HistoricalDataProvider
//      injected directly at the service boundary - the SAME
//      dependency-injection convention algoTestService.
//      compileAndRunAiStrategy()'s own `deps?: { historicalDataProvider }`
//      already establishes, never a real network call.
//   2. Structural source verification for the locked architectural
//      boundaries that can't be behaviorally observed from outside (e.g.
//      "StrategyChartPreview never references WorkspaceContext",
//      "NativeChart/ChartPanel/ChartPane were never made to depend on
//      anything QP-3 added").
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adaptStrategyIndicatorSeries, activePanelsForIndicatorSeries } from "../lib/chart-engine/strategy-indicator-adapter";
import { buildQuantChatPreview } from "../services/algo-test/quant-chat-preview.service";
import type { HistoricalDataProvider, HistoricalBarsResult } from "../services/algo-test/historical-data/types";
import type { CompileNaturalLanguageStrategyResult } from "../services/algo-test/nl-strategy-compiler.service";
import type { ChartCandle } from "../types/chart-data";
import type { StrategySpec, OHLCVBar } from "at24-quant-engine";

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

function candle(time: number, close: number): ChartCandle {
  return { time, open: close, high: close, low: close, close, volume: 100 };
}

const CANDLES: ChartCandle[] = [candle(0, 2000), candle(900_000, 2001), candle(1_800_000, 2002), candle(2_700_000, 2003)];

async function main(): Promise<void> {
  console.log("\n=== A - adaptStrategyIndicatorSeries (pure shape adapter) ===");

  await test("Case 1: one indicator, values aligned to candle timestamps - correct point count, timestamps, values, and identity", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([["EMA(20)", [10, 11, 12, 13]]]);
    const result = adaptStrategyIndicatorSeries(values, { candles: CANDLES });
    assert.equal(result.length, 1);
    const series = result[0]!;
    assert.equal(series.config.id, "ema");
    assert.equal(series.config.period, 20);
    assert.equal(series.panel, "price");
    assert.equal(series.lines.length, 1);
    assert.equal(series.lines[0]!.points.length, 4);
    assert.deepEqual(
      series.lines[0]!.points.map((p) => p.time),
      CANDLES.map((c) => c.time),
    );
    assert.deepEqual(
      series.lines[0]!.points.map((p) => p.value),
      [10, 11, 12, 13],
    );
  });

  await test("Case 2: multiple indicators (including a sub-panel one) remain separate - no cross-contamination, each correctly aligned", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([
      ["EMA(9)", [1, 2, 3, 4]],
      ["EMA(21)", [5, 6, 7, 8]],
      ["RSI(14)", [40, 41, 42, 43]],
    ]);
    const result = adaptStrategyIndicatorSeries(values, { candles: CANDLES });
    assert.equal(result.length, 3);
    const ema9 = result.find((s) => s.config.key === "EMA(9)")!;
    const ema21 = result.find((s) => s.config.key === "EMA(21)")!;
    const rsi = result.find((s) => s.config.key === "RSI(14)")!;
    assert.deepEqual(
      ema9.lines[0]!.points.map((p) => p.value),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      ema21.lines[0]!.points.map((p) => p.value),
      [5, 6, 7, 8],
    );
    assert.equal(ema9.panel, "price");
    assert.equal(ema21.panel, "price");
    assert.equal(rsi.panel, "rsi");
    assert.notEqual(ema9.config.color, ema21.config.color);
  });

  await test("Case 3: empty/missing indicator data is safe - no fabricated values, no crash, and the 'PRICE' pseudo-indicator is correctly skipped (never a real overlay - candles already show price)", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([
      ["PRICE", [2000, 2001, 2002, 2003]],
      ["ATR(14)", []],
    ]);
    const result = adaptStrategyIndicatorSeries(values, { candles: CANDLES });
    assert.equal(result.length, 1); // PRICE skipped
    assert.equal(result[0]!.config.key, "ATR(14)");
    assert.equal(result[0]!.lines[0]!.points.length, 0);
    assert.equal(adaptStrategyIndicatorSeries(new Map(), { candles: CANDLES }).length, 0);
    assert.doesNotThrow(() => adaptStrategyIndicatorSeries(new Map([["EMA(20)", []]]), { candles: [] }));
  });

  await test("Case 4: indicator values shorter than candles - pairs only up to the shorter length, never fabricates a timestamp for the unpaired tail", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([["EMA(20)", [10, 11]]]); // shorter than CANDLES (4)
    const result = adaptStrategyIndicatorSeries(values, { candles: CANDLES });
    assert.equal(result[0]!.lines[0]!.points.length, 2);
    assert.deepEqual(
      result[0]!.lines[0]!.points.map((p) => p.time),
      [CANDLES[0]!.time, CANDLES[1]!.time],
    );
  });

  await test("Case 4b: indicator values longer than candles - pairs only up to the shorter length, never fabricates a candle for the unpaired tail", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([["EMA(20)", [10, 11, 12, 13, 14, 15]]]); // longer than CANDLES (4)
    const result = adaptStrategyIndicatorSeries(values, { candles: CANDLES });
    assert.equal(result[0]!.lines[0]!.points.length, 4);
  });

  await test("a genuinely undefined value at some index is preserved as undefined, never a fabricated 0/interpolation", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([["RSI(14)", [undefined, 40, undefined, 43]]]);
    const result = adaptStrategyIndicatorSeries(values, { candles: CANDLES });
    assert.deepEqual(
      result[0]!.lines[0]!.points.map((p) => p.value),
      [undefined, 40, undefined, 43],
    );
  });

  await test("activePanelsForIndicatorSeries never includes 'price' (always implicit) and de-duplicates repeated sub-panels", () => {
    const values = new Map<string, (number | boolean | undefined)[]>([
      ["EMA(9)", [1, 2]],
      ["RSI(14)", [1, 2]],
      ["ATR(14)", [1, 2]],
    ]);
    const series = adaptStrategyIndicatorSeries(values, { candles: CANDLES.slice(0, 2) });
    const panels = activePanelsForIndicatorSeries(series);
    assert.ok(!panels.includes("price"));
    assert.deepEqual([...panels].sort(), ["atr", "rsi"]);
  });

  console.log("\n=== B - buildQuantChatPreview (real behavior, fake HistoricalDataProvider) ===");

  const SPEC: StrategySpec = {
    identity: { strategyId: "s1", name: "Gold EMA Crossover" },
    version: "1.0.0",
    metadata: { createdAt: 0 },
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    parameters: [],
    entryRules: [],
    exitRules: [],
    risk: { sizing: { method: "percent-equity-risk", percent: 1 } },
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };

  function fakeBars(count: number): OHLCVBar[] {
    return Array.from({ length: count }, (_, i) => ({ timestamp: i * 900_000, instrument: { symbol: "XAUUSD" }, timeframe: "M15" as const, open: 2000, high: 2001, low: 1999, close: 2000 + i, volume: 10 }));
  }

  function fakeProvider(result: HistoricalBarsResult | (() => never)): HistoricalDataProvider {
    return {
      id: "fake",
      async getBars() {
        if (typeof result === "function") return result();
        return result;
      },
    };
  }

  function fakeRun(overrides: Partial<CompileNaturalLanguageStrategyResult> = {}): CompileNaturalLanguageStrategyResult {
    return {
      stages: [],
      reachedStage: "EXECUTION_VALID",
      compiledSpec: SPEC,
      buildIndicatorSeries: (bars) => new Map([["EMA(20)", bars.map((b) => b.close)]]),
      rawResponse: "{}",
      ...overrides,
    };
  }

  await test("a successful compile with real bars produces candles + adapted indicator series, using the SAME bars for both", async () => {
    const bars = fakeBars(5);
    const preview = await buildQuantChatPreview(fakeRun(), { historicalDataProvider: fakeProvider({ bars, rejected: [], source: "fake" }) });
    assert.ok(preview);
    assert.equal(preview!.symbol, "XAUUSD");
    assert.equal(preview!.timeframe, "15m");
    assert.equal(preview!.candles.length, 5);
    assert.equal(preview!.indicatorSeries.length, 1);
    assert.equal(preview!.indicatorSeries[0]!.lines[0]!.points.length, 5);
    assert.deepEqual(
      preview!.indicatorSeries[0]!.lines[0]!.points.map((p) => p.value),
      bars.map((b) => b.close),
    );
  });

  await test("a provider failure (network/API error) returns undefined, never throws - a compile turn's own success must never be blocked by this", async () => {
    const preview = await buildQuantChatPreview(fakeRun(), {
      historicalDataProvider: fakeProvider(() => {
        throw new Error("simulated provider failure");
      }),
    });
    assert.equal(preview, undefined);
  });

  await test("zero real bars returned -> undefined, never a fabricated empty chart", async () => {
    const preview = await buildQuantChatPreview(fakeRun(), { historicalDataProvider: fakeProvider({ bars: [], rejected: [], source: "fake" }) });
    assert.equal(preview, undefined);
  });

  await test("a failed compile (no compiledSpec) -> undefined immediately, the provider is never even called", async () => {
    let called = false;
    const provider = fakeProvider({ bars: fakeBars(3), rejected: [], source: "fake" });
    const wrapped: HistoricalDataProvider = { id: "fake", async getBars(req) { called = true; return provider.getBars(req); } };
    const preview = await buildQuantChatPreview(fakeRun({ compiledSpec: undefined }), { historicalDataProvider: wrapped });
    assert.equal(preview, undefined);
    assert.equal(called, false);
  });

  console.log("\n=== C - structural checks (locked QP-3 boundaries actually hold in the real source) ===");

  function readSource(relativePath: string): string {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    if (!existsSync(path)) throw new Error(`${relativePath} does not exist`);
    return readFileSync(path, "utf8");
  }

  function stripLineComments(src: string): string {
    return src.replace(/\/\/.*$/gm, "");
  }

  await test("StrategyChartPreview never references WorkspaceContext/useWorkspace/AlgoTestPanel/PaperTradingPanel", () => {
    const src = stripLineComments(readSource("../components/quant-chat/StrategyChartPreview.tsx"));
    assert.ok(!src.includes("useWorkspace"));
    assert.ok(!src.includes("WorkspaceContext"));
    assert.ok(!src.includes("AlgoTestPanel"));
    assert.ok(!src.includes("PaperTradingPanel"));
  });

  await test("NativeChart.tsx/ChartPanel.tsx/ChartPane.tsx/WorkspaceContext were never made to depend on anything QP-3 added", () => {
    for (const f of ["../components/chart-engine/NativeChart.tsx", "../components/chart-engine/ChartPanel.tsx", "../components/chart-engine/ChartPane.tsx", "../context/WorkspaceContext.tsx"]) {
      const src = readSource(f);
      assert.ok(!src.includes("StrategyChartPreview"), `${f} must not reference StrategyChartPreview`);
      assert.ok(!src.includes("quant-chat-preview"), `${f} must not reference quant-chat-preview.service`);
      assert.ok(!src.includes("strategy-indicator-adapter"), `${f} must not reference the QP-3 adapter`);
    }
  });

  await test("QP-2's own quant-strategy-builder.service.ts is untouched by QP-3 - it references nothing from the new chart-preview domain", () => {
    const src = readSource("../services/algo-test/quant-strategy-builder.service.ts");
    assert.ok(!src.includes("quant-chat-preview"));
    assert.ok(!src.includes("StrategyChartPreview"));
    assert.ok(!src.includes("HistoricalDataProvider"));
  });

  await test("the strategy-builder route attaches the best-effort preview without duplicating compiler logic", () => {
    const src = stripLineComments(readSource("../app/api/private/algo-test/strategy-builder/route.ts"));
    assert.ok(src.includes("buildQuantChatPreview"));
    assert.ok(src.includes("applyModification"));
    assert.ok(!src.includes("compileAndRunAiStrategy"));
  });

  await test("no new market-data API route was introduced - only the existing algo-test strategy-builder route was touched", () => {
    const marketDataDir = fileURLToPath(new URL("../app/api/private/market-data", import.meta.url));
    // A structural sanity check, not an exhaustive directory diff: the
    // specific files this sprint could plausibly have added a route under
    // must not exist.
    for (const candidate of ["quant-chat", "strategy-preview", "chart-preview"]) {
      assert.ok(!existsSync(`${marketDataDir}/${candidate}`), `unexpected new market-data route: ${candidate}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
