# AN1.15 — Strategy Research Agent (A13)

**Sprint:** AT24 AI Agents — Agent Framework Foundation
**Step:** A13 — Strategy Research Agent (**the final real specialist** — A1–A13 = the complete initial real-agent framework)
**Depends on:** A1–A10 foundation + A2 `backtest.run` + A2 `market.intelligence` (all closed)
**Gate:** G13 — review requested
**Migration:** **none** — A13 adds no persistent model.

---

> **A13 adds a canonical AgentDefinition + a NEW planning/synthesis
> specialist + a thin entrypoint.** It reuses the existing `backtest.run`
> (→ `algoTestService` → `at24-quant-engine`), `market.intelligence`,
> `AgentRuntime`, and A6 / A8 / A9 / A10. **No second backtest engine, no
> second strategy engine, no execution engine, no new persistence model.**

---

## 1. What was built

| File | Role | LOC |
|---|---|---|
| `services/agent-framework/supervisor/specialists/strategy-research.specialist.ts` | **NEW specialist** `key: "STRATEGY_RESEARCH"`. Deterministic plan (`backtest.run → market.intelligence`); deterministic synthesis that keeps **hypothesis / backtestResult / marketContext / conclusion** separate and **withholds** a trading recommendation. NO LLM. | ~230 |
| `services/agent-framework/agents/strategy-research-agent.ts` | `strategyResearchAgentDefinition()` (canonical AF-v1 definition) + `runStrategyResearchAgent()` (thin entrypoint). | ~130 |
| `scripts/validate-agent-strategy-research.ts` | G13 proof — 8 tests. | ~330 |

**Modified (additive only):**

```
services/agent-framework/supervisor/specialist-registry.ts   SPECIALISTS.STRATEGY_RESEARCH = strategyResearchSpecialist
services/agent-framework/supervisor/index.ts                  export strategyResearchSpecialist
scripts/validate-agent-market-intelligence.ts                 "agents/ dir" assertion loosened (3 files now); per-process test user
scripts/validate-agent-research.ts                            per-process test user (contention safety)
package.json                                                  + "validate:agent-strategy-research"
```

**Test-isolation fix.** All three real-agent validation scripts now derive
their synthetic user id from `process.pid` + a timestamp. They write real
rows to the shared dev DB and clean them up by user; two concurrent runs
(or a peer session running the same script) previously shared one id, so
one run's `cleanup()` could delete another's in-flight `AgentRun` → an
`AgentStep_runId_fkey` violation mid-tick. Unique ids remove the collision.
(Broader validation-harness isolation belongs to A14.)

**Not touched:** `backtest.run` / `market.intelligence` tools, `algoTestService`,
`at24-quant-engine`, A4 runtime, A6 integrity, A8 authorization, A9 ledger,
A10 evaluation, the contract layer, the legacy agents UI. **No schema change,
no API route, no new `services/agent-framework/` module or directory.**

---

## 2. The five things the brief keeps separate (owner G12)

```
      Strategy hypothesis            "worth investigating" — NOT a claim it works
              │
              ▼
      backtest.run  ────────────────  the REAL historical test (at24-quant-engine)
              │
              ▼
      backtestResult  ──────────────  verbatim aggregate metrics + resultHash + assumptions
              │                       — a RESULT, never auto-promoted
              ▼
      market.intelligence  ─────────  current-regime context, clearly labelled
              │                       "not part of the historical test"
              ▼
      AgentEvidence → lineage
              │
              ▼
      conclusion  ──────────────────  a BOUNDED research interpretation of the evidence
              │
              ▼
      (withheld) trading recommendation   notATradeRecommendation: true
                                          no entry / stop / target / size / side /
                                          probability-of-profit — A6-enforced at autonomy < 2
```

### 2.1 The output — `strategy-research-brief`

