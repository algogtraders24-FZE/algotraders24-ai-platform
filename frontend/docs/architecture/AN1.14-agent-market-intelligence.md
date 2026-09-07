# AN1.14 — Market Intelligence Agent (A12)

**Sprint:** AT24 AI Agents — Agent Framework Foundation
**Step:** A12 — Market Intelligence Agent (second of the three real agents)
**Depends on:** A1–A10 foundation + A5 `marketIntelligenceSpecialist` + A2 `market.intelligence` tool (all closed)
**Gate:** G12 — review requested
**Migration:** **none** — A12 adds no persistent model.

---

> **A12 adds a canonical AgentDefinition + a thin entrypoint. Nothing else.**
> The planning + synthesis specialisation (`marketIntelligenceSpecialist`)
> and the tool (`market.intelligence` → `RealTimeIntelligenceService` →
> `MarketIntelligencePipelineService`) already existed from A5 / A2. A12
> does **not** rebuild the pipeline, add a second regime or signal engine,
> compute a second intelligence score, or emit BUY/SELL.

---

## 1. What was added

| File | Role | LOC |
|---|---|---|
| `services/agent-framework/agents/market-intelligence-agent.ts` | `marketIntelligenceAgentDefinition()` (canonical AF-v1 definition) + `runMarketIntelligenceAgent()` (thin entrypoint onto the shared `AgentRuntime`). | ~115 |
| `scripts/validate-agent-market-intelligence.ts` | G12 proof — 8 tests. | ~250 |

**Modified (additive only):**

```
package.json   + "validate:agent-market-intelligence"
```

**Not touched:** the intelligence pipeline, `marketIntelligenceSpecialist`,
`market.intelligence` / `market.snapshot` tools, A4 runtime, A6 integrity,
A8 authorization, A9 ledger, A10 evaluation, the contract layer, the legacy
agents UI. **No schema change. No API route. No new `services/agent-framework/`
directory or module.**

---

## 2. The agent is a definition over existing machinery

```
Market Intelligence Agent  (definition only)
        │
        ▼
market.snapshot ───────────────┐   (A2 tool, wraps MarketDataService)
        │                      │
        ▼                      │
market.intelligence ───────────┤   (A2 tool, wraps RealTimeIntelligenceService
        │                      │    → MarketIntelligencePipelineService, deterministic, no LLM)
        ▼                      │
  AgentEvidence  ◄─────────────┘
        │
        ▼
marketIntelligenceSpecialist.synthesize()   (A5, deterministic)
   reads envelope.regime.regimeType + envelope.hypotheses
   → bullish-leaning | bearish-leaning | neutral  (a LEAN, never a signal)
        │
        ▼
A6 Integrity  →  A8 authorization / A9 credits were already enforced per tool call
        │
        ▼
A10 Evaluation persisted
```

The agent contributes:
- **an agent definition** — `type: "MARKET_INTELLIGENCE"`, autonomy 1, bound
  to `market.snapshot` + `market.intelligence` **only**, seeded permissions
  `CAN_READ_MARKET_DATA / CAN_READ_NEWS / CAN_USE_MEMORY`, an `outputSchema`
  matching the conclusion shape;
- **a bounded plan** — via the existing specialist (`snapshot → intelligence`);
- **tool bindings** — the 2 existing tools;
- **domain synthesis** — via the existing specialist.

Everything else is the same code every agent runs.

---

## 3. "Orchestrate and explain — do not replace" (G11 lock)

| A12 must NOT | how it holds |
|---|---|
| rebuild the intelligence pipeline | the agent file imports **only** the contract layer, the type registry and the runtime — a structural test asserts it never imports `RealTimeIntelligence*` / `MarketIntelligencePipeline*` / `lib/ai` / a regime engine / the executor. |
| add a second regime / signal engine | synthesis is `marketIntelligenceSpecialist` (A5) — it reads `envelope.regime.regimeType` and echoes it. **Behavioural test:** flip the pipeline's `regimeType` from `trending-bullish` → `trending-bearish` and the conclusion flips with it — there is no independent classification. |
| compute a second intelligence score | the conclusion carries no score field; it relays `regimeConfidence` and `hypothesisCount` from the envelope. |
| emit BUY/SELL / entry / stop / target / size | A6 `forbidden_trading_field` + `forbidden_signal_language` gates run for this autonomy-1 agent; the proof asserts no forbidden key/text in the output (disclaimer excepted). |
| autonomous trade execution | autonomy 1, no `CAN_CREATE_ORDER` / `CAN_EXECUTE_ORDER` / `CAN_GENERATE_SIGNAL`; `LIVE_EXECUTION` double-denied by A8. |
| bypass A8 / A9 / A6 | the run flows through the shared `tick()` — every tool call is authorized (A8) and charged (A9), the output passes the integrity gate (A6) before `succeeded`. |
| add another persistence model | none added. |

