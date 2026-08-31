# Q0 Architecture Decisions

## ADR-001: Quant Engine is isolated from M-Series
The Quant Engine is a standalone npm package (`at24-quant-engine/`) with zero runtime dependencies and no import path into `frontend/` or `ea-research/`. Enforced by `test/isolation.test.ts`.

## ADR-002: StrategySpec is the canonical strategy representation
`src/domain/strategy-spec.ts` defines the only machine-readable shape a strategy may take across the engine: identity, version, metadata, instruments, timeframes, parameters, entry/exit rules (as `Expression` trees), risk specification, and execution assumptions. Nothing else in the engine is allowed to represent "a strategy" in a different shape.

## ADR-003: Signal, Decision, Order, and Position are separate concepts
Modeled as four distinct types (`signal.ts`, `decision.ts`, `order-intent.ts`, `position.ts`) forming a one-way lifecycle: `MarketData → MarketState → Signal → Decision → OrderIntent → Execution → Position`. A `Decision` carries a `Signal` by reference plus reasoning context; an `OrderIntent` carries a `Decision` by reference. None of these types are unioned or collapsed into a generic "event" object, so a future reader cannot mistake "the strategy wants to buy" (Decision) for "we are actually long" (Position).

## ADR-004: AI cannot establish trust
Documented in `docs/Q0_ARCHITECTURE_DECISIONS.md#q010-ai-boundary` below. No type in this package (`Signal`, `Decision`, `BacktestResult`, etc.) carries a confidence score, trust flag, or validation verdict. Those are exclusively M-Series concepts (`TrustStatus`, `ValidationResult` in the Python sense) and are out of scope here by construction — there is nothing in this package's type surface an AI output could plug into to "become trusted."

## ADR-005: BacktestResult is not Evidence
`src/domain/backtest-result.ts` defines `BacktestResult` (trades, equity curve, metrics, execution statistics, config, reproducibility metadata) with a code comment explicitly forbidding fields like `evidenceHash`/`validationHash`/`trustState` from ever being added to it. Converting a `BacktestResult` into M-Series `Evidence` is a future adapter's responsibility, not this type's.

## ADR-006: M-Series remains authoritative for Evidence/Validation/Risk/Trust
`RiskSpecification` (`src/domain/risk-specification.ts`) is a strategy/runtime-level sizing and stop/target contract only. It does not call, import, or shadow the M-Series Python `m5-risk-analysis` engine, nor either of the frontend's `risk-engine.service.ts` AI-copilot services. The only sanctioned future bridge is an explicit Risk Adapter, not built in Q0.

## ADR-007: Strategy versions are immutable
`src/domain/strategy-version.ts`'s `freezeStrategyVersion()` takes a structural clone of the spec and a canonical content hash at publish time; `verifyStrategyVersionIntegrity()` lets any later consumer detect if the stored spec was mutated in place. A logic change must produce a new `StrategySpec.version`, not an edit to an existing `StrategyVersionRecord`. This is Quant-side only — it is not wired to the still-draft M1 `TradingSystem`/`Version` Prisma models.

## ADR-008: Quant runtime must be deterministic
`src/runtime/determinism.ts` provides `canonicalStringify()` (recursive key-sorting) and `computeCanonicalHash()` (SHA-256 over the canonical form), used both for strategy content-hashing (ADR-007) and for the reproducibility tests in `test/determinism.test.ts`, which prove that identical `StrategySpec` + `MarketState` inputs produce byte-identical `Signal` output and hash across repeated runs.

## ADR-009: Provider integrations are abstracted behind MarketData contracts
`src/domain/market-data.ts`'s `MarketDataSeries`/`OHLCVBar`/`MarketDataSource` carry only a normalized OHLCV shape plus an opaque `providerId`/`datasetId` pair. No MT5, Binance, Angel One, Dukascopy, or Alpha Vantage integration code exists in this package, and none of `OHLCVBar`'s fields assume a particular provider's quirks.

## ADR-010: M-Series integration will occur only through explicit future adapters
Three integration points are documented but not implemented: `BacktestResult → Evidence Adapter → M-Series Evidence`, `StrategySpec → Validation Adapter → M-Series Validation`, `RiskSpecification → Risk Adapter → M-Series Risk`. Building any of these adapters is out of scope for Q0 and requires a dedicated future sprint with M-Series' explicit involvement, since M-Series is mid-bugfix and must not be touched now.

---

## Q0.10 — AI Boundary

Correct flow:

```
User
  |
  v
AI Strategy Agent           (future; not built in Q0)
  |
  v
StrategySpec                (src/domain/strategy-spec.ts)
  |
  v
Deterministic Quant Runtime  (src/runtime/*)
  |
  v
Backtest                     (contract only: backtest-config.ts / backtest-result.ts)
  |
  v
Evidence -> Validation -> Trust   (M-Series, Python, untouched by Q0)
```

Incorrect flow (explicitly rejected):

```
User -> AI says "95% confidence" -> Trusted Strategy
```

An AI is permitted to **propose or modify a `StrategySpec`**. It is never permitted to directly assign a trust status, validation verdict, risk approval, or marketplace eligibility — those remain deterministic, M-Series-computed outcomes over evidence the AI did not author. Nothing in this package's public API accepts a confidence score as input to a Signal, Decision, or BacktestResult, which makes this boundary a structural property of the type system, not just a policy note.

## Q0.11 — Future M-Series Integration Contract (documented, not implemented)

```
Quant Backtest Result
        |
        v
  Evidence Adapter        <-- NOT BUILT
        |
        v
  M-Series Evidence        (ea-research/marketplace-research/m2-evidence-engine)

Quant Strategy (StrategySpec)
        |
        v
  Validation Adapter       <-- NOT BUILT
        |
        v
  M-Series Validation      (ea-research/marketplace-research/m4-validation-engine)

Quant Risk Specification
        |
        v
  Risk Adapter              <-- NOT BUILT
        |
        v
  M-Series Risk             (ea-research/marketplace-research/m5-risk-analysis)
```

M-Series remains authoritative for Evidence, Validation, Risk, History, Trust, and Marketplace eligibility. No adapter code, schema, or API contract for any of the above was created in Q0.

## Q0.14 — Final Architecture Check

```
                    AT24 QUANT ENGINE  (at24-quant-engine/, standalone package)
                           |
             +-------------+-------------+
             |                           |
       Strategy Model               Market Data
    (StrategySpec, Expression,   (MarketDataSeries,
     RiskSpecification,           OHLCVBar,
     ExecutionSpecification)      MarketState)
             |                           |
             +-------------+-------------+
                           |
                    Quant Runtime
        (expression-evaluator.ts, signal-generator.ts,
                    determinism.ts)
                           |
                    Backtest Engine        <-- contract only (backtest-config.ts,
                           |                    backtest-result.ts); no engine built
                  Research / Optimize      <-- not built
                           |
                     Quant Result           (BacktestResult)
                           |
                  [FUTURE ADAPTER]          <-- not built (Q0.11)
                           |
                           v
                    M-SERIES EVIDENCE       (Python, ea-research/marketplace-research)
                           |
                Validation -> Risk
                           |
                  History -> Trust
                           |
                     Marketplace
```

Verified: no arrow below "[FUTURE ADAPTER]" has any corresponding code in this sprint. Everything above it is real, tested TypeScript with zero dependency on anything below it.
