// scripts/validate-algo-test-walk-forward-ui.ts
// P4.9-C.2 - validation for the new WFO client store + setup/monitor
// pages + nav config. No test framework exists in this project (see
// package.json) - this file mirrors two already-established conventions
// rather than inventing a third:
//
//   1. Real behavioral tests, fetch-mocked, for anything plain-TS and
//      importable without a DOM/React renderer - the SAME technique
//      scripts/validate-client-conversation-identity.ts already
//      establishes (`globalThis.fetch` stubbed, the REAL module exercised,
//      never a reimplementation of it). Covers: the store
//      (lib/algo-test/walk-forward-store.ts), the detail page's own
//      exported pure functions (isTerminalStatus/formatProfitFactor/
//      isNoWinnerCompletion/mergeSummary - exported for exactly this
//      reason, see the page's own header comment), and the nav config
//      (config/dashboard.config.ts - pure data, no React dependency at
//      all).
//   2. Structural, source-verified tests for the parts that are genuinely
//      React-hook/JSX-only and cannot be exercised without a renderer -
//      the SAME technique scripts/validate-algo-test-optimization-api.ts
//      already establishes for its own sibling route files (reading real
//      page source, asserting on real patterns: which functions are
//      called, which fields are never referenced, which fallback value is
//      used for a null metric). Never a live NextRequest/React mock.
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

// ---------------------------------------------------------------------------
// Section A - the store (real behavior, fetch-mocked)
// ---------------------------------------------------------------------------

interface Captured {
  url?: string;
  method?: string;
  body?: unknown;
}

function installFetchMock(responseBody: unknown, ok = true, status = ok ? 200 : 500): Captured {
  const captured: Captured = {};
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.url = String(url);
    captured.method = init?.method ?? "GET";
    captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return {
      ok,
      status,
      json: async () => responseBody,
    } as Response;
  }) as typeof fetch;
  return captured;
}

function installThrowingFetchMock(): void {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
}