```jsonc
{
  "kind": "strategy-research-brief",
  "hypothesis": "Whether the 'golden' strategy on XAUUSD 5m warrants further research, evaluated here against one historical backtest. This is a research question - not a claim that the strategy is profitable, robust, or should be traded.",
  "backtestResult": {
    "testId": "...", "status": "completed",
    "strategyId": "golden", "symbol": "XAUUSD", "timeframe": "5m",
    "window": { "startTime": "...", "endTime": "..." },
    "resultHash": "sha256:...",
    "metrics": { "netProfit": 640, "totalReturn": 0.064, "profitFactor": 1.8,
                 "maxDrawdown": -420, "tradeCount": 9, "expectancy": 71, "winRate": 0.52 },
    "assumptions": { "spread": "...", "slippage": "...", "fees": "...", "margin": "..." }
  },
  "marketContext": { "resolved": true, "regimeType": "ranging", "regimeConfidence": 0.5,
                     "lean": "neutral", "note": "Current-regime context only. It is not part of the historical backtest and does not validate it." },
  "conclusion": "Over the tested window and under the stated assumptions, the backtest completed with positive net profit across 9 simulated position(s). This is evidence that the hypothesis merits further research (out-of-sample windows, parameter sensitivity, cost robustness). It is not proof the strategy is viable in live conditions and is not a trading recommendation.",
  "supportsFurtherResearch": true,
  "resolved": true,
  "notATradeRecommendation": true,
  "sources": ["at24-quant-engine", "intelligence-envelope"],
  "citedEvidenceCount": 2, "evidenceGathered": 6, "evidenceIds": ["<backtest>", "<regime>"],
  "disclaimer": "A backtest result is not a trading recommendation. No entry, stop, target, position size or probability of profit is expressed or implied. Historical simulated performance under the engine's own assumptions does not indicate future results. Decision support / research only."
}
```

### 2.2 Three deliberate safety choices in the synthesiser

1. **The raw goal text is never echoed into a scanned string field.** The
   `hypothesis` is reconstructed from structured params (`strategyId`,
   `symbol`, `timeframe`). A goal of *"Should I buy XAUUSD with the golden
   strategy?"* yields a hypothesis about *research*, with no "buy" in it.
2. **Per-trade rows are dropped.** `AlgoTestTradeView.side` is literally
   `"BUY"` / `"SELL"`; copying the `trades[]` array into the output would
   put buy/sell strings in an autonomy-1 agent's conclusion. The brief
   carries **aggregate metrics only** (`tradeCount`, `netProfit`, …).
3. **The brief cites only the evidence it reasons from.** `evidenceIds`
   holds the `backtest` and `regime` rows the conclusion is grounded in —
   not the `news` / cross-asset items the intelligence pipeline gathered
   incidentally. `evidenceGathered` still reports the full count for
   transparency; the whole trace stays queryable. (This also keeps the A6
   referenced-evidence re-validation scoped to rows the two bound tools
   construct with every field set.)

---

## 3. "hypothesis ≠ result ≠ conclusion ≠ recommendation" — how it holds

| distinction | enforcement |
|---|---|
| hypothesis is not a claim it works | reconstructed text says "a research question - not a claim that the strategy is profitable, robust, or should be traded"; test asserts the phrasing and that raw goal text did not leak. |
| backtest result stays a result | `backtestResult` is verbatim aggregate metrics + `resultHash` + `assumptions` from the tool call; it is never rewritten into a directive. A **positive** backtest (`netProfit 640`) still produces `notATradeRecommendation: true` and no trade field — asserted. |
| conclusion is bounded | deterministic branches: positive+trades → "merits further research … not proof … not a trading recommendation"; non-positive → "evidence against prioritising the hypothesis"; failed/empty → "unevaluated; no research conclusion can be drawn". `supportsFurtherResearch` ∈ `true | false | null`. |
| recommendation withheld | autonomy 1 → A6 `forbidden_trading_field` + `forbidden_signal_language` gates run; the proof walks the whole output asserting no `entry/stop/target/size/side/signal/…` key and no `buy/sell/go long/win-rate/probability of profit/guaranteed` text (disclaimer excepted). |

**Behavioural proof of "no auto-promotion":** the positive-backtest E2E
(`netProfit 640`, 9 trades, `profitFactor 1.8`) produces a brief with
**zero** trade-instruction fields and **zero** signal language.

---

## 4. G13 proof — `npm run validate:agent-strategy-research` → **8 passed, 0 failed**

