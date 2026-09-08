# P4 Phase 2 — Backtest Wiring

**Status:** Implemented, tested. Scope held deliberately tight per the user's own instruction: take the already-validated `StrategySpec` from P4 Phase 1 and route it through the existing generic `run-backtest.ts` path, with real-trade proof and regression coverage. No simulator changes, no new indicator families, no UI, no G01.

## 1. The pipeline (now complete end to end)

```
NL text → ClaudeProvider → parseAIStrategyCompilerInput() → compileAIStrategyToIR()
        → checkReductionEligibility() → reduceStrategyIRToSpec() → StrategySpec   (P4 Phase 1)
        → runBacktest() (P3.6's own generic function, UNMODIFIED signature)
        → runSimulation() ×2 (P3.8's reproducibility check, UNMODIFIED)
        → real trades → real metrics → P3.8's 8-stage lifecycle → persisted AlgoTestRun
```

`algoTestService.compileAndRunAiStrategy()` is the one new orchestration method (`frontend/services/algo-test/algo-test.service.ts`) — it calls `compileNaturalLanguageStrategy()` (Phase 1, unmodified) and, only if compilation reaches `EXECUTION_VALID`, calls the exact same `runBacktest()` every registry strategy (`golden`, `ref-ema-crossover`) already uses. `buildRunLifecycle()`/`buildDataValidFailureLifecycle()` — previously private to the registry-based `runAlgoTest()` — were generalized to take `importLifecycle: readonly StageResult[]` directly, so the identical lifecycle-building code serves both a registry entry's own `strategy.importLifecycle` and an AI compilation's own `compilation.stages` (same shape, same function, never a second one written for the AI path). A new endpoint, `POST /api/private/algo-test/ai-runs` (`frontend/app/api/private/algo-test/ai-runs/route.ts`), exposes it, following the exact request/response pattern the existing `/compile` route already uses.

No branch anywhere in `run-backtest.ts`, `run-simulation`, or the P3.8 lifecycle machinery asks "is this AI-generated?" — the only place `strategyId === "ai-generated"` appears is the persisted row's own identifier, exactly parallel to `"golden"`/`"ref-ema-crossover"`.

## 2. A real bug this phase found — and had to fix to make "real-trade proof" possible at all

Wiring an AI-compiled strategy through `runBacktest()` for the first time (not merely reviewing its `StrategySpec`, as Phase 1 did) surfaced a genuine gap: `run-backtest.ts` builds `SimulationConfig.indicatorSeries` from a strategy's own `buildIndicatorSeries(bars)` and hands it straight to `runSimulation()`, which evaluates every bar starting at index 0 (Q0.5's frozen `signal-generator.ts` has no warmup guard — it throws `MarketState is missing indicator value for "EMA(9)"` if a referenced indicator is still `undefined` on the bar being evaluated). A period-N indicator's first `N-1` values are genuinely `undefined` (`indicators/ema.ts`'s own documented warmup) — so any strategy referencing a named indicator would throw on its very first evaluated bar, unless the bars/series fed in already start past that warmup point.

`at24-quant-engine`'s own Q0.9 simulation adapter (`runtime/reduction/simulation-adapter.ts`, `compileToSimulation()`) already discovered and fixed this exact problem for the MQL-import compilation path — its own comment documents it as the "Q0.9 warmup fix," slicing `bars` and every indicator series by a computed `warmupBars` offset before simulating. `run-backtest.ts` (P3.6) never went through that adapter — it builds `indicatorSeries` itself — and had no equivalent slicing. This went undetected through P3.6/P3.8 because:
- Golden Strategy's own "indicator" is the raw close price (`buildGoldenIndicatorSeries`) — always defined, no warmup, never exposed the gap.
- `ref-ema-crossover`'s real `EMA(9)`/`EMA(21)` series *does* have genuine warmup, but P3.6/P3.8's own test scripts only ever checked its registry entry and `importLifecycle` structurally — neither one ever called `runBacktest()` for it end to end.