async function runStoreTests(): Promise<void> {
  console.log("\n=== A - Store: create ===");

  await test("createWalkForwardExperiment POSTs the exact request body to the base WFO endpoint", async () => {
    const captured = installFetchMock({ data: { experiment: { experimentId: "exp-1", status: "QUEUED" } } });
    const { createWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    const request = { strategyId: "golden", symbol: "XAUUSD", timeframe: "5m", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-14T23:59:59Z", initialBalance: 10000, searchSpace: [{ parameterId: "riskMultiple", min: 1, max: 2, step: 0.5 }] };
    const result = await createWalkForwardExperiment(request);
    assert.equal(captured.url, "/api/private/algo-test/walk-forward");
    assert.equal(captured.method, "POST");
    assert.deepEqual(captured.body, request);
    assert.equal(result.experimentId, "exp-1");
  });

  await test("createWalkForwardExperiment throws a plain Error with the real server message on failure (mirrors createOptimizationExperiment's own convention)", async () => {
    installFetchMock({ error: { code: "INVALID_SEARCH_SPACE", message: "Parameter 'x' is not declared." } }, false, 400);
    const { createWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    await assert.rejects(
      () => createWalkForwardExperiment({ strategyId: "golden", symbol: "XAUUSD", timeframe: "5m", startTime: "a", endTime: "b", searchSpace: [] }),
      (err: unknown) => err instanceof Error && err.message === "Parameter 'x' is not declared." && err.constructor.name === "Error",
    );
  });

  console.log("\n=== B - Store: get (never throws) ===");

  await test("fetchWalkForwardExperiment returns the real detail on success", async () => {
    const detail = { experimentId: "exp-1", status: "RUNNING", folds: [] };
    installFetchMock({ data: { experiment: detail } });
    const { fetchWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    const result = await fetchWalkForwardExperiment("exp-1");
    assert.deepEqual(result, detail);
  });

  await test("fetchWalkForwardExperiment returns undefined (never throws) on a 404", async () => {
    installFetchMock({ error: { code: "NOT_FOUND", message: "not found" } }, false, 404);
    const { fetchWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    const result = await fetchWalkForwardExperiment("nope");
    assert.equal(result, undefined);
  });

  await test("fetchWalkForwardExperiment returns undefined (never throws) on a network failure", async () => {
    installThrowingFetchMock();
    const { fetchWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    const result = await fetchWalkForwardExperiment("exp-1");
    assert.equal(result, undefined);
  });

  console.log("\n=== C - Store: continue (typed error, PROVIDER_ERROR preserved verbatim) ===");

  await test("continueWalkForwardExperiment POSTs to the /continue endpoint with no body and returns the summary", async () => {
    const captured = installFetchMock({ data: { experiment: { experimentId: "exp-1", status: "RUNNING" } } });
    const { continueWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    const result = await continueWalkForwardExperiment("exp-1");
    assert.equal(captured.url, "/api/private/algo-test/walk-forward/exp-1/continue");
    assert.equal(captured.method, "POST");
    assert.equal(captured.body, undefined);
    assert.equal(result.status, "RUNNING");
  });

  await test("continueWalkForwardExperiment throws WalkForwardClientError carrying the REAL server code verbatim, e.g. PROVIDER_ERROR", async () => {
    installFetchMock({ error: { code: "PROVIDER_ERROR", message: "Twelve Data rate limited." } }, false, 500);
    const { continueWalkForwardExperiment, WalkForwardClientError } = await import("../lib/algo-test/walk-forward-store");
    await assert.rejects(
      () => continueWalkForwardExperiment("exp-1"),
      (err: unknown) => err instanceof WalkForwardClientError && err.code === "PROVIDER_ERROR" && err.message === "Twelve Data rate limited.",
    );
  });

  await test("continueWalkForwardExperiment throws WalkForwardClientError with code UNKNOWN when the error body itself cannot be parsed", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => { throw new Error("bad json"); } }) as unknown as Response) as typeof fetch;
    const { continueWalkForwardExperiment, WalkForwardClientError } = await import("../lib/algo-test/walk-forward-store");
    await assert.rejects(
      () => continueWalkForwardExperiment("exp-1"),
      (err: unknown) => err instanceof WalkForwardClientError && err.code === "UNKNOWN",
    );
  });

  console.log("\n=== D - Store: cancel ===");

  await test("cancelWalkForwardExperiment POSTs to the /cancel endpoint and returns the summary", async () => {
    const captured = installFetchMock({ data: { experiment: { experimentId: "exp-1", status: "CANCELLED" } } });
    const { cancelWalkForwardExperiment } = await import("../lib/algo-test/walk-forward-store");
    const result = await cancelWalkForwardExperiment("exp-1");
    assert.equal(captured.url, "/api/private/algo-test/walk-forward/exp-1/cancel");
    assert.equal(captured.method, "POST");
    assert.equal(result.status, "CANCELLED");
  });

  await test("cancelWalkForwardExperiment throws WalkForwardClientError on a NOT_FOUND failure", async () => {
    installFetchMock({ error: { code: "NOT_FOUND", message: "Walk-forward experiment not found" } }, false, 404);
    const { cancelWalkForwardExperiment, WalkForwardClientError } = await import("../lib/algo-test/walk-forward-store");
    await assert.rejects(
      () => cancelWalkForwardExperiment("exp-1"),
      (err: unknown) => err instanceof WalkForwardClientError && err.code === "NOT_FOUND",
    );
  });
}

// ---------------------------------------------------------------------------
// Section E - detail page's own exported pure functions (real behavior)
// ---------------------------------------------------------------------------

async function runDetailPagePureFunctionTests(): Promise<void> {
  console.log("\n=== E - Detail page pure functions ===");

  const mod = await import("../app/dashboard/algo-test-walk-forward/[experimentId]/page");

  await test("isTerminalStatus - QUEUED/RUNNING are non-terminal, COMPLETED/FAILED/CANCELLED are terminal", () => {
    assert.equal(mod.isTerminalStatus("QUEUED"), false);
    assert.equal(mod.isTerminalStatus("RUNNING"), false);
    assert.equal(mod.isTerminalStatus("COMPLETED"), true);
    assert.equal(mod.isTerminalStatus("FAILED"), true);
    assert.equal(mod.isTerminalStatus("CANCELLED"), true);
  });

  await test("formatProfitFactor - Infinity renders as the real symbol, null renders as an em dash, never a fabricated 0", () => {
    assert.equal(mod.formatProfitFactor("Infinity"), "∞");
    assert.equal(mod.formatProfitFactor(null), "—");
    assert.equal(mod.formatProfitFactor(2.5), "2.50");
    assert.notEqual(mod.formatProfitFactor(null), "0");
    assert.notEqual(mod.formatProfitFactor(null), "0.00");
  });

  await test("isNoWinnerCompletion - the load-bearing B.2.1 no-winner shape (winnerCandidateId/oosProfitFactor/oosTradeCount all null) is detected", () => {
    const noWinnerFold = { status: "COMPLETED", winnerCandidateId: null, oosProfitFactor: null, oosTradeCount: null, oosOutcome: "INCONCLUSIVE" } as never;
    assert.equal(mod.isNoWinnerCompletion(noWinnerFold), true);
  });

  await test("isNoWinnerCompletion - a genuine INCONCLUSIVE fold that DID run OOS (real, if unpersuasive, metrics) is NOT the no-winner case", () => {
    const ranButInconclusive = { status: "COMPLETED", winnerCandidateId: "cand-1", oosProfitFactor: 0.4, oosTradeCount: 3, oosOutcome: "INCONCLUSIVE" } as never;
    assert.equal(mod.isNoWinnerCompletion(ranButInconclusive), false);
  });

  await test("isNoWinnerCompletion - a non-terminal fold is never the no-winner case, even with null fields", () => {
    const stillRunning = { status: "OPTIMIZING", winnerCandidateId: null, oosProfitFactor: null, oosTradeCount: null, oosOutcome: null } as never;
    assert.equal(mod.isNoWinnerCompletion(stillRunning), false);
  });

  await test("mergeSummary - merges a real mutation summary onto the last known-good detail, preserving folds/searchSpace untouched by the summary", () => {
    const previous = { experimentId: "exp-1", status: "RUNNING", foldsCompleted: 1, totalFolds: 3, folds: [{ id: "f1" }], searchSpace: [{ parameterId: "x", min: 1, max: 2, step: 1 }] } as never;
    const summary = { experimentId: "exp-1", status: "CANCELLED", foldsCompleted: 1, totalFolds: 3, cancelledAt: "2026-01-01T00:00:00Z" } as never;
    const merged = mod.mergeSummary(previous, summary);
    assert.equal(merged?.status, "CANCELLED");
    assert.deepEqual(merged?.folds, [{ id: "f1" }]);
    assert.deepEqual(merged?.searchSpace, [{ parameterId: "x", min: 1, max: 2, step: 1 }]);
  });

  await test("mergeSummary - returns undefined (never fabricates a detail object) when there is no prior known-good detail to merge onto", () => {
    const summary = { experimentId: "exp-1", status: "CANCELLED" } as never;
    assert.equal(mod.mergeSummary(null, summary), undefined);
    assert.equal(mod.mergeSummary(undefined, summary), undefined);
  });
}

// ---------------------------------------------------------------------------
// Section F - structural source verification (setup + detail pages, the
// parts genuinely React-hook/JSX-only, exact same technique
// validate-algo-test-optimization-api.ts already established)
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  const url = new URL(relativePath, import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) throw new Error(`file does not exist: ${relativePath}`);
  return readFileSync(path, "utf8");
}

async function runStructuralTests(): Promise<void> {
  const SETUP = readSource("../app/dashboard/algo-test-walk-forward/page.tsx");
  const DETAIL = readSource("../app/dashboard/algo-test-walk-forward/[experimentId]/page.tsx");

  console.log("\n=== G - Setup page structural checks ===");

  await test("setup page calls createWalkForwardExperiment with the exact CreateWalkForwardExperimentRequest field set", () => {
    assert.ok(SETUP.includes("createWalkForwardExperiment("));
    for (const field of ["strategyId", "symbol", "timeframe", "startTime", "endTime", "initialBalance", "searchSpace"]) {
      assert.ok(SETUP.includes(field), `must reference ${field}`);
    }
  });

  await test("setup page NEVER exposes inSampleDays/outOfSampleDays/stepDays as client-configurable fields (server-locked WFO methodology parameters)", () => {
    // Checked against the real component body only (from the default
    // export onward) - the file's own header comment legitimately
    // discusses these names in prose to explain why they were never
    // added, which must not itself trip this check (the same
    // prose-vs-code precision the API validator's own ALREADY_TERMINAL
    // check establishes).
    const bodyStart = SETUP.indexOf("export default function");
    assert.ok(bodyStart > 0, "must define a default-exported component");
    const body = SETUP.slice(bodyStart);
    assert.ok(!/inSampleDays|outOfSampleDays|stepDays/.test(body), "must not reference any server-locked fold-config field inside the component itself");
  });

  await test("setup page redirects to the nested experiment detail route on successful creation", () => {
    assert.ok(/router\.push\(`\/dashboard\/algo-test-walk-forward\/\$\{/.test(SETUP), "must router.push to /dashboard/algo-test-walk-forward/<experimentId>");
  });

  await test("setup page handles a create failure with a real error message, never a silent failure", () => {
    assert.ok(/setSubmitError/.test(SETUP));
    assert.ok(/err instanceof Error \? err\.message/.test(SETUP));
  });

  console.log("\n=== H - Detail page structural checks ===");

  await test("detail page drives execution via continueWalkForwardExperiment and refreshes via fetchWalkForwardExperiment - never a raw prisma/db call", () => {
    assert.ok(DETAIL.includes("continueWalkForwardExperiment("));
    assert.ok(DETAIL.includes("fetchWalkForwardExperiment("));
    assert.ok(!/prisma\./.test(DETAIL), "a client page must never reference prisma directly");
  });

  await test("detail page distinguishes PROVIDER_ERROR / typed errors via WalkForwardClientError, never a bare string comparison on err.message", () => {
    assert.ok(DETAIL.includes("WalkForwardClientError"));
    assert.ok(/err instanceof WalkForwardClientError/.test(DETAIL));
  });

  await test("detail page stops automatic polling on a continue() failure (the setTimeout reschedule lives only inside the try's success branch, never inside the catch)", () => {
    const tryIdx = DETAIL.indexOf("const runContinue = useCallback(async () => {");
    assert.ok(tryIdx >= 0, "must define runContinue");
    const catchIdx = DETAIL.indexOf("} catch (err) {", tryIdx);
    assert.ok(catchIdx > tryIdx, "must have a catch block");
    const tryBlock = DETAIL.slice(tryIdx, catchIdx);
    const catchBlock = DETAIL.slice(catchIdx, DETAIL.indexOf("\n  }, [", catchIdx));
    assert.ok(/setTimeout/.test(tryBlock), "the reschedule must live in the try (success) branch");
    assert.ok(!/setTimeout/.test(catchBlock), "the catch (failure) branch must never reschedule automatically");
  });

  await test("detail page's Retry action re-invokes the same continuation function, never a new/duplicate mechanism", () => {
    assert.ok(/function handleRetry\(\)\s*\{\s*setContinueError\(null\);\s*runContinue\(\);/.test(DETAIL.replace(/\s+/g, " ")) || (/setContinueError\(null\)/.test(DETAIL) && /runContinue\(\)/.test(DETAIL)));
  });

  await test("detail page cancellation goes through cancelWalkForwardExperiment behind a confirmation Modal, never a raw status mutation", () => {
    assert.ok(DETAIL.includes("cancelWalkForwardExperiment("));
    assert.ok(/<Modal\b/.test(DETAIL));
    assert.ok(!/status:\s*["']CANCELLED["']/.test(DETAIL), "the page must never locally construct a CANCELLED status object");
  });

  await test("detail page never continues polling past a terminal status - the scheduling condition checks isTerminalStatus before every setTimeout", () => {
    assert.ok(/!isTerminalStatus\(result\.status\)/.test(DETAIL));
  });

  await test("null OOS metrics render as the em-dash fallback, never coerced to 0 (sprint's own load-bearing rule)", () => {
    assert.ok(DETAIL.includes('fold.oosTradeCount ?? "—"'), 'oosTradeCount must fall back to "—", never 0');
    assert.ok(!/oosTradeCount\s*\?\?\s*0\b/.test(DETAIL), "must never fall back to a literal 0");
    assert.ok(!/oosProfitFactor\s*\?\?\s*0\b/.test(DETAIL), "must never fall back to a literal 0");
  });

  await test("the no-winner/INCONCLUSIVE case renders explicit unavailability copy, not a fabricated PASSED/FAILED/0", () => {
    assert.ok(/No eligible winner was produced for this fold; out-of-sample validation was not run\./.test(DETAIL));
    assert.ok(/isNoWinnerCompletion\(/.test(DETAIL));
  });

  await test("process verdict is read verbatim from detail.verdict - never computed/inferred client-side (no local PASSED/FAILED/INCONCLUSIVE assignment)", () => {
    assert.ok(/detail\.verdict &&/.test(DETAIL) || /detail\.verdict \?/.test(DETAIL), "the verdict card must be gated on the real persisted field");
    assert.ok(!/const\s+verdict\s*=\s*(?!detail)/.test(DETAIL), "must never locally compute a variable named verdict from anything but the real field");
  });

  await test("verdict presentation is structurally separate from the status Badge - VERDICT_TONE and STATUS_TONE are two distinct maps", () => {
    assert.ok(DETAIL.includes("const STATUS_TONE:"));
    assert.ok(DETAIL.includes("const VERDICT_TONE:"));
    assert.notEqual(DETAIL.indexOf("const STATUS_TONE:"), DETAIL.indexOf("const VERDICT_TONE:"));
  });

  await test('no forbidden global-winner language anywhere ("Global Winner" / "Best WFO Candidate" / "Experiment Winner") - winner selection is fold-local only, per the locked "no global WFO winner" rule', () => {
    assert.ok(!/Global Winner/.test(DETAIL));
    assert.ok(!/Best WFO Candidate/.test(DETAIL));
    assert.ok(!/Experiment Winner/.test(DETAIL));
  });

  await test("candidates are rendered nested inside each fold's own FoldSection, never flattened into one global top-level candidate table", () => {
    const foldSectionIdx = DETAIL.indexOf("function FoldSection(");
    assert.ok(foldSectionIdx >= 0, "must define a per-fold FoldSection component");
    const candidateTableIdx = DETAIL.indexOf("fold.candidates.map(");
    assert.ok(candidateTableIdx > foldSectionIdx, "the candidate table must be rendered INSIDE FoldSection, scoped to that fold's own candidates");
    // No second, experiment-wide candidate list outside FoldSection.
    assert.ok(!/detail\.folds\.flatMap\(.*candidates/.test(DETAIL), "must never flatten every fold's candidates into one combined list");
  });
}

// ---------------------------------------------------------------------------
// Section I - navigation (real behavior, pure data import)
// ---------------------------------------------------------------------------

async function runNavigationTests(): Promise<void> {
  console.log("\n=== I - Navigation ===");

  const { DASHBOARD_NAV_GROUPS } = await import("../config/dashboard.config");

  await test("Walk-Forward appears as a child of PRODUCTS > Algo Testing Pro, pointing at /dashboard/algo-test-walk-forward", () => {
    const products = DASHBOARD_NAV_GROUPS.find((g) => g.label === "PRODUCTS");
    assert.ok(products, "PRODUCTS group must exist");
    const algoTestingPro = products!.items.find((i) => i.label === "Algo Testing Pro");
    assert.ok(algoTestingPro, "Algo Testing Pro item must exist");
    const walkForward = algoTestingPro!.children?.find((c) => c.label === "Walk-Forward");
    assert.ok(walkForward, "Walk-Forward child must exist under Algo Testing Pro");
    assert.equal(walkForward!.href, "/dashboard/algo-test-walk-forward");
  });

  await test("existing Algo Testing Pro children (Run History, Strategy Library) are unchanged", () => {
    const products = DASHBOARD_NAV_GROUPS.find((g) => g.label === "PRODUCTS")!;
    const algoTestingPro = products.items.find((i) => i.label === "Algo Testing Pro")!;
    assert.deepEqual(
      algoTestingPro.children?.filter((c) => c.label !== "Walk-Forward"),
      [
        { label: "Run History", href: "/dashboard/algo-test-history" },
        { label: "Strategy Library", href: "/dashboard/algo-test-library" },
      ],
    );
    assert.equal(algoTestingPro.href, "/dashboard/workspace");
  });

  await test('no "Optimize" nav entry was added - the pre-existing Optimization nav gap is explicitly out of this sprint\'s scope', () => {
    const products = DASHBOARD_NAV_GROUPS.find((g) => g.label === "PRODUCTS")!;
    const algoTestingPro = products.items.find((i) => i.label === "Algo Testing Pro")!;
    assert.ok(!algoTestingPro.children?.some((c) => c.label === "Optimize"), "must not add an Optimize nav entry this sprint");
  });

  await test("the locked top-level IA (five named groups + Dashboard + Admin) and every OTHER top-level item are unchanged", () => {
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
}

async function main(): Promise<void> {
  await runStoreTests();
  await runDetailPagePureFunctionTests();
  await runStructuralTests();
  await runNavigationTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