The conclusion is a **faithful relay** of the pipeline's own classification
with a decision-support disclaimer — nothing more.

---

## 4. G12 proof — `npm run validate:agent-market-intelligence` → **8 passed, 0 failed**

| test | verdict |
|---|---|
| `marketIntelligenceAgentDefinition()` is valid AF-v1 — MARKET_INTELLIGENCE type, autonomy 1, bound to `market.snapshot` + `market.intelligence` only, no dangerous/signal permission, not bound to `indicators.compute` | ✅ |
| the two bound tools ARE registered; `market.intelligence` wraps the existing `RealTimeIntelligenceService` (not a rebuild) | ✅ |
| `MARKET_INTELLIGENCE → marketIntelligenceSpecialist`; deterministic plan `market.snapshot → market.intelligence`; no LLM | ✅ |
| structural: `agents/` holds only the 2 agent definitions; the agent file imports no pipeline / regime engine / `lib/ai` / executor | ✅ |
| **E2E (fake registry, resolved)**: resolved pipeline context → `bullish-leaning` relay of `trending-bullish` regime + bullish hypotheses; evidence lineage **complete**; **A6 integrity PASS**; **A10 evaluation persisted** (`succeeded`, 7 dimensions, `specialist: MARKET_INTELLIGENCE`); no forbidden trading field / signal language; `disclaimer` contains "Decision support only" | ✅ |
| **behavioural: no second engine** — flip `envelope.regime.regimeType` to `trending-bearish` → conclusion flips to `bearish-leaning` (the agent echoes the pipeline, it does not classify) | ✅ |
| **E2E (fake registry, unresolved)**: `insufficient-data` → `bias: "neutral"`, `resolved: false`, honest `reason`, **still A6 PASS** | ✅ |
| **E2E (real registry, best-effort)**: `runMarketIntelligenceAgent({ symbol: "XAUUSD" })` on the production registry → clean terminal state either way (`succeeded`, or `tool_error` when a provider is absent); plan step persisted; no forbidden signal text in the live output. Live run this session: **`succeeded`, XAUUSD bearish-leaning (regime trending-bearish), 5 evidence, composite 1.0** | ✅ |

### 4.1 Regression — no gate lost

`validate:agent-contracts` 38/0 · `validate:agent-tools` 20/0 ·
`validate:agent-run-persistence` 17/0 · `validate:agent-runtime` 9/0 ·
`validate:agent-supervisor` 11/0 · `validate:agent-integrity` 21/0 ·
`validate:agent-memory` 19/0 · `validate:agent-authorization` 17/0 ·
`validate:agent-credit` 13/0 · `validate:agent-evaluation` 9/0 ·
`validate:agent-research` 9/0 · `validate:agent-market-intelligence` **8/0**.

**Total: 191 tests, 0 failing.** (was 183 at G11; +8 A12)

No existing suite was touched — `marketIntelligenceSpecialist` and its E2E
were already exercised by `validate-agent-supervisor` and
`validate-agent-integrity` since A5/A6.

---

## 5. TypeScript

`npx tsc --noEmit`: **0 errors** in the new A12 code. Repo-wide the only
errors remain in the stale generated `.next/dev/types/validator.ts`
(gitignored, pre-existing).

---

## 6. Non-goals honoured

- No new pipeline / regime engine / signal engine / intelligence score.
- No new runtime / planner / store / migration / module / API route.
- No LLM (the agent file has none; the specialist has none; the Supervisor's
  opt-in plan-assist is unchanged and still only reorders bound tools).
- The conclusion is **decision support** — a regime lean with a disclaimer,
  never a trade instruction; A6 enforces this structurally.

---

## 7. Status

**A12 complete.** The Market Intelligence Agent is a canonical definition +
a thin entrypoint on the shared A1–A10 runtime, reusing the A5
`marketIntelligenceSpecialist` and the A2 `market.intelligence` tool. It
runs the deterministic pipeline, relays its recorded regime + hypotheses as
a bullish / bearish / neutral lean, and is honest when the pipeline cannot
resolve. Every run flows through the same authorization → credit → integrity
→ evaluation pipeline as every other agent.

Next per G11: **A13 — Strategy Research Agent** — orchestrate the existing
strategy / Quant capabilities and evidence (`backtest.run` +
`market.intelligence`), with a strict `research hypothesis / backtest result
/ evidence / conclusion` vs `trading recommendation` distinction.

**G12 review requested** — the definition, the entrypoint, and the 8-test proof.

*End AN1.14.*
