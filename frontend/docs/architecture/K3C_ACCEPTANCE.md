# K3C_ACCEPTANCE — Orchestration Hardening & Production Quality Gate

**Sprint:** K3-C — AT24 AI Assistant Knowledge Loop, orchestration-hardening layer
**Branch:** `feat/k3c-orchestration-hardening` (base `origin/main` @ `6253165` — `K3C_DECISION.md` merged)
**Decision:** [`K3C_DECISION.md`](K3C_DECISION.md) (D-K3C-1..10, owner-approved 2026-09-10)
**Contract:** [`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) §12 (K3-C hardening contracts, LOCKED)
**Status:** 🚧 IN PROGRESS — decision merged; contract amendments landed; implementation underway. **No migration. No `ANTHROPIC_API_KEY` in any file/log/commit. No `KnowledgeCandidate`.**

> K3-C closes the K3-B decision boundaries as testable contracts and hardens
> the server-tool + fallback + provenance failure paths. It adds **no
> capability** — reliability and contract closure only. K4 does not start
> until this gate closes.

---

## 0. Headline

```
K3-C STATUS:               IN PROGRESS
Decision (feat/k3c-decision): MERGED  → main 6253165
Contract §12 (LOCKED):     LANDED  (classifier precedence · decision matrix · fallback matrix ·
                                   webSearchFailed⟂webSearchRequestedButUnavailable · server-tool
                                   lifecycle · provenance-integrity+telemetry · injection clause ·
                                   ADR-K3C-1 / ADR-K3C-2)
C1 server-tool hardening:  ...
C2 classifier:             ...
C3 decision matrix:        ...
C4 provenance integrity:   ...
C5 fallback contract:      ...
C6 route/envelope:         ...
C7 adversarial + injection:...
C8 observability:          ...
C9 no new architecture:    ...
Offline suite:             ...
Live production smoke:     ...
MIGRATION:                 NONE
MERGE:                     BLOCKED on owner review of this document
```

---

## 1. Build order (D-K3C-10 — owner-locked)

`contract → tests → implementation → live verification`. Hardening before any
refactor. Every §12 contract row is pinned by an offline assertion.

| Step | Commit | State |
|---|---|---|
| Contract §12 amendments + this skeleton | `d1f147b` | ✅ |
| C1 — `ClaudeProvider` server-tool lifecycle + fixtures | `7132945` | ✅ |
| C2 — classifier precedence + `historical` + borderline + tests | `47d29ee` | ✅ |
| C3 — decision matrix as a pure ordered module + `validate-knowledge-loop-decision-matrix` | (step 4/8) | ✅ |
| C4 — provenance integrity + `validate-knowledge-loop-provenance-integrity` | | ⏳ |
| C5 — orchestrator: wire `decide-path` + two-field split · DYNAMIC guard · continuation fall-through · `SKIPPED` sentinel · telemetry `meta` | | ⏳ |
| C6 — route/envelope regression lock + `validate-knowledge-loop-route-contract` | | ⏳ |
| C7 — knowledge-block injection hardening + `validate-knowledge-loop-adversarial` | | ⏳ |
| C8 — structured telemetry emit + no-raw-content test | | ⏳ |
| Live production smoke + this doc filled | | ⏳ |

---

## 2. Hard boundary — what K3-C does NOT touch

(to be confirmed against `git diff origin/main` at close)

- No `prisma/schema.prisma` change · no migration · no new table
- No `KnowledgeCandidate` / candidate embedding / autonomous learning (K4)
- No `services/intelligence/**` / `AIPresenterOrchestratorService` / market-intel path
- No `services/ai/assistant.service.ts` redesign
- No Support Agent / Automation / UI / credit-billing
- No new AI/search/cache/vector dependency
- `sourceClass` enum **not** renamed (ADR-K3C-1)
- `at24-quant-engine RUNTIME_VERSION` tsc baseline untouched (P4.9)

---

## 3. C1–C9 evidence

### C1 — Claude server-tool lifecycle hardening (step 2/8)

**Files:** `lib/ai/providers/claude.provider.ts` (behaviour), `lib/ai/types.ts`
(5 additive optional response fields), `scripts/validate-knowledge-loop-claude-provider.ts`
(+10 fixtures), `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §12.4/§12.5 (wording
refined so `searchErrors` = operational failures only; an empty-but-valid
result list feeds `webSearchUnavailable`, not `webSearchFailed`).

**What changed (contract §12.5):**

| Change | Before (K3-B) | After (K3-C C1) |
|---|---|---|
| `server_tool_use` counting | every block `+1` | only `name === "web_search"` |
| result accounting | one `searchUnavailable` bool set on *any* error block | `searchRequests` / `searchResultsOk` (non-empty list) / `searchErrors` (error block **or** unrecognised shape) accumulated across `pause_turn` iterations |
| `webSearchUnavailable` | true on any error block | `searchRequests > 0 && searchResultsOk === 0` (all searches errored/empty) |
| `webSearchFailed` *(new)* | — | `searchErrors > 0` — operational fact, independent of the winner; non-Claude slots never set it |
| `webSearchPartialFailure` *(new)* | — | `searchErrors > 0 && searchResultsOk > 0` (diagnostic) |
| malformed `web_search_tool_result.content` | silently ignored | counted as `searchErrors += 1` |
| `pause_turn` exhaustion | loop exits, a paused/placeholder body could be returned as the answer | `continuationBudgetExhausted: true` *(new)* — a soft failure the orchestrator will act on (C5) |
| `continuationCount` *(new)* | — | number of continuation POSTs, for telemetry |
| `stop_reason: "max_tokens"` | returned as a normal completion | `truncated: true` *(new)*, always present on the response |
| `!res.ok` | `"Claude returned HTTP <status>"` | + best-effort Anthropic `error.message` appended; the **request body is never read back or logged** |

`encrypted_content` handling is unchanged — echoed verbatim on continuation,
never decoded/expanded/logged (re-asserted in a fixture).

**`webSearchFailed` ⟂ `webSearchUnavailable` truth table** (locked for the C5 audit):

| Condition | `webSearchFailed` | `webSearchUnavailable` |
|---|---:|---:|
| clean search (≥1 usable result) | `false` | `false` |
| empty-but-valid result list (0 matches) | `false` | `true` |
| single search error | `true` | `true` |
| unrecognised tool-result shape | `true` | `true` |
| mixed OK + error (one usable result) | `true` | **`false`** |
| non-`web_search` `server_tool_use` block | `false` | `false` |

(`webSearchPartialFailure` is `true` only for the mixed row.)

**Intentional K3-B behaviour changes** (all contract-driven, all additive or
strictly-more-correct — no consumer relies on the old behaviour):
1. `webSearchUnavailable` no longer trips on a *partial* failure (mixed ok+error
   turn) — that case is now `webSearchPartialFailure` + `webSearchFailed`, and
   `webSearchUnavailable` stays `false` because a usable result was returned.
2. `truncated` is now always present on every `AICompletionResponse` from
   `ClaudeProvider` (was never emitted). No current consumer reads it; C5 will.
3. A non-`web_search` `server_tool_use` block no longer inflates `searchCount`.

**Assertions:**

| Suite | Count | Result |
|---|---|---|
| `validate-knowledge-loop-claude-provider` — fixtures | 9 existing (K3-B-1) + **10 new (C1)** = 19 | **19/19** |
| — RED-first check | the 10 C1 fixtures failed against the pre-hardening provider, then passed | ✅ |
| Regression — `validate-knowledge-loop-{classifier,websearch-gate,orchestrator,schema,retrieval,cache,freshness,ingestion}` | 14+11+13+19+15+13+8+3 = 96 | **96/96, unchanged** |
| Regression — `validate:ai-presenter-orchestration` | 66 | **66/66, unchanged** |
| `tsc --noEmit` | — | clean (only the pre-existing `at24-quant-engine RUNTIME_VERSION` baseline) |
| `eslint` (`claude.provider.ts`, `types.ts`, the fixture script) | — | clean |

### C2 — Classifier & freshness hardening (step 3/8)

**Files:** `types/knowledge-loop/index.ts` (`AssistantIntent` += `historical`;
`WebSearchGateResult` doc — "OFFER, not prediction"),
`services/knowledge-loop/classifier/classify.ts` (§12.1 precedence numbered +
`HISTORICAL` regex at rule 6 + `historical` → `STATIC`),
`services/knowledge-loop/orchestrator/web-search-gate.ts` (optional
`bestSimilarity` param + the `borderline-sufficient` REQUIRED rule),
`config/knowledge-loop.config.ts` (`BORDERLINE_MARGIN = 0.05` — a GATE
constant, deliberately **not** in `RETRIEVAL_CONFIG_VERSION`, so the K2 cache
key is untouched), `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §12.1 (rule-6
markers synced to the regex), the two validator scripts.

**What changed:**

| Change | Rationale |
|---|---|
| `historical` intent (rule 6) — "back in `<past year>`", "used to …", "what happened to/when …", "historically", "years ago", "the old …" | C2-d — a retrospective question was "correct by accident" (fell to `other`/`conceptual`); now it's an explicit `STATIC` intent, **never web-forced by freshness**. Regex kept tight (a mislabel would suppress web for a current-info question). |
| `borderline-sufficient` gate rule | C2-a — a low-confidence (`intent === "other"`) query whose only hit is barely over the sufficiency floor (`bestSimilarity < RELEVANCE_GOOD + 0.05`) now offers the web as a safety net instead of answering from a marginal hit. |
| `webSearchGate` 3rd arg `bestSimilarity?` | needed for the rule; **optional** → every existing 2-arg call is byte-identical. Orchestrator wiring (`retrieval.bestSimilarity`) is **deferred to C5** (single orchestrator change). |
| "OFFER, not prediction" documented on `WebSearchGateResult.useWebSearch` + a purity test | C2 requirement — the gate says *offer the tool*; whether a search actually happens is the model's call, surfaced later as `webSearchUsed`. |
| §12.1 precedence numbered `1..9` in code comments, pinned by a test | C2-b — a reorder is now a test failure, not a silent semantic change. |

**No LLM classifier** — still a pure, synchronous regex heuristic (asserted).
Expired / superseded knowledge is filtered by K1/K2 eligibility **before** the
orchestrator (the gate never sees it); `STALE` (review-due `PERIODIC`) is a
retrieval-layer signal the gate already forces web on — re-asserted here
(incl. `STALE` overriding the `conceptual + SUFFICIENT` forbid).

**No K3-B behaviour change for any existing input** — every prior classifier
and gate fixture is unchanged; the `historical` intent only re-routes inputs
that previously fell through to `other`/`conceptual`/`product-static`, and the
`borderline-sufficient` rule only fires with a `bestSimilarity` argument that
no current caller passes yet (C5).

**Assertions:**

| Suite | Count | Result |
|---|---|---|
| `validate-knowledge-loop-classifier` | 14 + **10 new (C2)** = 24 | **24/24** |
| `validate-knowledge-loop-websearch-gate` | 11 + **8 new (C2)** = 19 | **19/19** |
| — RED-first check | the 4 `historical` classifier tests + the 1 `borderline-sufficient` gate test failed against the pre-C2 code, then passed; the other new assertions are §12.1/§12.2 **regression locks** (behaviour that already held and must not break) | ✅ |
| Regression — `validate-knowledge-loop-{claude-provider 19, orchestrator 13, schema 19, retrieval 15, cache 13, freshness 8, ingestion 3}` = 90 | | **90/90, unchanged** |
| Regression — `validate:ai-presenter-orchestration` | 66 | **66/66, unchanged** |
| `tsc --noEmit` | — | clean (`RUNTIME_VERSION` baseline only) |
| `eslint` | — | clean |

### C3 — Retrieval/web decision matrix as a pure ordered module (step 4/8)

**Files:** `services/knowledge-loop/orchestrator/decide-path.ts` (**new** — the
matrix), `scripts/validate-knowledge-loop-decision-matrix.ts` (**new** — 25
assertions), `package.json` (+1 script), `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`
§12.2 (records the module + its locked order).

**Why a module:** K3-B expressed the decision as inline `if`s in the
orchestrator. A later edit could reorder them (run the gate before the
account-specific short-circuit) and silently change the contract — an
account-specific question with the word "latest" in it would then be offered
a web search. C3 extracts the decision into one pure, ordered function so the
ordering itself is a locked, tested contract. **It composes `webSearchGate` +
`classify` — it does not re-implement either** (an equivalence test pins that).

`decide-path.ts` exports (all pure, no I/O):
| Export | §12.2 | Purpose |
|---|---|---|
| `decidePreGeneration(classification, retrievalState)` | 1–2 | `{ route: "deterministic-account" \| "generate", webSearchOffered, gateReason, knowledgeCounted }`. **Account-specific is checked BEFORE the gate.** |
| `deriveSourceClass({ webUsed, knowledgeCounted })` | 3 | the 4-way outcome map (`AT24_KNOWLEDGE` / `CLAUDE_REASONING` / `MIXED` / `CLAUDE_WEB_SEARCH`) — never provider identity |
| `liveFiguresGuardApplies({ freshnessNeed, webGrounded, knowledgeGrounded })` | 4 | the DYNAMIC live-figures guard **predicate** — C5 supplies the runtime inputs and applies the deterministic response |

**C3 does NOT wire the orchestrator** — the single integration (import these
three, delete the inline logic, pass `retrieval.bestSimilarity`) is C5.

**Assertions — `validate-knowledge-loop-decision-matrix` = 25/25:**
- 14 matrix rows (account-specific ×2 · historical ×3 · current-info ×2 · conceptual ×2 · other ×3 · no-knowledge ×2) — route + `webSearchOffered`
- **LOCKED ORDER**: account-specific wins over every `{sufficiency × freshness}` combination; a "gate-first" implementation fails these rows (RED-demoed: reverting `decidePreGeneration` to gate-only made **5 assertions fail**, then restored)
- OFFER-not-prediction: pure (identical in → identical out), output has no runtime-search field
- `knowledgeCounted` truth table (SUFFICIENT/LOW + non-empty block → true; INSUFFICIENT/STALE/no-hits/empty-block → false)
- `deriveSourceClass` 4-way map
- `liveFiguresGuardApplies` — true only for DYNAMIC + not-web-grounded + no-knowledge
- **equivalence**: `decidePreGeneration(...).webSearchOffered === webSearchGate(...).useWebSearch` over a sample set (composition, not re-implementation)
- real classifier text → decision (no LLM anywhere in the path)

| Suite | Count | Result |
|---|---|---|
| `validate-knowledge-loop-decision-matrix` *(new)* | 25 | **25/25** (RED-demo: 5 fail on gate-first) |
| Regression — `validate-knowledge-loop-{classifier 24, websearch-gate 19, orchestrator 13, claude-provider 19, schema 19, retrieval 15, cache 13, freshness 8, ingestion 3}` = 133 | | **133/133, unchanged** |
| Regression — `validate:ai-presenter-orchestration` | 66 | **66/66, unchanged** |
| `tsc --noEmit` | — | clean (`RUNTIME_VERSION` baseline only) |
| `eslint` (`decide-path.ts`, the new validator) | — | clean |

**No behaviour change** — `decide-path.ts` is a new, unwired module. The
orchestrator still runs its own inline K3-B logic until C5.

---

## 4. Offline test summary

_(filled at close)_

---

## 5. Live production smoke

_(filled at close — merged-main tree, real Claude web search + real Supabase provenance, mandatory cleanup, zero residue)_

---

## 6. GO / NO-GO

_(filled at close)_

---

## 7. Change log

| Date | Entry |
|---|---|
| 2026-09-10 | K3-C implementation started on `feat/k3c-orchestration-hardening` off `6253165`. **Step 1/8** (`d1f147b`) — Contract §12 (K3-C hardening contracts) landed: classifier precedence + `historical` intent, decision matrix + borderline-sufficient + DYNAMIC live-figures guard, fallback matrix, **`webSearchFailed` ⟂ `webSearchRequestedButUnavailable`**, server-tool lifecycle, provenance-integrity + telemetry, injection clause, ADR-K3C-1/2. |
| 2026-09-10 | **Step 2/8 — C1** `ClaudeProvider` server-tool lifecycle hardening. `server_tool_use` name-filtered; `searchResultsOk`/`searchErrors` accounting; `webSearchFailed` (operational) + `webSearchPartialFailure` surfaced independently of the winner; unrecognised tool-result shapes counted, never silent; `continuationBudgetExhausted` on a still-paused loop exit; `truncated` on `max_tokens`; Anthropic `error.message` surfaced (request body never logged). +10 fixtures (19/19; RED-first verified). Regression 96 + ai-presenter 66 unchanged; tsc clean (RUNTIME_VERSION baseline only); eslint clean. |
| 2026-09-10 | **Step 3/8 — C2** classifier & freshness. §12.1 precedence numbered + LOCKED (reorder = test failure); new `historical` intent (rule 6, tight regex, `STATIC`, never web-forced); `webSearchGate` optional `bestSimilarity` + `borderline-sufficient` rule (§12.2); `WebSearchGateResult` = OFFER not prediction (+ purity test); `BORDERLINE_MARGIN = 0.05` gate constant (NOT in `RETRIEVAL_CONFIG_VERSION`). classifier 14→24, websearch-gate 11→19 (RED-first: 4 `historical` + 1 `borderline` failed pre-C2). Regression 90 + ai-presenter 66 unchanged; tsc clean; eslint clean. Orchestrator wiring of `bestSimilarity` → C5. |
| 2026-09-10 | **Step 4/8 — C3** decision matrix as ONE pure ordered module. `decide-path.ts` (new): `decidePreGeneration` (account-specific short-circuit **before** the gate — a "gate-first" impl fails 5 assertions), `deriveSourceClass` (4-way outcome map, never provider identity), `liveFiguresGuardApplies` (DYNAMIC guard predicate — C5 applies the effect). `validate-knowledge-loop-decision-matrix` (new, 25/25): 14 matrix rows + locked-order + purity + equivalence-with-`webSearchGate` + real-classifier path. Composes `webSearchGate`/`classify`, does not re-implement. NOT wired into the orchestrator (C5). Regression 133 + ai-presenter 66 unchanged; tsc clean; eslint clean. |
