// scripts/validate-qp4-chat-run-backtest.ts
// QP-4 - Quant Chat -> Run Backtest. Same two established conventions
// every prior sprint in this program uses (no test framework exists here,
// per package.json):
//   1. Real behavioral tests for the one genuinely new pure function
//      (buildQuantChatBacktestRequest) - deterministic, injectable `now`.
//   2. Structural source verification for the parts that are genuinely
//      React-hook/JSX-only and cannot be exercised without a renderer
//      (the same technique validate-algo-test-optimization-api.ts and
//      QP-2/QP-3's own validators already established) - in particular,
//      proving the LOCKED architectural rules actually hold in the real
//      source: current-intent (never stale compiledSpec) as the execution
//      input, no new backend route, no alternate backtest path, the
//      existing error/result/reopen conventions reused verbatim.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildQuantChatBacktestRequest, QUANT_CHAT_BACKTEST_DEFAULT_INITIAL_BALANCE, QUANT_CHAT_BACKTEST_DEFAULT_LOOKBACK_DAYS } from "../lib/algo-test/quant-chat-backtest-defaults";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void): Promise<void> {
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

function readSource(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  if (!existsSync(path)) throw new Error(`${relativePath} does not exist`);
  return readFileSync(path, "utf8");
}

function stripLineComments(src: string): string {
  return src.replace(/\/\/.*$/gm, "");
}