| test | verdict |
|---|---|
| `strategyResearchAgentDefinition()` valid AF-v1 — STRATEGY_RESEARCH, autonomy 1, bound to `backtest.run` + `market.intelligence` only, holds `CAN_RUN_BACKTEST`, no dangerous/signal permission | ✅ |
| bound tools registered; `backtest.run` wraps `algoTestService → at24-quant-engine` (not a rebuild) | ✅ |
| `STRATEGY_RESEARCH → strategyResearchSpecialist`; deterministic plan `backtest.run → market.intelligence`; no LLM; backtest request is bounded (`golden / XAUUSD / 5m`, window ≤ 14 days) | ✅ |
| structural: no new infra dir; the agent file + specialist import no `at24-quant-engine` / `algo-test` / backtest engine / `lib/ai` / executor / `RealTimeIntelligence*` | ✅ |
| **E2E (positive backtest, `netProfit 640`)**: `hypothesis` / `backtestResult` / `marketContext` / `conclusion` are separate, distinct fields; raw "buy" goal text absent from `hypothesis`; `resultHash` surfaced verbatim; **no `trades[]` / `equityCurve[]` in the brief**; `conclusion` says "merits further research" + "not proof / not a trading recommendation"; `supportsFurtherResearch: true`; **`assertNotASignal` passes** (no trade field, no buy/sell language); **A6 integrity PASS + lineage complete**; **A10 evaluation persisted** (`specialist: STRATEGY_RESEARCH`) | ✅ |
| **E2E (non-positive backtest, `netProfit -250`)**: `conclusion` = "evidence against"; `supportsFurtherResearch: false`; still A6 PASS; not a signal | ✅ |
| **E2E (failed backtest, `NO_HISTORICAL_DATA`)**: `resolved: false`; `backtestResult.status: "unusable"`; `conclusion` = "unevaluated"; `supportsFurtherResearch: null`; still A6 PASS | ✅ |
| **E2E (real registry, best-effort)**: `runStrategyResearchAgent({ golden / XAUUSD / 5m })` → clean terminal state either way; plan step persisted; no signal language in any live output. Live run this session: real `backtest.run` → `unusable` (no history for the window) → **graceful `resolved: false`, trace intact** — the deterministic failed-backtest path verified end to end on the real engine | ✅ |

### 4.1 Regression — no gate lost

`validate:agent-contracts` 38/0 · `validate:agent-tools` 20/0 ·
`validate:agent-run-persistence` 17/0 · `validate:agent-runtime` 9/0 ·
`validate:agent-supervisor` 11/0 · `validate:agent-integrity` 21/0 ·
`validate:agent-memory` 19/0 · `validate:agent-authorization` 17/0 ·
`validate:agent-credit` 13/0 · `validate:agent-evaluation` 9/0 ·
`validate:agent-research` 9/0 · `validate:agent-market-intelligence` 8/0 ·
`validate:agent-strategy-research` **8/0**.

**Total: 199 tests, 0 failing.** (was 191 at G12; +8 A13)

---

## 5. TypeScript

`npx tsc --noEmit`: **0 errors** in the new A13 code. Repo-wide the only
errors remain in the stale generated `.next/dev/types/validator.ts`
(gitignored, pre-existing).

---

## 6. Non-goals honoured

- No second backtest engine, no second strategy engine, no execution engine.
- No new runtime / planner / store / migration / module / API route.
- No LLM (the agent file has none; the specialist has none).
- A positive backtest is **never** silently promoted to BUY/SELL / entry /
  stop / target / size / execution / probability-of-profit — A6 enforces it,
  and the synthesiser is written to withhold it explicitly
  (`notATradeRecommendation: true`).

---

## 7. Status

**A13 complete.** The Strategy Research Agent runs one real historical
backtest against the canonical quant engine, attaches current-regime
context, and returns a brief that keeps hypothesis, backtest result,
evidence and research conclusion strictly separate — and never issues a
trading recommendation. Failed, empty and non-positive backtests are handled
deterministically. Every run flows through the same authorization → credit →
integrity → evaluation pipeline as every other agent.

**A1–A13 is the complete initial real-agent framework:**
contracts → tool registry → persistence → resumable runtime → supervisor →
integrity → memory → authorization → credit ledger → evaluation/observability
→ **Research, Market Intelligence and Strategy Research agents**, each a
specialisation of the one runtime.

Next per G12: **A14 — the deliberate regression + security + performance
hardening gate** (not more agent capabilities).

**G13 review requested** — the specialist, the definition, and the 8-test proof.

*End AN1.15.*
