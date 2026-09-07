# AN1.13 — Research Agent (A11)

**Sprint:** AT24 AI Agents — Agent Framework Foundation
**Step:** A11 — Research Agent (first of the three real agents)
**Depends on:** A1–A10 foundation (all gates closed, all four migrations applied + verified)
**Gate:** G11 — review requested
**Migration:** **none** — A11 adds no persistent model.

---

> **A11 adds an agent DEFINITION + a planning/synthesis SPECIALIST + two
> thin tool ADAPTERS over EXISTING AT24 capabilities.** It adds no runtime,
> no planner, no store, no web-search provider. The Research Agent is a
> *specialisation of the one runtime*, exactly as G10 required.

---

## 1. What was built

| File | Role | LOC |
|---|---|---|
| `services/agent-framework/tools/impl/research-knowledge-search.tool.ts` | **NEW tool** `research.knowledge_search` — thin adapter over the EXISTING pgvector Knowledge/RAG stack (`GeminiEmbeddingProvider.embed()` + `RepositoryFactory.vectors().searchSimilar()`), the same search the AI Assistant uses. User-scoped, read-only, `research_document` evidence. | ~130 |
| `services/agent-framework/tools/impl/news-search.tool.ts` | **NEW tool** `news.search` — thin adapter over the EXISTING `AlphaVantageNewsProvider` (the 15D pipeline's news source). `isConfigured()`-gated → honest empty result when no key; never a fabricated headline. `news` evidence. | ~105 |
| `services/agent-framework/supervisor/specialists/research.specialist.ts` | **NEW specialist** `key: "RESEARCH"`. Deterministic plan (`knowledge_search → news.search`), deterministic evidence-first synthesis. NO LLM. | ~120 |
| `services/agent-framework/agents/research-agent.ts` | **NEW** `researchAgentDefinition()` (canonical AF-v1 definition) + `runResearchAgent()` (thin entrypoint onto the shared `AgentRuntime`). | ~110 |
| `scripts/validate-agent-research.ts` | G11 proof — 9 tests. | ~270 |

**Modified (additive only):**

```
services/agent-framework/tools/tool-credit-costs.ts       + research.knowledge_search: 2, news.search: 2   (PLACEHOLDER, per AN1.2 P3)
services/agent-framework/tools/registry-manifest.ts       register the 2 new tools; REGISTERED_TOOL_IDS (6)
services/agent-framework/supervisor/specialist-registry.ts  SPECIALISTS.RESEARCH = researchSpecialist
services/agent-framework/supervisor/index.ts              export researchSpecialist
scripts/validate-agent-tools.ts                           manifest test asserts the 6 registered ids
scripts/validate-agent-supervisor.ts                      "RESEARCH → its specialist"; generic-walk test now uses type "RISK"
package.json                                              + "validate:agent-research"
```

**Not touched:** A4 runtime, A5 Supervisor core, A6 integrity, A7 memory,
A8 authorization, A9 ledger, A10 evaluation, the contract layer, the legacy
agents UI. No schema change. No API route.

---

## 2. The pipeline — unchanged, the agent is a specialisation

```
Goal → Supervisor/Planner → Authorization (A8) → Credit Accounting (A9)
     → Tool Execution → Evidence → Output → Integrity (A6) → Evaluation (A10) → Observability
```

The Research Agent contributes only:
- **an agent definition** (`type: "RESEARCH"`, autonomy 1, 2 bound tools,
  seeded permissions `CAN_RUN_RESEARCH / CAN_READ_NEWS / CAN_USE_MEMORY`);
- **a bounded plan** (`research.knowledge_search` then `news.search`);
- **tool bindings** (the 2 adapters above);
- **domain synthesis** (the evidence-first brief).

Everything else — the resumable `tick()`, the authorization decision, the
credit reserve/reconcile, the integrity gate, the heuristic evaluation — is
the same code every other agent runs.

---

## 3. Evidence-first synthesis — the agent never restates a source

`researchSpecialist.synthesize()` produces a **`research-brief`**:

```jsonc
{
  "kind": "research-brief",
  "question": "...",
  "resolved": true,
  "coverage": "knowledge-backed" | "news-only" | "no-coverage",
  "citationCount": 3, "knowledgeHits": 2, "newsHits": 1,
  "citations": [
    { "evidenceId": "…", "sourceType": "knowledge", "source": "knowledge:kb-1",
      "relevance": 0.82, "confidence": 0.82 }
  ],
  "sources": ["knowledge:kb-1", "Reuters"],
  "evidenceCount": 3,
  "evidenceIds": ["…", "…", "…"],
  "disclaimer": "Evidence-first research brief … no web search … not financial advice or a trade recommendation."
}
```

**A citation is a typed reference to an `AgentEvidence` row — never the
claim text.** The source text stays in the immutable evidence trail where
the A6 integrity gate verifies its lineage back to a registered capability.
This is why the brief passes the A6 `forbidden_signal_language` scan even
when a knowledge chunk or headline contains "buy"/"sell": that text is in
`AgentEvidence.claim` (evidence, not output), and the agent does not copy it
up into its conclusion.

- `resolved` reflects reality: `false` when nothing was found → **no
  fabricated citations, honest "no-coverage"**.
- `coverage` distinguishes a knowledge-backed answer from a news-only one.
- The `disclaimer` field is the one A6-whitelisted place for the
  "decision support, not a recommendation" language.

---

## 4. "Do not invent a new research engine or web-search provider" (G10)

| requirement | how it holds |
|---|---|
| use the existing Knowledge/RAG foundation | `research.knowledge_search` calls `RepositoryFactory.vectors().searchSimilar()` + `GeminiEmbeddingProvider` — the exact stack behind `app/api/private/knowledge/search`. Nothing new. |
| no new web-search provider | `research.web_search` is **not registered** and **not bound**. The agent has exactly 2 tools. Test asserts `registry.get("research.web_search") === undefined`. |
| remain evidence-first | every finding is a citation of an evidence row; `resolved` requires real evidence; A6 enforces lineage. |
| specialisation, not a second framework | the specialist is a planning/reasoning role on the shared runtime; a structural test asserts the new `agents/` folder holds **only** `research-agent.ts` and that no new infra dir was added. |
| no LLM for facts | `researchSpecialist` never imports `lib/ai`; synthesis is deterministic. (The Supervisor's opt-in LLM *plan-assist* is unchanged and still only ever reorders bound tools behind `validateProposedPlan`.) |

---

## 5. G11 proof — `npm run validate:agent-research` → **9 passed, 0 failed**

| test | verdict |
|---|---|
| `researchAgentDefinition()` is valid AF-v1 — RESEARCH type, autonomy 1, 2 bound tools, seeded permissions, no dangerous/signal permission | ✅ |
| agent is NOT bound to `research.web_search`; that tool is NOT registered; the 2 real adapters ARE | ✅ |
| `RESEARCH → researchSpecialist`; deterministic plan `knowledge_search → news.search`; no LLM; query shaped from the goal | ✅ |
| structural: the specialist never imports `lib/ai` or the executor; server-only | ✅ |
| structural: A11 added no new infra dir — `agents/` holds only `research-agent.ts` | ✅ |
| **E2E (fake registry)**: goal → Supervisor → researchSpecialist → `knowledge_search` + `news.search` → `AgentEvidence` → evidence-first brief → **A6 integrity PASS** → **A10 evaluation persisted** (`terminalStatus: succeeded`, 7 dimensions, `specialist: RESEARCH`); every citation resolves to a real evidence row; a citation carries no `claim`/`statement`/`text`; no forbidden trading field / signal language; disclaimer present | ✅ |
| **honest emptiness**: no knowledge + no news → `coverage: "no-coverage"`, `resolved: false`, **0 citations, 0 evidenceIds** — nothing fabricated | ✅ |
| **news-only**: knowledge empty, news present → `coverage: "news-only"`, `resolved: true` | ✅ |
| **E2E (real registry, best-effort)**: `runResearchAgent` on the production registry → clean terminal state either way (`succeeded`, or `tool_error` if an embedding/news provider is absent); plan step persisted; trace intact. Live run this session: reached **`succeeded`, news-only, 5 citations, composite 0.92** | ✅ |

### 5.1 Regression — no gate lost

`validate:agent-contracts` 38/0 · `validate:agent-tools` **20/0** ·
`validate:agent-run-persistence` 17/0 · `validate:agent-runtime` 9/0 ·
`validate:agent-supervisor` **11/0** · `validate:agent-integrity` 21/0 ·
`validate:agent-memory` 19/0 · `validate:agent-authorization` 17/0 ·
`validate:agent-credit` 13/0 · `validate:agent-evaluation` 9/0 ·
`validate:agent-research` **9/0**.

**Total: 183 tests, 0 failing.** (was 174 at G10; +9 A11)

`validate-agent-supervisor.ts` and (implicitly) the runtime/credit suites
were touched only because they had used `type: "RESEARCH"` as a generic
"any valid type" placeholder — now that RESEARCH resolves to a real
specialist, the one selection test was corrected and the generic-walk test
was pointed at `type: "RISK"` (still specialist-less). Behaviour is
unchanged; those suites verify the same properties.

---

## 6. TypeScript

`npx tsc --noEmit`: **0 errors** in the new A11 code. Repo-wide the only
errors remain in the stale generated `.next/dev/types/validator.ts`
(gitignored, pre-existing).

---

## 7. Non-goals honoured

- No new research engine, no web-search provider, no new Knowledge system.
- No new runtime / planner / store / migration.
- No LLM for facts or synthesis.
- The brief is **decision support** — cites evidence, never issues a
  buy/sell/entry/target; A6 enforces this structurally for autonomy < 2.
- No API route, no dashboard UI.

---

## 8. Status

**A11 complete.** The Research Agent is a definition + a specialist + two
thin adapters on the shared A1–A10 runtime. It answers strictly from the
user's own knowledge base and the platform news provider, returns an
evidence-first citation brief, and is honest when it finds nothing. Every
run flows through the same authorization → credit → integrity → evaluation
pipeline as every other agent.

Next per G10: **A12 — Market Intelligence Agent** (orchestrate
`RealTimeIntelligenceService → MarketIntelligencePipelineService`; the
`market.intelligence` tool + `marketIntelligenceSpecialist` already exist —
A12 adds the canonical definition + entrypoint + proof) and **A13 —
Strategy Research Agent**.

**G11 review requested** — the 2 adapters, the specialist, the definition,
and the 9-test proof.

*End AN1.13.*
