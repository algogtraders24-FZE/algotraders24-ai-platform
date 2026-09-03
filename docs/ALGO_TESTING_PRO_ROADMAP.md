# AT24 Algo Testing Pro — Roadmap (P3.5 → P5)

**Status at time of writing:** foundation landed on `main` @ `217a655` (PR #11 — Q1.5 Verification Closure + P3.4 Strategy Parameters, composed and merged, 1190/1190 tests). This document locks the roadmap for everything built on top of that foundation, before any of it is built.

## 1. Naming

**"AT24 Algo Testing Pro"** is the canonical name for this product line (`frontend/components/chart-engine/AlgoTestPanel.tsx` and everything under `frontend/services/algo-test/`, `docs/P3.*`). "Quant Pro" is an acceptable conversational shorthand, but code, docs, and commit messages use **Algo Testing Pro** — matching the `algo-test` naming already established across P3.1–P3.4's files, routes, and Prisma models. Do not introduce a second name for the same product.

## 2. Boundary: AT24 Quant Lite

**AT24 Quant Lite** (`quant-engine/` — the Python service: `spec_engine`, `service/quant_lite_execution_service.py`, the Q1.6/Q1.7 beta-release line) is a **separate product** and stays untouched by this roadmap, exactly as it has been through P3.1–P3.4. Confirmed structurally, not just by convention: Quant Lite's codebase (`quant-engine/`) and Algo Testing Pro's codebase (`at24-quant-engine/`, TypeScript) are different directory trees with zero file overlap — verified directly during the P3.4/Q1.5 merge-readiness check (main's most recent 19 commits before that merge touched 571 files, all under `quant-engine/`, none under `at24-quant-engine/`).

Nothing in P3.5–P5 reads from, writes to, or imports `quant-engine/`. If a future need arises to share logic between the two, that is a deliberate, separately-scoped decision — never an incidental import.

## 3. Boundary: D2.6 Decision Context

D2.6 Decision Context carries its own hard rule: **"never a signal engine."** Algo Testing Pro is a backtest/simulation product — it evaluates a strategy's historical performance on demand, under an operator's explicit request, and produces reproducible evidence. It does not generate live signals, does not run continuously against live market state, and does not feed D2.6's verified-answer surface. These stay architecturally separate systems. Nothing in this roadmap changes that.

## 4. IR as the execution safety boundary

Every phase below that touches "arbitrary" or "imported" strategies (P3.6 onward) does so **only** through the existing, frozen `StrategyIR` → `StrategySpec` pipeline (Q0.7 IR, Q0.8–Q1.5 MQL4/MQL5 importer, `ir-to-spec-reducer.ts`). A natural-language strategy description (P4) is never executed as generated code — it is translated into `StrategyIR`, validated by the existing `validateStrategyIR`/eligibility-gate machinery, and only then run through `runSimulation`. This is not a new decision; it is the same boundary Q1.5's own docs describe, restated here so it isn't quietly abandoned once a chat interface makes "just run what the model wrote" tempting.

## 5. Reproducibility & evidence principles (already proven, must not regress)

Every phase must preserve invariants P3.1–P3.4 already established and verified:

- **Deterministic replay**: identical inputs (`StrategySpec` + dataset + execution assumptions) produce a byte-identical `resultHash` (Q0.5.36, re-verified in P3.4's own `computeSemanticStrategyHash`-based test).
- **No guessed backfill**: a result row from before a schema change is never silently assumed to carry today's default — it renders an explicit "not recorded" state (P3.4's own precedent for `parameters: NULL`).
- **Provenance carries strategy identity**: `SimulationProvenance.strategyHash` is `computeSemanticStrategyHash(spec)` (Q0.2/`runtime/identity.ts`) — the *entire* semantic `StrategySpec` content except `metadata`, which **already includes `risk` and `execution`**, not just `entryRules`/`exitRules`. This is the mechanism P3.5 depends on — see §6.

## 6. Phase P3.5 — Risk Configuration → Real Strategy Parameters

**The architectural finding that shapes this phase**: `computeSemanticStrategyHash()` (`at24-quant-engine/src/runtime/identity.ts`) already hashes the *entire* `StrategySpec` except `metadata` — which means `risk` (sizing/stopLoss/takeProfit/etc., `domain/risk-specification.ts`, a real, already-validated, already-rich contract since Q0.2) **already participates in `strategyHash`/`resultHash` identity today**, mechanically. **P3.5 is not "build a new identity mechanism for risk config" — it is "stop hardcoding `risk` in `buildGoldenStrategySpec()` and thread real values through the same path `priceThreshold` already proved out in P3.4."** Confirming this before writing code is the point of doing the investigation first; it keeps this phase from accidentally reinventing machinery that already exists and is already correct.

**Concretely, what changes:**
- `GoldenStrategyParams` (`at24-quant-engine/src/reference/golden-strategy.ts`) gains optional risk fields (e.g. `stopLossDistance`, `takeProfitRMultiple`, `positionSizeQuantity` — exact set decided at implementation time against `RiskSpecification`'s existing types, never a new risk shape), threaded into the returned `risk` block instead of the current hardcoded literals.
- The Strategy Registry's `golden` entry (`frontend/services/algo-test/strategy-registry.ts`) declares these as real `StrategyParameterDefinition`s, same mechanism `priceThreshold` already uses — no new parameter-type system.
- `run-golden-backtest.ts` and `algo-test.service.ts` thread the validated values through to `buildGoldenStrategySpec()`, mirroring `priceThreshold`'s existing plumbing exactly.
- `AlgoTestPanel.tsx` renders the new fields via the existing generic `ParameterField` mechanism — not new one-off UI per field.

**Explicit non-goal**: making the risk fields *editable in the UI* is necessary but not sufficient. A field that's editable but not persisted into `AlgoTestRun.parameters`, not threaded into `buildGoldenStrategySpec()`, and therefore not reflected in `strategyHash`/`resultHash` would be UI decoration, not real configuration — and would fail this phase's acceptance criteria below.

### Acceptance criteria (P3.5)

1. Changing a risk parameter (e.g. stop-loss distance) via the API/UI, holding everything else fixed, produces a **different `strategyHash`** than the default — proven by a direct test, the same style as P3.4's own determinism test.
2. Changing a risk parameter and then reverting it to the documented default reproduces the **exact pre-P3.5 `strategyHash`/`resultHash`** for the default case — no accidental drift for callers who never touch the new fields (mirrors P3.4's own backward-compatibility guarantee).
3. A risk parameter that actually changes simulated behavior (e.g. a tighter stop-loss that gets hit where the wider default didn't) produces a **provably different trade ledger**, not just a different hash — at least one dedicated test proves a real behavioral effect, not merely a structural one (mirrors P3.4's `priceThreshold` "zero trades above every bar's price" proof).
4. Legacy `AlgoTestRun` rows (pre-P3.5, `parameters` without the new fields) render an explicit "not recorded, predates P3.5" state for the new fields — never a silently-assumed default (mirrors P3.4 §7).
5. `npm test` inside `at24-quant-engine/` passes with zero regressions to the pre-P3.5 count; `npx tsc --noEmit` clean.
6. No change to `quant-engine/` (Quant Lite, §2) or to D2.6 Decision Context files (§3).

## 7. Phase P3.6 — Multi-strategy Registry + Generic Strategy Contract

Replace the single hardcoded `STRATEGY_REGISTRY` entry with a real registry backed by the existing MQL4/MQL5 importer → `StrategyIR` → `ir-to-spec-reducer` pipeline (Q0.8–Q1.5), so an imported EA becomes a second, third, Nth registrable strategy under the same reproducibility guarantees P3.1–P3.5 already proved — never a second, parallel execution path.

**Target proof point**: a **frozen G01 checkpoint** (a specific, tagged commit of the G01 EA source — chosen once G01's Sprint 2 research reaches a stable milestone, e.g. after Phase 4A entry-forensics closes), not G01's actively-moving research branch. Integrating against a moving target would make P3.6's own tests non-reproducible, which contradicts §5's principles.

### Acceptance criteria (P3.6)

1. At least one non-Golden-Strategy strategy (the frozen G01 checkpoint) is registered, importable, and runnable through the identical simulation/evidence pipeline as the Golden Strategy — same `StrategyDefinition` contract, no strategy-specific execution code path.
2. `StrategyDefinition`/registry contract explicitly includes: identity, source, execution model, Strategy IR reference, parameters, risk configuration, supported symbols/timeframes, reproducibility metadata (per the structure agreed in this roadmap's design discussion).
3. Registering a new strategy requires no changes to `algo-test.service.ts`'s validation/persistence logic — only a new registry entry (mirrors P3.3's own stated design goal for the single-strategy case, now proven for N strategies).
4. Full regression suite green; G01's own frozen-checkpoint import produces a reproducible `strategyHash`.

## 8. Phase P3.7 — Generic Parameter Engine

`StrategySpec.parameters` (the engine-level declarative field, part of `StrategySpec` since Q0, confirmed by P3.4's own audit to have **zero runtime consumers** anywhere in the engine) becomes an actual read path: the frontend Strategy Registry's parameter metadata is generated from whatever a strategy genuinely declares, rather than one hand-wired `StrategyParameterDefinition` array per strategy. UI must not hardcode "Golden Strategy has a field called `priceThreshold`" — it renders whatever the registered strategy's schema says.

### Acceptance criteria (P3.7)

1. Two differently-parameterized registered strategies (Golden Strategy + the P3.6 G01 checkpoint) render correct, different parameter panels with zero strategy-specific UI code.
2. Adding a new parameter to a strategy's declared schema requires no `AlgoTestPanel.tsx` changes.

## 9. Phase P3.8 — Validation / Evidence Gate

Before arbitrary imported strategies (P3.6+) are treated as equally trustworthy as the hand-verified Golden Strategy, every registered strategy carries an explicit status through: `IMPORTED → PARSED → IR VALID → EXECUTION VALID → DATA VALID → BACKTEST VALID → REPRODUCIBLE → EVIDENCE VERIFIED`. A strategy that hasn't cleared a given stage is visibly marked as such, never silently treated as further along than it is — the same "no fabrication, no silent upgrade of an unproven claim" discipline already applied elsewhere in AT24 (no-fabrication default, D2.5 Intelligence Score, D2.8 honest-gap reporting).

### Acceptance criteria (P3.8)

1. Every registry entry exposes its current status from the list above; the UI surfaces it, never hides or defaults it to "verified."
2. The G01 checkpoint from P3.6 is carried through this pipeline and reaches (or explicitly fails to reach) `EVIDENCE VERIFIED` with a real, inspectable reason either way.

## 10. Phase P4 — Natural Language → Universal Strategy IR

Only after P3.5–P3.8 establish a real multi-strategy, real-parameter, validated foundation: a chat/description-to-`StrategyIR` generator. UX rule, non-negotiable: **chat changes logic, the structured panel changes numbers** — a parameter tweak never triggers regeneration, mirroring the pattern independently validated in the LuxAlgo competitive research (`AT24_LuxAlgo_RnD_Plan.pdf`, Finding 2). Output is always `StrategyIR`, validated exactly as an imported EA is validated (§4) — never directly-executed generated code.

## 11. Phase P5 — Live Execution Safety / Trade Relay Pattern

Named default-on risk rails, idempotent order IDs, a replayable audit trail, and an exact-typed-acknowledgement requirement for any paper-to-live transition (modeled on the Trade Relay pattern from the LuxAlgo competitive research, Finding 8) — built only once there is something worth routing real orders for, on top of the P1/P2 Paper Trading margin/leverage/stop-out mechanics that already exist.

## 12. Sequencing discipline

Do not skip ahead to P4's chat UX before P3.5–P3.8 remove the static single-strategy/single-parameter boundary. The interface should not imitate a dynamic strategy system before one genuinely exists underneath it.