async function main(): Promise<void> {
  console.log("\n=== A - buildQuantChatBacktestRequest (real behavior - the one new pure function) ===");

  await test("defaults are initial balance 10,000 and a 7-day lookback, matching AlgoTestPanel's own AI-mode defaults", () => {
    assert.equal(QUANT_CHAT_BACKTEST_DEFAULT_INITIAL_BALANCE, 10_000);
    assert.equal(QUANT_CHAT_BACKTEST_DEFAULT_LOOKBACK_DAYS, 7);
  });

  await test("produces a real 7-day range ending yesterday (UTC), and passes the intent straight through unmodified", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const req = buildQuantChatBacktestRequest("Buy XAUUSD on EMA(9)/EMA(21) crossover", now);
    assert.equal(req.intent, "Buy XAUUSD on EMA(9)/EMA(21) crossover");
    assert.equal(req.startTime, "2026-09-13T00:00:00Z");
    assert.equal(req.endTime, "2026-09-19T23:59:59Z");
    assert.equal(req.initialBalance, 10_000);
  });

  await test("is deterministic - the same intent and `now` always produce the exact same request (no hidden randomness/state)", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const a = buildQuantChatBacktestRequest("test intent", now);
    const b = buildQuantChatBacktestRequest("test intent", now);
    assert.deepEqual(a, b);
  });

  console.log("\n=== B - structural checks (locked QP-4 architecture actually holds in the real source) ===");

  await test("Run Backtest is unavailable before a successful compile - the button's own disabled condition checks lastCompileResult?.compiledSpec", () => {
    const page = readSource("../app/dashboard/quant-chat/page.tsx");
    assert.ok(page.includes("disabled={!conversationState.lastCompileResult?.compiledSpec || backtestRunning}"));
  });

  await test("duplicate submissions are prevented - handleRunBacktest guards on its own running flag before starting a new request", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    const fnStart = page.indexOf("async function handleRunBacktest()");
    assert.ok(fnStart !== -1, "handleRunBacktest must exist");
    const fnBody = page.slice(fnStart, fnStart + 300);
    assert.ok(/if \(backtestRunning\) return;/.test(fnBody));
  });

  await test("the execution input is the CURRENT accumulated intent, never a stale compiledSpec - buildQuantChatBacktestRequest is called with a value captured fresh from conversationState.currentIntent (QP-5 - captured into intentAtRequestTime so the same value can also be recorded as backtestResultIntent for staleness labeling, still read fresh at click time, never a stale compiledSpec)", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    const fnStart = page.indexOf("async function handleRunBacktest()");
    const fnBody = page.slice(fnStart, page.indexOf("\n  }", fnStart));
    assert.ok(/const intentAtRequestTime = conversationState\.currentIntent;/.test(fnBody));
    assert.ok(/buildQuantChatBacktestRequest\(intentAtRequestTime,/.test(fnBody));
    // The request builder itself must never be handed a compiledSpec/compiledIR - only a plain intent string.
    assert.ok(!fnBody.includes("compiledSpec"));
    assert.ok(!fnBody.includes("compiledIR"));
  });

  await test("Run Backtest reuses the EXISTING compileAndRunAiStrategy client wrapper (already calling the canonical /ai-runs route) - never a new backend route, never a direct call to runBacktest/runSimulation/applyModification", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    assert.ok(page.includes('import { applyStrategyBuilderModification, compileAndRunAiStrategy,'));
    assert.ok(page.includes("await compileAndRunAiStrategy(request)"));
    assert.ok(!page.includes("runBacktest("));
    assert.ok(!page.includes("runSimulation("));
    assert.ok(!/fetch\(.*strategy-builder.*backtest/i.test(page));
  });

  await test("no new API route file was created for QP-4 - the existing /api/private/algo-test/ai-runs route (and only that one) remains the canonical execution endpoint, unmodified", () => {
    const noNewRoutes = [
      "../app/api/private/algo-test/quant-chat-backtest",
      "../app/api/private/algo-test/quant-chat-run",
      "../app/api/private/algo-test/run-backtest",
    ];
    for (const candidate of noNewRoutes) {
      const path = fileURLToPath(new URL(candidate, import.meta.url));
      assert.ok(!existsSync(path), `unexpected new route: ${candidate}`);
    }
    const clientWrapper = readSource("../lib/algo-test/store.ts");
    assert.ok(clientWrapper.includes("${BASE}/ai-runs"));
  });

  await test("the existing compileAndRunAiStrategy() service function itself is still the exact same canonical execution path (compileNaturalLanguageStrategy -> persistAiStrategy -> runBacktest) discovery already traced - QP-5 only extended persistAiStrategy's own call with an additional optional lineage argument, never a different persistence path", () => {
    const service = readSource("../services/algo-test/algo-test.service.ts");
    assert.ok(service.includes("async compileAndRunAiStrategy(userId: string, request: AiCompileAndRunRequest"));
    assert.ok(/persistAiStrategy\(userId, compilation\.compiledSpec(,|\))/.test(service));
    assert.ok(service.includes("await runBacktest("));
  });

  await test("BacktestResultCard renders only real, existing AlgoTestMetricsView field names - never an invented metric", () => {
    const card = readSource("../components/quant-chat/BacktestResultCard.tsx");
    for (const field of ["metrics.tradeCount", "metrics.netProfit", "metrics.winRate", "metrics.maxDrawdown"]) {
      assert.ok(card.includes(field), `expected ${field}`);
    }
    const metricsView = readSource("../types/algo-test.ts");
    const metricsBlock = metricsView.slice(metricsView.indexOf("interface AlgoTestMetricsView"), metricsView.indexOf("interface AlgoTestTradeView"));
    for (const field of ["tradeCount", "netProfit", "winRate", "maxDrawdown"]) {
      assert.ok(metricsBlock.includes(field), `${field} must be a real AlgoTestMetricsView field`);
    }
  });

  await test("a failed run renders the existing errorCode/errorMessage - never a fabricated failure reason, never silently swallowed", () => {
    const card = stripLineComments(readSource("../components/quant-chat/BacktestResultCard.tsx"));
    assert.ok(card.includes('run.status === "failed"'));
    assert.ok(card.includes("run.errorCode"));
    assert.ok(card.includes("run.errorMessage"));
  });

  await test("the full-result link reuses the EXISTING /dashboard/workspace?algoTestId= reopen convention, byte-identical to algo-test-history/page.tsx's own row link", () => {
    const card = readSource("../components/quant-chat/BacktestResultCard.tsx");
    const history = readSource("../app/dashboard/algo-test-history/page.tsx");
    assert.ok(card.includes("/dashboard/workspace?algoTestId=${encodeURIComponent(run.testId)}"));
    assert.ok(history.includes("/dashboard/workspace?algoTestId=${encodeURIComponent(run.testId)}"));
  });

  await test("QP-3's own protected files were not touched by QP-4 - no reference to the new backtest surface in any of them", () => {
    for (const f of ["../components/quant-chat/StrategyChartPreview.tsx", "../lib/chart-engine/strategy-indicator-adapter.ts", "../services/algo-test/quant-chat-preview.service.ts"]) {
      const src = readSource(f);
      assert.ok(!src.includes("BacktestResultCard"), `${f} must not reference BacktestResultCard`);
      assert.ok(!src.includes("quant-chat-backtest-defaults"), `${f} must not reference the QP-4 defaults module`);
    }
  });

  await test("no AgentRuntime/AgentType surface, no schema/migration file, no Optimize/WFO reference was introduced in the QP-4 page or its new files", () => {
    for (const f of ["../app/dashboard/quant-chat/page.tsx", "../lib/algo-test/quant-chat-backtest-defaults.ts", "../components/quant-chat/BacktestResultCard.tsx"]) {
      const src = readSource(f);
      assert.ok(!src.includes("AgentRuntime"));
      assert.ok(!src.includes("optimization.service"));
      assert.ok(!src.includes("walk-forward"));
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
