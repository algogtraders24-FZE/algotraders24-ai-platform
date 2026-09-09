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
| C1 — `ClaudeProvider` server-tool lifecycle + fixtures | (step 2/8) | ✅ |
| C2 — classifier precedence + `historical` + borderline + tests | | ⏳ |
| C5 — orchestrator: two-field split · DYNAMIC guard · continuation fall-through · `SKIPPED` sentinel · telemetry `meta` | | ⏳ |
| C7 — knowledge-block injection hardening + `validate-knowledge-loop-adversarial` | | ⏳ |
| C3 / C6 — `validate-knowledge-loop-{decision-matrix,route-contract,provenance-integrity}` | | ⏳ |
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
