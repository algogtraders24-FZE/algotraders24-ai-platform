# K3_ACCEPTANCE — AI Assistant Orchestration (Knowledge-First Gate)

**Sprint:** K3 — AT24 AI Assistant Knowledge Loop, orchestration layer
**Branch:** `feat/k3-orchestration` (base `origin/main` @ `fa5d151`)
**Commits:** `dafae19` (K3-B-1) · `ccb9ccb` (K3-B-2) · `d191bcd` (K3-B-3)
**Depends on / implements:** [`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) (incl. **ADR-K3-M1**, **ADR-K3-M8**) · [`K3_PREFLIGHT.md`](K3_PREFLIGHT.md) · [`K1_DECISION.md`](K1_DECISION.md) SO-1 · [`K1_ACCEPTANCE.md`](K1_ACCEPTANCE.md) · [`K2_ACCEPTANCE.md`](K2_ACCEPTANCE.md) · [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) · [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) §8
**Status:** **K3-B COMPLETE — built, offline-tested, and live-smoked end-to-end against production. Awaiting owner review of this document before merge.** No migration. No `ANTHROPIC_API_KEY` in any file, log, or commit.

> K3 connects the K1/K2 knowledge substrate to the customer-facing AI
> Assistant via a controlled **knowledge-first gate**: retrieval is the FIRST
> intelligence layer (never an optional tool), Claude is the primary provider
> with native web search, the provider fallback chain is preserved, and every
> answer writes a `KnowledgeAnswerProvenance` row. It does **not** build
> candidate governance (K4), the answer cache (K5), analytics finalisation
> (K6), or token streaming (K8), and it does not touch the market-intelligence
> path, the Support Agent, Automation, Quant, Marketplace, or Publishing.

---

## 0. Headline

```
K3-B STATUS:              COMPLETE  (B-1..B-4 + Fix #2)
K3-B-1 provider extension: PASS  — ClaudeProvider native web_search (additive); 9 fixture assertions
K3-B-2 orchestrator:       PASS  — classifier + web-search gate + KnowledgeAnswerOrchestrator
                                   14 + 11 + 13 = 38 offline assertions
K3-B-3 route wiring:       PASS  — knowledge/chat/route.ts: inline RAG+Gemini → orchestrator
K3-B-4 live smoke:         PASS  — 9 (provider/web) + 19 (orchestrator e2e) + 9 (Fix #2 re-verify) = 37 assertions
FIX #2 (usedInAnswer):     PASS  — per-source attribution is now honest (§5.4); owner-required, applied pre-merge
KNOWLEDGE-FIRST:           PASS  — retrieval always runs first; SUFFICIENT → AT24_KNOWLEDGE, no web
PROVIDER CHAIN:            PASS  — Claude → Gemini → OpenAI → deterministic; fall-through verified
NATIVE WEB SEARCH:         PASS  — live: searchCount≥1, citations + encrypted_content carried
PROVENANCE:                PASS  — exactly one KnowledgeAnswerProvenance row per turn; live-verified
INV-1:                     PASS  — orchestrator consumes only KnowledgeService.retrieve()
COMPAT:                    PASS  — market-intel gate untouched; non-stream envelope keys unchanged;
                                   research.knowledge_search unaffected (direct VectorRepository call)
MIGRATION:                 NONE  — KnowledgeAnswerProvenance already exists (K1)
tsc:                       CLEAN  (the lone error is the pre-existing at24-quant-engine RUNTIME_VERSION)
eslint:                    CLEAN
D-ORCH-2 (owner sign-off): RECEIVED  — ANTHROPIC_API_KEY provisioned (Vercel Preview + local);
                                       Anthropic org web search enabled (confirmed live, §5 B2)
MERGE:                     BLOCKED on owner review of this document
```

---

## 1. Hard boundary — what K3-B did NOT touch

Confirmed against `git diff origin/main...feat/k3-orchestration`:

- **No migration.** `prisma/schema.prisma` — only an additive re-export in
  `types/knowledge-loop/index.ts`; `KnowledgeAnswerProvenance` was created in
  K1. `git diff` shows zero schema model changes.
- **No `ANTHROPIC_API_KEY`** in any file, comment, log line, commit message, or
  this document. The key lives only in Vercel env (Preview) and the local
  git-ignored `.env.local`.
- **Market-intelligence path untouched** — `services/intelligence/**`,
  `AIPresenterOrchestratorService`, `GeminiIntelligencePresenter`,
  `IntelligencePresentationService`, its slot order (`gemini → claude →
  openai`), `validateResponseIntegrity`. The K3 gate sits strictly *after* the
  market-intel gate in the route; when the market-intel gate resolves, K3
  never runs.
- **`services/ai/assistant.service.ts`** (client heuristics `needsLiveInfo` /
  `detectSupportedMarketSymbol`) — unchanged.
- **Support Agent / Automation / Quant / Marketplace / Publishing / UI** — no
  reference, no import.
- **K1/K2 retrieval / cache / freshness behaviour** — unchanged. The
  orchestrator calls `KnowledgeService.retrieve()` and nothing else.
- **No `@anthropic-ai/sdk`** — REST kept (SO-1). Dependency count unchanged.
- **No autonomous knowledge promotion** — K3 writes provenance only;
  `candidateCreatedId` is always `null` (ADR-K3-M8).
- **`at24-quant-engine` `RUNTIME_VERSION` tsc error** — left untouched (P4.9).

---

## 2. What K3-B built

### 2.1 `lib/ai` — additive provider extension (K3-B-1, `dafae19`)

| File | Change |
|---|---|
| `lib/ai/types.ts` | `AICompletionRequest` += `tools?: AIToolSpec[]`. `AICompletionResponse` += `webSources?`, `searchCount?`, `stopReason?`, `webSearchUnavailable?`. New `AIWebSearchTool` / `AIToolSpec` / `AIWebSource`. All optional → every existing provider call is byte-identical. |
| `lib/ai/env.ts` | `loadAnthropicEnv()` default model `claude-sonnet-4-5` → **`claude-sonnet-5`** (K3_PREFLIGHT §1.1; owner overrides via `ANTHROPIC_MODEL`). |
| `lib/ai/providers/claude.provider.ts` | When `req.tools` carries a `web_search` spec: body gets `web_search_20250305`; parses `server_tool_use` + `web_search_tool_result` (list → sources; HTTP-200 `{error_code}` object → `webSearchUnavailable`, **never throws**); collects `web_search_result_location` citations + `encrypted_content`; `stop_reason:"pause_turn"` continuation loop (cap 3, paused assistant turn resent verbatim). A call with no `tools` is byte-identical to pre-K3. |

Offline proof: `validate:knowledge-loop-claude-provider` — **9/9** (injected `ClaudeFetch` fixtures, zero network).

### 2.2 `services/knowledge-loop/` — the gate (K3-B-2, `ccb9ccb`)

```
classifier/classify.ts          disclosed heuristic (NO LLM): intent | freshnessNeed |
                                privacyClass | explicitFreshnessRequest. Conservative on ambiguity.
orchestrator/
  ports.ts                      AnswerProviderSlot · RetrievalPort · ProvenanceStorePort
  web-search-gate.ts            pure fn(classification, retrievalSufficiency) →
                                forbidden (sensitive / account-specific / conceptual|policy+SUFFICIENT)
                                vs required (explicit-freshness / DYNAMIC / INSUFFICIENT / STALE)
  providers.ts                  ProviderSlot over lib/ai AIProvider; Claude slot carries web_search,
                                Gemini/OpenAI answer plainly (K3-B v1 — no Gemini googleSearch adapter)
  provenance-store.ts           PrismaProvenanceStore (KnowledgeAnswerProvenance — K3 is the FIRST
                                writer) + InMemoryProvenanceStore
  knowledge-answer-orchestrator.ts
                                answer(turn): classify → retrieve (ALWAYS first, scopes
                                ["assistant","shared"]) → web-search gate → one prompt →
                                chain [claude → gemini → openai → deterministic] →
                                scanForForbiddenLanguage on the winner → deterministic sourceClass →
                                best-effort KnowledgeAnswerProvenance → AnswerResult.
                                account-specific → deterministic pointer, NO LLM, NO retrieval.
  in-memory-adapters.ts         FakeRetrieval + FakeProviderSlot for the validators
  index.ts                      server-only barrel + createKnowledgeAnswerOrchestrator()
config/knowledge-loop.config.ts  += KNOWLEDGE_ANSWER_CONFIG (additive; unread by K1/K2)
```

`sourceClass` derivation (deterministic, contract §8):

| web used | knowledge counted (SUFFICIENT\|LOW + non-empty block) | `sourceClass` |
|---|---|---|
| yes | yes | `MIXED` |
| yes | no | `CLAUDE_WEB_SEARCH` |
| no | yes | `AT24_KNOWLEDGE` |
| no | no | `CLAUDE_REASONING` |
| — | account-specific / chain exhausted | `DETERMINISTIC` |

Per-source `usedInAnswer` (see §5.4 — Fix #2): `AT24_KNOWLEDGE` → knowledge chunks `true`; `MIXED` → knowledge chunks recorded but `false` (no per-chunk attribution); web sources `true` only when Claude actually cited them (`citedTexts` non-empty).

Offline proof:
- `validate:knowledge-loop-classifier` — **14/14**
- `validate:knowledge-loop-websearch-gate` — **11/11**
- `validate:knowledge-loop-orchestrator` — **13/13** (in-memory `KnowledgeService` + fake provider; covers knowledge-first, web fallback, MIXED, **MIXED weak-hit attribution / Rust-MT5 case**, provider fall-through, all-throw → deterministic, forbidden-language → next slot, account-specific → no LLM, retrieval outage absorbed, one-provenance-row-per-turn, best-effort write failure, history window).

### 2.3 `app/api/private/knowledge/chat/route.ts` — one edit (K3-B-3, `d191bcd`)

After the market-intelligence gate, the inline **RAG-embed + `GoogleGenAI`(+`googleSearch`)** block is replaced by `createKnowledgeAnswerOrchestrator().answer(turn)`. Removed dead imports/helpers (`GoogleGenAI`, `GeminiEmbeddingProvider`, `AI_CONFIG`, `buildContext`, `AI_COMMUNICATION_POLICY`, `toGeminiContents`, `RAG_*` constants, the `useSearch` body flag — the classifier now owns that decision).

- Non-stream envelope: existing keys (`content`, `ragApplied`, `sourcesCount`, `sources`, `conversationId`) unchanged for the publishing / trading-copilot / agents callers (verified: `services/ai/assistant.service.ts` reads only optional fields). Additive keys: `webSources` (Claude web citations — shown to end users per Anthropic ToS) + `knowledge` meta.
- NDJSON stream shape unchanged; the answer is emitted as one `token` event (the orchestrator returns complete text — identical to the market-intel branch; true Claude token streaming is K8).
- `AnswerTurn` += optional `knowledgeId` (preserves the route's legacy single-document retrieval scoping).

---

## 3. Contract ↔ code — mismatches resolved

| # | Resolution | Where recorded |
|---|---|---|
| M-1 | Provider chain reuses the slot **pattern** in a new `KnowledgeAnswerOrchestrator`; `AIPresenterOrchestratorService` (envelope-bound, market-intel) is untouched. | **ADR-K3-M1** in `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §7.1 + change log |
| M-8 | Candidate creation deferred entirely to K4; K3-B writes provenance only (`candidateCreatedId` always `null`). | **ADR-K3-M8** in `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §9 + change log |
| — | `account-specific` intent → deterministic pointer, no LLM call (5th `AnswerSourceClass` value `DETERMINISTIC`; the Prisma `sourceClass` column is `String`). | orchestrator + contract §7.2 |
| — | K3-B v1 Gemini fallback = plain `GeminiProvider` (no `googleSearch` adapter). Documented limitation; the Gemini + `googleSearch` adapter is a follow-on. | K3_PREFLIGHT §3 M-7 |

---

## 4. Offline test summary

| Suite | Assertions | Result |
|---|---|---|
| `validate:knowledge-loop-claude-provider` | 9 | PASS |
| `validate:knowledge-loop-classifier` | 14 | PASS |
| `validate:knowledge-loop-websearch-gate` | 11 | PASS |
| `validate:knowledge-loop-orchestrator` | 13 | PASS (+1: Fix #2 regression — §5.4) |
| **K3 total** | **47** | **PASS** |
| Regression: `knowledge-loop-{schema,retrieval,ingestion,cache,freshness}` | 19+15+3+13+8 | PASS (unchanged) |
| Regression: `validate:ai-presenter-orchestration` | 66 | PASS (unchanged) |
| `tsc --noEmit` | — | CLEAN (quant-engine `RUNTIME_VERSION` baseline only) |
| `eslint` (all K3 files + route) | — | CLEAN |

---

## 5. Live smoke (K3-B-4) — production, `ANTHROPIC_API_KEY` from git-ignored `.env.local`

Throwaway scripts (scratch, never committed, deleted after each run), same
temp-data + mandatory-cleanup discipline as K1-F / the K2 gate. Phases 1–2 are
the K3-B-4 run; Phase 5.4 is the Fix #2 re-verification.

### Phase 1 — provider + native web search (no DB) — **9/9**

| ID | Check | Result |
|---|---|---|
| A1 | `ClaudeProvider.complete()` reachable + `x-api-key` auth (model `claude-sonnet-5`) | PASS — `"ok"` in ~3.0 s |
| A2 | `usage` populated (`promptTokens > 0`) | PASS |
| A3 | `stopReason` surfaced (`end_turn`) | PASS |
| B1 | Native web search runs — `searchCount ≥ 1` | PASS (`searchCount = 1`) |
| B2 | `webSources` populated | PASS (8 sources) |
| B3 | not flagged `webSearchUnavailable` — **confirms the Anthropic org has web search enabled (K3_PREFLIGHT §5 E-2 / §8)** | PASS |
| B4 | ≥ 1 citation with `citedTexts` | PASS |
| B5 | `encrypted_content` carried on ≥ 1 source | PASS |
| C1 | bogus model id → typed `AIProviderError` (so the orchestrator chain falls through) | PASS |

### Phase 2 — orchestrator end-to-end vs production — **19/19**

One tagged `assistant`-scope `Knowledge` row (+ chunk + real Gemini embedding) seeded, three `createKnowledgeAnswerOrchestrator().answer()` turns, real `KnowledgeAnswerProvenance` rows read back, then **all tagged rows hard-deleted**.

| ID | Turn | Check | Result |
|---|---|---|---|
| C1–C7 | "Which trading platforms can I use with AT24?" (covered by the seeded row) | `sourceClass = AT24_KNOWLEDGE`; retrieval hit the seeded row; **no web search**; answer names MT5/MT4; `provenanceId` resolves to a real row whose `sourceClass` matches and `knowledgeContributions` is non-empty | PASS |
| D1–D6 | "latest stable version of the Rust language as of today" (no covering knowledge, explicit freshness) | `sourceClass = MIXED` (weak seeded hit + web); **web search ran** (`webSearchUsed = true`, not unavailable); 9 web citations; `integrityPassed`; provenance `webContributions` non-empty + `webSearchUsed = true` | PASS |
| E1–E5 | "When does my subscription renew and what did you last charge my card?" | `sourceClass = DETERMINISTIC`; `providerUsed = deterministic`; **no LLM call, no retrieval, no web**; classified `account-specific`; provenance `privacyClass = user-specific` | PASS |
| Z | cleanup | `provenance = 3`, `retrievalLog = 2`, `retrievalCache = 2`, `chunk = 2`, `knowledge = 2` deleted; **0 K3-smoke rows remain** (re-counted) | PASS |

Post-run independent DB sanity: `0` leftover `Knowledge` / `KnowledgeAnswerProvenance` smoke rows.

### 5.4 Fix #2 — honest per-source `usedInAnswer` attribution (owner-required, applied pre-merge)

**Finding (from Phase 2 test D):** the seeded MT5/MT4 knowledge row was a *weak* retrieval hit (similarity just over the `RELEVANCE_MIN` floor) for a Rust-language question. The turn resolved `MIXED`, and the orchestrator marked **every** retrieved knowledge chunk `usedInAnswer: true` purely because `sourceClass ∈ {AT24_KNOWLEDGE, MIXED}` — even though Claude's answer explicitly said the knowledge was "outside AT24's scope". That is false source-level attribution in the provenance/evidence record — the exact class of defect K0–K3 exist to prevent.

**Fix** (`knowledge-answer-orchestrator.ts`, ~6 lines + comment):
- `AT24_KNOWLEDGE` → knowledge chunks `usedInAnswer: true` (the retrieved Knowledge *is* the answer — defensible).
- `MIXED` → knowledge chunks are still **recorded** (`knowledgeId`, `chunkId`, `chunkIndex`, `similarity`, `snippet` — full evidence trail) but `usedInAnswer: false`. We have **no** per-chunk signal that any given chunk was used; we do not guess. Real per-source attribution needs an LLM-attributed answer (K4/K6).
- `CLAUDE_REASONING` / `CLAUDE_WEB_SEARCH` → no knowledge used → `false`.
- Web sources carry Claude's own `citations`, so a web source is `usedInAnswer: true` **only when actually cited** (`citedTexts` non-empty); a retrieved-but-uncited search result is `false`.

No change to `sourceClass` derivation, the provider chain, the gate, or the route. `webSearchUsed` (a turn-level fact) is unchanged.

**Regression coverage added** — `validate:knowledge-loop-orchestrator` (now 13/13):
- `MIXED` → knowledge chunk `usedInAnswer === false`, `knowledgeId`/`similarity` preserved, provenance row carries the honest value.
- New test **"MIXED with a weak, irrelevant knowledge hit → chunk NOT marked used (Rust/MT5 case)"** — reproduces the exact live finding: weak MT5 hit + web answer → chunk recorded, `usedInAnswer: false`; cited web source `true`, uncited web source `false`.

**Live re-verification vs production — 9/9** (throwaway script, deleted; same seed+cleanup discipline):

| ID | Check | Result |
|---|---|---|
| K1–K3 | "Which platforms can I use with AT24?" → `AT24_KNOWLEDGE`; persisted `knowledgeContributions[].usedInAnswer === true` | PASS |
| M1–M3 | "latest stable Rust version as of today" → `MIXED`; persisted `knowledgeContributions` non-empty, **every** entry `usedInAnswer === false`, `knowledgeId` + `similarity` preserved | PASS |
| M4–M5 | `MIXED`: ≥ 1 web contribution; cited web contributions `usedInAnswer === true` | PASS |
| Z | cleanup — `0` K3-smoke rows remain | PASS |

### Cost

| Run | Web searches | Tokens | Est. cost |
|---|---|---|---|
| Phase 1 | 1 | ~12.9k in / ~140 out | ~$0.04 |
| Phase 2 | 1 | (chat-sized) | ~$0.02 |
| Fix #2 re-verify | 1 | (chat-sized) | ~$0.02 |
| **Total** | **3** | — | **< $0.12** |

`$10 / 1,000` web-search math confirmed against `usage.server_tool_use.web_search_requests`. `WEB_SEARCH_MAX_USES = 4`, the gate forbids search on conceptual/SUFFICIENT turns, and `HISTORY_TURNS_MAX = 8` caps carried context — cost controls in place for beta.

---

## 6. GO / NO-GO

### K3-B — ✅ COMPLETE

Built, offline-tested (47 K3 assertions + full regression green), and
live-smoked end-to-end against production (28 + 9 Fix #2 re-verify = 37
assertions, all cleanup verified). Every objective from the K3 brief is met:

1. Claude primary provider — ✅ (chain `Claude → Gemini → OpenAI → deterministic`)
2. Claude native `web_search` — ✅ (live: citations + `encrypted_content`, org enabled)
3. Knowledge-first precedence — ✅ (retrieval is the first layer, always; proven offline + live C1–C7)
4. Market-intelligence gate compatibility — ✅ (K3 sits strictly after it, untouched)
5. Deterministic heuristic classifier — ✅ (no LLM)
6. Provider fallback preserved — ✅ (fall-through proven offline + live)
7. Always-on `KnowledgeAnswerProvenance` — ✅ (one row/turn, live-verified)
8. Candidate proposal — deferred to K4 (ADR-K3-M8), provenance only in K3 — ✅
9. No autonomous promotion — ✅ (`candidateCreatedId` always `null`)
10. No Support Agent contamination — ✅ (scopes `["assistant","shared"]`; Support uses `["support","shared"]`)
11. No duplication of the knowledge foundation — ✅ (consumes `KnowledgeService.retrieve()` only)
12. Existing Assistant behaviour preserved outside the gate — ✅ (envelope keys unchanged; `research.knowledge_search` unaffected)

### MERGE — ⛔ BLOCKED on owner review of this document

Once approved: rebase `feat/k3-orchestration` on latest `origin/main`, merge
(4 commits + Fix #2 commit, no squash needed), then **K3 operationally
complete → K4 unlocked**.

### Known imprecisions (disclosed; not merge blockers per owner)

- **`sourceClass` enum label vs winning provider** — when Gemini/OpenAI is the
  winner, `sourceClass` still reads `CLAUDE_REASONING` / `CLAUDE_WEB_SEARCH`
  (K0's enum names). `providerUsed` is authoritative and records the real
  slot. Owner decision: fix in the next cleanup contract, not K3-B — a future
  enum such as `WEB_SEARCH | AT24_KNOWLEDGE | MIXED | MODEL_REASONING |
  DETERMINISTIC` separates *provenance source class* from *provider identity*.
- **Classifier heuristic** — a current-info query with no freshness trigger
  word, classified `conceptual`/`other`, that also gets a `SUFFICIENT`
  retrieval from a stale hit, can have web search suppressed. Mitigated by the
  freshness sweep (`STALE`/auto-deprecate) and by `INSUFFICIENT`/`STALE`/
  non-sufficient still forcing web. Disclosed heuristic (contract §3),
  swappable for an LLM classifier behind the same signature. Acceptable for v1.
- **`webSearchUnavailable`** — if Claude's web search is org-disabled/rate-
  limited on a current-info turn, the answer falls back to Claude's own
  knowledge (never fabricated), flagged `webSearchRequestedButUnavailable` on
  the result + provenance, but **not** re-grounded via Gemini+`googleSearch`
  (no adapter in v1). Accepted for v1.

### Deferred (by design, not gaps)

Gemini + `googleSearch` fallback adapter · token-by-token Claude streaming (K8)
· candidate creation + admin queue (K4) · answer cache (K5) · analytics-event
finalisation (K6) · any market-intel chain re-ordering.

---

## 7. Change log

| Date | Entry |
|---|---|
| 2026-09-09 | K3-B-1..B-4 complete. Additive `ClaudeProvider` web search + `KnowledgeAnswerOrchestrator` (classifier + web-search gate + provider chain + provenance) + `knowledge/chat/route.ts` wiring. 46 offline K3 assertions + full regression green; tsc/eslint clean. Live smoke vs production: 9 (provider/web search — **org web search confirmed enabled**) + 19 (orchestrator e2e — knowledge-first, web fallback, account-specific, provenance rows) = 28 assertions, all cleanup verified (0 rows remain), total cost < $0.10. ADR-K3-M1 + ADR-K3-M8 recorded. **K3-B COMPLETE — awaiting owner review before merge.** |
| 2026-09-10 | **Fix #2 (owner-required, pre-merge)** — honest per-source `usedInAnswer` attribution (§5.4). `MIXED` no longer marks every retrieved chunk as used; retrieved chunks are still recorded with full metadata but `usedInAnswer: false` (no per-chunk attribution signal exists). Web sources `usedInAnswer` grounded in Claude's own citations (`citedTexts`). +1 orchestrator regression test (the Rust/weak-MT5 case) → offline K3 total **47**; live re-verification vs production **9/9** (`AT24_KNOWLEDGE` keeps `usedInAnswer: true`; `MIXED` persists `false` with the evidence trail intact), cleanup verified. Two other imprecisions (`sourceClass` enum label, classifier freshness edge) disclosed as non-blockers per owner. **K3-B COMPLETE + Fix #2 — awaiting explicit MERGE GO.** |
