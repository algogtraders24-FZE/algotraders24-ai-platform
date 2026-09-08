# P4 (Phase 1) — Natural Language → Universal Strategy IR

**Status:** Implemented, tested. Phase 1 scope only, confirmed with the user before implementation: compile → validate → structured review data. Backtest execution wiring is a deliberate, small follow-up left for later, not rushed into this pass.

## 1. What already existed, and what a real bug blocked

`compileAIStrategyToIR()` (Q0.7.46, `at24-quant-engine/src/runtime/strategy-ir/ai-compiler.ts`) already existed — the IR safety boundary the user asked for was never P4's to invent. It had never been called by any frontend code, and its own test only asserted `validateStrategyIR().executionEligible` (Q0.7-era, structural + BLOCKING-semantics only) — not the stricter `checkReductionEligibility()` (Q0.9/eligibility-gate.ts, established later) every other registered strategy's own lifecycle actually gates on.

Wiring it up for the first time surfaced a real bug, confirmed empirically before touching anything: `compileAIStrategyToIR()` hardcoded `pyramiding.sameDirectionBehavior: "REJECT"` and `reversal.buyToSell/sellToBuy: "CLOSE_THEN_OPEN"` — both of which `checkReductionEligibility()` unconditionally rejects (it requires `ACCUMULATE` and `REVERSE` respectively, rules established after this file was last touched). Every possible AI-compiled strategy would have failed `EXECUTION_VALID`, always, regardless of translation quality. Fixed to the values Q0.5's engine has actually required since Q1.5.4 — not new behavior, catching up two stale literals. Confirmed fixed with two new tests (`test/strategy-ir-ai-boundary.test.ts`): eligibility now genuinely passes, and a compiled strategy produces real trades under a real signal.

## 2. The pipeline

```
NL text → ClaudeProvider (lib/ai/providers/claude.provider.ts, existing)
        → extractJsonObject() (defensive: markdown fences, surrounding prose)
        → parseAIStrategyCompilerInput() (schema.ts — real, hand-written structural validator)
        → compileAIStrategyToIR() (existing Q0.7 boundary, now fixed)
        → validateStrategyIRStructure() / checkReductionEligibility() (P3.8's own functions, unmodified)
        → reduceStrategyIRToSpec() → StrategySpec (ready for review; NOT yet backtested)
```

Four stages result: `IMPORTED`/`PARSED`/`IR_VALID`/`EXECUTION_VALID` — the same `StrategyLifecycleStage` names P3.8 already established, computed the lightweight way `GOLDEN_STRATEGY_IMPORT_STAGES`/`REF_EMA_CROSSOVER_IMPORT_STAGES` already do (a plain 4-element array, not the full 8-stage `StrategyLifecycleResult`, since no backtest has run).

## 3. A deliberately narrower request surface than the engine could accept

The LLM is asked for less than `AIStrategyCompilerInput` could theoretically hold — a narrower request surface is a narrower failure surface:

- **Indicators**: SMA/EMA/RSI/ATR only (single-output). MACD/BOLLINGER_BANDS are real, engine-implemented families but have multi-value outputs (`line`/`signal`/`histogram`) with no established per-field addressing convention anywhere in this codebase (`indicatorKey()` is one string per indicator, no field sub-addressing) — excluded rather than inventing one un-reviewed.
- **Risk**: sizing is `fixed-quantity` or `percent-equity-risk` (`atr-based` excluded — `resolvePositionSize()` doesn't implement it, eligibility-gate.ts's own documented boundary); stopLoss/takeProfit are `fixed-distance`/`atr-multiple`/`risk-multiple` (`fixed-price` excluded — an LLM asserting an exact price level from a text prompt is not realistic).
- **`executionAssumptions`** is fixed server-side (`next-bar-open`, zero-cost — Golden/ref-ema-crossover's own convention), never LLM-supplied. Execution/safety assumptions are never an LLM's decision.
- **Symbols/timeframes**: validated against the real historical-data provider's actual supported set (7 symbols, M1–D1) — a real, currently-supported list, not a narrower one inherited from the existing registry-based flow's own "5m"-only allowlist (which was just an unexercised limit, not a provider limit).

## 4. Phase boundary — what this does NOT do yet, and why

`compiledSpec`/`buildIndicatorSeries` are returned, structurally ready to hand to the existing, unmodified `run-backtest.ts` (P3.6) — but this phase does not wire that call. Matches the user's own stated Phase 1 objective ("...user reviews strategy... before execution" — combining chat/chart/parameters/backtest into one experience is explicitly the step after this one). No persistence, no new API surface beyond the one compile endpoint, no UI.

## 5. Evidence

`test/strategy-ir-ai-boundary.test.ts` (+2, 8/8): the fix verified directly — eligibility now genuinely passes; a compiled strategy produces real trades under a genuine signal, not just a structurally-valid IR.

`frontend/scripts/validate-nl-strategy-compiler.ts` (9/9, offline, fake `AIProvider` injected at the service boundary — never touches `ClaudeProvider`/`ANTHROPIC_API_KEY`): a well-formed response reaches `EXECUTION_VALID` and its `buildIndicatorSeries` genuinely fires a real trade under a forced crossover (the same "prove it's not decorative" standard as P3.6's own reference strategy); a non-JSON response, a markdown-fenced response, a missing field, an unsupported symbol, an unsupported indicator family (MACD), an undeclared-indicator reference, and an `atr-multiple` stop with no matching declared ATR indicator all fail at the correct stage with a real, specific, actionable reason — never silently dropped or approximated.

**Not run**: the real LLM call itself — no `ANTHROPIC_API_KEY` in this environment, same disclosed status `claude.provider.ts` has carried since it was written. The API route fails cleanly (503, real message) rather than a generic error when the key is absent.

## 6. Regression

`npm test` inside `at24-quant-engine/`: **1214/1214** (1212 + 2 new). `npx tsc --noEmit`: clean, both packages. Vendor resynced.