**Fix** (`frontend/services/algo-test/run-backtest.ts`, the generic path only — `at24-quant-engine/src` is untouched): after building `indicatorSeries` from the fetched bars, compute `warmupBars` generically as the latest "first defined index" across every series in the map (not hardcoded to any indicator family), then slice both `bars` and every series by that offset before constructing `SimulationConfig`. Mirrors Q0.9's own established mechanism, applied at the one integration point that never had it. Throws a clear, specific error (matching `compileToSimulation`'s own message shape) if there aren't enough bars to clear warmup at all, rather than silently truncating to nothing.

This is a fix to the *generic backtest orchestration layer* the user explicitly asked this phase to route strategies through — not a simulator change, not a new indicator family, not a UI change, not G01 — and it was necessary for acceptance criterion 3 ("real trades under a real signal") to be provable for *any* named-indicator strategy, AI-compiled or registry-based, over a realistic bar window.

## 3. Acceptance criteria — evidence

All 8 of the user's stated criteria, plus the "particularly important test," proven by `frontend/scripts/validate-ai-run-backtest-wiring.ts` (offline: fake `AIProvider` at the same P4-Phase-1 injection point, fake `HistoricalDataProvider` at `run-golden-backtest.ts`'s own established injection point, and a small in-memory `prisma.algoTestRun`/`prisma.user` fake — this sandboxed environment has no reachable Postgres, an established constraint since P3.8; every other line, including `runBacktest()`/`runSimulation()`/lifecycle-building, runs completely real and unmocked):

1. **Generated strategy validates** — reuses Phase 1's own proven compile path unmodified.
2. **Reaches the generic backtest service** — `compileAndRunAiStrategy()` calls the exact same `runBacktest()` function, same import, same call shape as the registry path.
3. **Real trades under a real signal** — EMA(9)/EMA(21) are computed for real from bars (`buildIndicatorSeriesFromIR`-equivalent named-indicator math via `calculateSeries()`), not injected values; a genuine, programmatically-generated uptrend produces a real filled order and a real, non-zero-length trade/position record.
4. **Results correspond to the generated parameters** — proven by the EMA 9/21 vs EMA 5/10 test below.
5. **P3.8 validation/evidence data remains attached** — an AI-compiled run reaches the full 8-stage `EVIDENCE_VERIFIED`/`fullyVerified: true` lifecycle, identical shape to a registry run.
6. **Golden Strategy path unaffected** — structural regression check plus the full existing `validate-algo-test-parameters.ts` suite (25/25, unchanged).
7. **No AI-specific condition in the simulator** — `at24-quant-engine/src` has zero diff this phase (confirmed by `npm test` below); the one behavior change (warmup slicing) lives entirely in the frontend's `run-backtest.ts` and applies identically regardless of strategy source.
8. **Existing regression suite remains green** — see §4.

**The particularly important test**: compiling "EMA 9/21" vs "EMA 5/10" produces two `StrategySpec`s whose `computeSemanticStrategyHash()` are genuinely different, and whose independently-run backtests produce different `resultHash`es — proving NL → IR → parameters → execution is real, not a relabeled preview.

**Also proven, beyond the 8 criteria**: the same warmup fix, exercised directly against the real registry strategy `ref-ema-crossover` (not just the AI path) — it now survives `runBacktest()` end to end and fills a real order under the identical crossover, which it could not have done before this phase (see §2).

## 4. Regression

`npm test` inside `at24-quant-engine/`: **1214/1214**, zero source changes to the package. `npx tsc --noEmit`: clean (both packages, against the already-vendored engine build — no re-vendor needed since `at24-quant-engine/src` is untouched this phase). `npm run validate:algo-test-parameters`: **25/25** (unchanged). `npm run validate:nl-strategy-compiler`: **9/9** (unchanged). `npm run validate:ai-run-backtest-wiring` (new): **7/7**. `eslint` on every changed/new file: clean.

## 5. Not run / disclosed gaps

Same as Phase 1: no real `ANTHROPIC_API_KEY` in this environment — the LLM call itself is not exercised live; the new `/api/private/algo-test/ai-runs` route fails cleanly (503) when the key is absent, matching `/compile`'s own established behavior. No live Postgres in this environment — `compileAndRunAiStrategy()`'s real `prisma.algoTestRun.create/update` calls are exercised against an in-memory fake matching the real schema shape, not a live database (same constraint noted throughout this session; P3.8 made the same disclosure for the same reason).
