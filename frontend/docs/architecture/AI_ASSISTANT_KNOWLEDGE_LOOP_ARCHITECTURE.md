# K0.1 — AI Assistant Knowledge Loop: Architecture

**Sprint:** K0 — AT24 AI Assistant Knowledge Loop (R&D + Architecture + Contract Lock)
**Stage:** Architecture lock — precedes K1 implementation
**Inputs:** K0 sprint brief; codebase audit (this document, §9); AN1.2 (agent framework locked decisions); AN1.9 (memory governance precedent); `AI_RESPONSE_GUIDELINES.md`
**Status:** PROPOSED — see [`K0_DECISION.md`](K0_DECISION.md) for the GO/NO-GO and the pending owner sign-offs
**Companion contracts:** [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) · [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) · [`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) · [`KNOWLEDGE_GOVERNANCE_CONTRACT.md`](KNOWLEDGE_GOVERNANCE_CONTRACT.md) · [`KNOWLEDGE_ANALYTICS_CONTRACT.md`](KNOWLEDGE_ANALYTICS_CONTRACT.md)

> This document is the single architectural source of truth for the Knowledge
> Loop. A change to a locked decision requires a new dated ADR entry in
> `K0_DECISION.md`, never an inline code choice.

---

## 0. Core principle (LOCKED)

> **The Knowledge Loop is an orchestration + retrieval + governance layer over
> the existing AT24 Knowledge/RAG stack, the existing `lib/ai` provider layer,
> and the existing analytics/audit infrastructure. It does not rebuild any of
> them. It makes the AI Assistant measurably better over time through
> *human-verified* knowledge — never through uncontrolled self-training.**

Concretely:

- Retrieval reuses the existing pgvector store (`KnowledgeChunk.embedding`,
  `vector(768)`, HNSW cosine) accessed only through `VectorRepository`.
- Embeddings reuse `GeminiEmbeddingProvider` (`gemini-embedding-001`, 768-d
  via MRL). No new embedding provider, no new vector database.
- Reasoning reuses the `lib/ai` `AIProvider` interface. Claude becomes the
  preferred provider; the existing multi-model fallback chain is preserved.
- Governance reuses `AuditLog`, `requireAdmin` / `assertRole("admin")`, and
  the **exact `pending_approval` → `approvePending(recordId, approver)`
  pattern already proven in `MemoryGateway` (AN1.9)**.
- Analytics reuses `AnalyticsEvent` + `AnalyticsEventService` and the
  append-only `RequestLog` shape.

Rationale: AT24's differentiator is verifiable, evidence-backed intelligence.
A knowledge loop that let unreviewed user conversations become authoritative
knowledge would fork the truth and is strictly worse than none.

The system is optimised, in order, for: **correctness → traceability →
governance → low latency → low cost → beta readiness.**

---

## 1. Precedence — the target flow (LOCKED)

```
User Query
  │
  ▼
Query Classification / Intent  ─────────────────────────┐
  │                                                     │ (freshness class,
  ▼                                                     │  privacy class,
AT24 Knowledge Retrieval  (Priority 1)                  │  instrument resolution)
  │                                                     │
  ▼                                                     │
Relevant verified knowledge above threshold?            │
  ├── YES ──▶ Claude reasoning over retrieved knowledge (Priority 2) ──▶ Answer
  │                                                     │
  └── NO / INSUFFICIENT / STALE / CONTRADICTORY ────────┘
        │
        ▼
   External / current info required?
        ├── YES ──▶ Claude Native Web Search (Priority 3) ──▶ Claude reasoning ──▶ Answer
        └── NO  ──▶ Claude reasoning without proprietary knowledge (Priority 4) ──▶ Answer
        │
        ▼
   Provenance record written (always)
        │
        ▼
   Candidate worth preserving?
        ├── NO
        └── YES ──▶ Knowledge Candidate (status: candidate)
                         │
                         ▼
                    Admin Review  (governance)
                         ├── Reject ──▶ status: rejected  (retained, never retrieved)
                         └── Approve ──▶ Knowledge (status: active) ──▶ chunk + embed ──▶ future retrieval
```

**"Knowledge first" does NOT mean "always answer from knowledge."** If
retrieved AT24 knowledge is insufficient, stale, contradictory, or below the
configured relevance threshold, orchestration MUST be free to continue to
web search and/or general reasoning. The precedence is about *which source
wins when both are valid*, not about suppressing the others.

The precedence contract:

| Priority | Source | When |
|---|---|---|
| 1 | AT24 approved proprietary knowledge (`status = active`) | Always retrieved first |
| 2 | Claude reasoning **using** retrieved AT24 knowledge | Retrieval produced ≥1 hit ≥ `RELEVANCE_MIN` and not stale/contradictory |
| 3 | Claude Native Web Search | Current/external info required, OR knowledge insufficient/stale/absent |
| 4 | Claude reasoning **without** proprietary knowledge | No knowledge, no web need — a purely conceptual question |

The system MUST NOT silently treat web-search results as permanent AT24
knowledge. Web-derived information can become a Candidate, but requires
governance before promotion.

---

## 2. Logical components

All new server code lives under `services/knowledge-loop/` and
`app/api/private/knowledge-loop/**` and `app/api/private/admin/knowledge-loop/**`.
The existing `services/knowledge/*`, `services/ai/*`, and the
`app/api/private/knowledge/*` routes are extended, not forked (§9.4 lists the
precise touch points).

### A. AI Assistant Orchestrator — `services/knowledge-loop/orchestrator/`

The single entry point a chat turn goes through. Responsibilities:

1. Receive the user query + conversation context.
2. Classify intent / freshness class / privacy class; resolve any instrument
   (delegates to the existing `services/intelligence/query` resolver —
   unchanged).
3. Query the Knowledge Service (Priority 1).
4. Evaluate retrieval confidence / relevance / freshness / conflict.
5. Decide whether web search is required (Priority 3 gate).
6. Construct the Claude context (system policy + retrieved knowledge block +
   conversation history + web-search tool enablement flag).
7. Generate the final answer via the `lib/ai` provider chain (Claude
   preferred).
8. Record the **Answer Provenance** record (always).
9. Emit analytics events.
10. Optionally create a **Knowledge Candidate**.

The orchestrator never computes market facts and never mutates knowledge.
It is a composition layer.

> **Boundary with the existing real-time intelligence path.** The
> `knowledge/chat` route already delegates a *resolved-instrument* market
> question to `IntelligencePresentationService` (D2.6.9). That path is
> unchanged and takes precedence over the Knowledge Loop for market-fact
> questions — the Knowledge Loop orchestrator runs for every *other* turn
> (product/platform/support/conceptual/how-to). §9.4 defines the gate.

### B. AT24 Knowledge Service — `services/knowledge-loop/knowledge/`

Owns the knowledge store. Responsibilities: storage, semantic retrieval
(via `VectorRepository`), metadata filtering, versioning, lifecycle state,
freshness metadata, provenance, duplicate detection, deprecation, retrieval
logging. Backed by the **existing `Knowledge` + `KnowledgeChunk` models**
plus additive columns (see [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) §3).

### C. Knowledge Candidate Service — `services/knowledge-loop/candidate/`

Owns candidate lifecycle: creation, deduplication (embedding-similarity
against active knowledge and other open candidates), status, evidence/source
tracking, confidence, and the admin review workflow. Backed by a **new
`KnowledgeCandidate` model** — deliberately separate from `Knowledge` so an
unreviewed row can never be reached by the retriever (defense in depth,
mirroring AN1.9's "pending memory is never surfaced").

### D. Knowledge Governance — `services/knowledge-loop/governance/`

Owns approval, rejection, deferral, deprecation, versioning, and the audit
trail. Every state transition writes an immutable `AuditLog` row. Reviewer
identity comes from the verified admin session, never from a request body.
Reuses `requireAdmin`. See [`KNOWLEDGE_GOVERNANCE_CONTRACT.md`](KNOWLEDGE_GOVERNANCE_CONTRACT.md).

### E. Cache Layer — `services/knowledge-loop/cache/`

Two distinct caches (see [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) §7):

- **Retrieval Cache** — caches `query-embedding-hash → chunk-id list + scores`.
  Best-effort, short TTL, in-process (`TtlCache`) for beta; a shared store is
  a post-beta upgrade.
- **Answer Cache** — caches final answers **only when safe**. Backed by a new
  `KnowledgeAnswerCache` Postgres table (there is no shared KV store on the
  current Vercel plan — §9.3). Keyed by normalized-query hash **+ a
  knowledge-version fingerprint**; invalidated on any knowledge
  approve/deprecate/version change. Never used for dynamic, user-specific,
  financial/account, or market answers.

### F. Analytics Layer — `services/knowledge-loop/analytics/`

Records the canonical events (see [`KNOWLEDGE_ANALYTICS_CONTRACT.md`](KNOWLEDGE_ANALYTICS_CONTRACT.md)):
`KNOWLEDGE_QUERY`, `KNOWLEDGE_HIT`, `KNOWLEDGE_MISS`, `KNOWLEDGE_LOW_RELEVANCE`,
`WEB_SEARCH_FALLBACK`, `ANSWER_GENERATED`, `KNOWLEDGE_CANDIDATE_CREATED`,
`KNOWLEDGE_CANDIDATE_REVIEWED`, `KNOWLEDGE_APPROVED`, `KNOWLEDGE_REJECTED`,
`KNOWLEDGE_DEPRECATED`, `KNOWLEDGE_CONFLICT`, `CACHE_HIT`, `CACHE_MISS`.
Reuses `AnalyticsEvent` for lifecycle/funnel events; adds an append-only
`KnowledgeRetrievalLog` table (mirror of `RequestLog`) for per-retrieval
quality metrics that need structured columns.

---

## 3. System architecture (data flow)

```
                          ┌───────────────────────────────────────────────┐
                          │   Chat UI  /  Assistant panel  /  Support UI   │
                          └───────────────────────┬───────────────────────┘
                                                  │  POST /api/private/knowledge/chat
                                                  ▼
             ┌───────────────────────────────────────────────────────────────────┐
             │  Route handler (existing, extended)                                │
             │  · session auth (getUserOrNull)   · Conversation/Message persist   │
             │  · resolved-instrument market question ─────▶ IntelligencePresentation (unchanged)
             │  · everything else ────────────────────────▶ Knowledge Loop Orchestrator (A)
             └───────────────────────────────┬───────────────────────────────────┘
                                             ▼
        ┌────────────────────────────────────────────────────────────────────────────┐
        │  A. AI Assistant Orchestrator                                               │
        │                                                                            │
        │  1 classify(query, ctx) ──▶ { intent, freshnessClass, privacyClass }        │
        │  2 Knowledge Service (B).retrieve(query, filters) ───────────┐              │
        │       ▲ Retrieval Cache (E)                                  │              │
        │       └── VectorRepository.searchSimilar (pgvector 768, HNSW)│              │
        │  3 evaluate(hits) ──▶ { sufficient?, stale?, conflict? }     │              │
        │  4 webSearchGate(intent, freshnessClass, sufficiency)        │              │
        │  5 buildClaudeContext(policy, knowledgeBlock, history, webSearchEnabled)    │
        │  6 lib/ai provider chain: Claude ▶ (Gemini ▶ OpenAI ▶ deterministic)        │
        │       └── Claude Messages API + web_search server tool (Priority 3)         │
        │  7 integrity check (validateResponseIntegrity-style)                        │
        │  8 write AnswerProvenance  ─────────────────────────────────▶ KnowledgeAnswerProvenance
        │  9 analytics (F) ──────────────────────────────────────────▶ AnalyticsEvent / KnowledgeRetrievalLog
        │  10 maybe Candidate Service (C).propose(...)  ─────────────▶ KnowledgeCandidate (status: candidate)
        └────────────────────────────────────────────────────────────────────────────┘
                                             │
                     Answer Cache (E) write, iff privacyClass=public & freshnessClass=STATIC & no web state dependency
                                             ▼
                                        Answer + sources → UI


        ┌──────────────────────── Admin plane (separate) ────────────────────────┐
        │  /api/private/admin/knowledge-loop/candidates            (requireAdmin) │
        │    list · get · edit proposed answer · approve · reject · defer        │
        │  /api/private/admin/knowledge-loop/knowledge                            │
        │    list · deprecate · view versions · view provenance                  │
        │                                                                        │
        │  D. Governance                                                          │
        │    approve(candidateId, admin)  ──▶ Knowledge Service.publish()         │
        │        · create Knowledge (status: active, version 1)                   │
        │        · IngestionService.ingest() → chunks + embeddings               │
        │        · AuditLog row (KNOWLEDGE_APPROVED)                              │
        │        · Answer Cache invalidation (version fingerprint bump)          │
        │    reject(candidateId, admin, reason) ──▶ status: rejected + AuditLog   │
        │    deprecate(knowledgeId, admin) ──▶ status: deprecated + AuditLog      │
        └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Retrieval flow (detail)

See [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) for the full contract.

```
query
  ▼ normalize (trim, collapse whitespace, lowercase for cache key only)
  ▼ Retrieval Cache lookup  (key = sha256(normalizedQuery | scopeFilter | knowledgeVersionFingerprint))
      HIT  ──▶ return cached chunk-id list → hydrate rows → done
      MISS ▼
  ▼ GeminiEmbeddingProvider.embed(query)          (768-d, normalized)
  ▼ VectorRepository.searchSimilar({ embedding, topK = RETRIEVE_TOP_K (default 12), scope filter })
  ▼ metadata filter:  status = active  ·  scope ∈ {assistant, shared}  ·  visibility allows caller  ·  not expired
  ▼ relevance scoring:  similarity (1 − cosine distance)   ·   drop < RELEVANCE_MIN (0.30)
  ▼ freshness weighting:  DYNAMIC knowledge past its freshness window is demoted / flagged stale
  ▼ source-authority weighting:  admin-authored > support-resolution > verified-Q&A > web-derived
  ▼ duplicate suppression:  collapse near-identical chunks (same knowledgeId, or cosine > 0.97)
  ▼ optional rerank:  NOT in beta (Decision D-RETR-4) — top-K by weighted score is used directly
  ▼ context selection:  take rows until CONTEXT_CHAR_BUDGET (6000) — same budget the chat route uses today
  ▼ Retrieval Cache write (short TTL)
  ▼ KnowledgeRetrievalLog append  +  KNOWLEDGE_HIT / KNOWLEDGE_MISS / KNOWLEDGE_LOW_RELEVANCE event
```

---

## 5. Fallback flow (web search boundary)

```
webSearchGate(intent, freshnessClass, knowledgeSufficiency):
  REQUIRE web search when ANY of:
    · intent = "current-info"  (explicit "latest / today / now / news / current price")
    · freshnessClass ∈ {DYNAMIC}  AND  question asks for the dynamic value
    · knowledgeSufficiency = INSUFFICIENT  (0 hits ≥ RELEVANCE_MIN)
    · knowledgeSufficiency = STALE  (best hit is DYNAMIC and past its freshness window)
    · retrieved knowledge is CONTRADICTORY and unresolved
  FORBID web search when ALL of:
    · intent = "conceptual" or "product-static"
    · knowledgeSufficiency = SUFFICIENT
  (errs toward enabling search when uncertain — same disclosed-heuristic
   spirit as today's `needsLiveInfo()` in services/ai/assistant.service.ts)
```

Web search executes via **Claude's native `web_search` server tool** (Anthropic
Messages API), not a separate search vendor. No Tavily / Exa / Brave is
introduced (sprint §24). Every web result that informs the answer is captured
in the Answer Provenance record with: source URL, source title, source domain,
retrieval timestamp, relevant excerpt, and Claude's own relevance signal.

Web information NEVER auto-writes to knowledge. It may become a Candidate
(source type `web-researched`), which then requires governance.

---

## 6. Candidate flow

```
Orchestrator.maybeProposeCandidate(turn):
  eligible when ANY of:
    · turn was answered with web-search + reasoning AND had 0 knowledge hits
      AND intent is "product/platform/support/how-to" (not market/dynamic)
    · a high-value unanswered question was detected (no confident answer given)
    · an admin/support user explicitly flags "save this answer"
    · a correction was applied to a prior assistant answer in-thread
  NOT eligible when:
    · privacyClass ≠ public  (contains user-specific / account / PII content)
    · freshnessClass = DYNAMIC  (market values, live prices, current availability)
    · the answer failed the integrity check
  ▼
  dedup: embed(proposedAnswer OR canonicalQuestion) → cosine vs active Knowledge
         and open Candidates
     · > DUP_HARD (0.94)  → attach as "duplicate-of", do not create a new candidate
     · > DUP_SOFT (0.85)  → create candidate with duplicateOfId + similarity recorded
     · else               → create candidate
  ▼
  KnowledgeCandidate row  (status: candidate)
     originatingConversationId, originatingMessageId, canonicalQuestion,
     proposedAnswer, sourceType, evidence[] (knowledge chunk ids + web sources),
     confidence, reasonForCandidate, duplicateOfId?, similarityScore?
  ▼
  KNOWLEDGE_CANDIDATE_CREATED event
```

Candidate creation is **best-effort and never blocks the user's answer**
(same convention as every other analytics/persistence write in the chat route).

---

## 7. Approval flow

```
Admin opens /dashboard/admin/knowledge-loop/candidates
  ▼ list: open candidates, newest first, with duplicate/similar knowledge shown inline
  ▼ admin selects a candidate → sees:
      · originating conversation (read-only)
      · proposed answer (editable)
      · evidence / sources (knowledge chunks + web URLs, each opens)
      · dedup: "similar to Knowledge #X (0.88)"
      · freshness class + privacy scan result
  ▼ admin action:
      APPROVE (with optional edits):
        Governance.approve(candidateId, adminId, editedAnswer?):
          1 create Knowledge { status: active, version: 1, scope, visibility,
              freshnessClass, source: "candidate:<id>", approvedBy, approvedAt }
          2 IngestionService.ingest({ knowledgeId, text: canonicalAnswer })
              → KnowledgeChunk rows + embeddings (existing pipeline, unchanged)
          3 candidate.status = under_review → active-linked; finalKnowledgeId set
          4 AuditLog { action: "knowledge.approve", targetType: "KnowledgeCandidate",
              targetId, metadata: { knowledgeId, before: candidate snapshot, after } }
          5 KNOWLEDGE_APPROVED event
          6 Answer Cache: bump knowledgeVersionFingerprint → all cached answers invalidated lazily
      REJECT:
        Governance.reject(candidateId, adminId, reason):
          candidate.status = rejected; AuditLog; KNOWLEDGE_REJECTED event
          (row retained forever; NEVER retrievable as knowledge)
      DEFER:
        candidate.status = under_review; assignedReviewer/notes; no knowledge change
      DEPRECATE RELATED:
        Governance.deprecate(knowledgeId, adminId): status = deprecated;
          removed from retrieval on next query; AuditLog; KNOWLEDGE_DEPRECATED event
```

Approval is **always explicit** and always by a real admin id from the verified
session. There is no auto-approval path, no confidence threshold that
promotes a candidate without a human, and no agent may call `approve`
(identical rule to AN1.9 `approvePending`).

---

## 8. Cache flow

```
ANSWER CACHE  (only for safe answers)
  read:
    key = sha256( normalizedQuery | callerScope | knowledgeVersionFingerprint )
    SELECT ... FROM "KnowledgeAnswerCache" WHERE key = $1 AND expiresAt > now()
      HIT  → CACHE_HIT event → return stored answer + stored sources (marked cached)
      MISS → CACHE_MISS event → continue to orchestration
  write (post-answer), iff ALL:
    · privacyClass = public
    · freshnessClass = STATIC
    · no web_search was used in this turn (answer must not depend on current web state)
    · integrity check passed
    · answer source = AT24_KNOWLEDGE or MIXED (never a pure web answer)
  invalidation:
    · TTL (ANSWER_CACHE_TTL, default 24h)
    · knowledgeVersionFingerprint change (any approve / deprecate / version bump)
      → old keys can never match; no explicit delete needed (lazy invalidation)
    · manual admin "flush answer cache" action (governance)

RETRIEVAL CACHE  (in-process, best-effort)
  · TtlCache<string, {chunkIds, scores}>  keyed like the answer cache
  · TTL = RETRIEVAL_CACHE_TTL (default 10 min)
  · lost on cold start — acceptable; it is a latency optimisation, not a source of truth
  · same knowledgeVersionFingerprint in the key → stale entries self-expire on version change
```

The `knowledgeVersionFingerprint` is a cheap monotonic value (e.g.
`MAX(updatedAt)` across `Knowledge WHERE status = active`, or a dedicated
counter row bumped in the same transaction as every lifecycle transition).
See [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) §7.4.

---

## 9. Existing infrastructure audit (reuse map)

### 9.1 What already exists and is reused as-is

| Capability | Where | Reuse |
|---|---|---|
| Vector store | `KnowledgeChunk.embedding vector(768)`, HNSW `vector_cosine_ops` index (`20260720000000_add_knowledge_chunk_and_pgvector`) | **Yes, unchanged.** All vector SQL stays in `VectorRepository`. |
| Vector search | `VectorRepository.searchSimilar()` — parameterized raw SQL, `1 - (embedding <=> $1::vector)` similarity, `userId`/`knowledgeId` filters, `MAX_TOP_K = 100` | **Yes**, add a `scope`/`visibility` filter and raise usable topK. |
| Embeddings | `GeminiEmbeddingProvider` — `gemini-embedding-001`, 3072-d native reduced to 768 via `outputDimensionality` (MRL), L2-normalized | **Yes, unchanged.** |
| Ingestion pipeline | `IngestionService.ingest()` — validate → soft-delete old chunks → `TextChunker.chunkText` → `createMany` (txn) → embed sequentially → `storeEmbedding` | **Yes**, called by Governance on approval. `reembed()` reused for re-index. |
| Chat route | `app/api/private/knowledge/chat/route.ts` — Gemini 2.5 Flash + `googleSearch` grounding, RAG top-5, `MIN_SIMILARITY 0.3`, `MAX_CONTEXT_CHARS 6000`, NDJSON streaming, `Conversation`/`Message` persistence | **Extended** — orchestrator inserted for non-market turns; streaming contract preserved. |
| Provider abstraction | `lib/ai` `AIProvider` interface; `ClaudeProvider` (REST Messages API, no SDK, injectable fetch); `AIPresenterOrchestratorService` fallback chain (Gemini→Claude→OpenAI→deterministic) | **Yes** — Claude promoted to preferred; fallback chain kept. |
| Response integrity | `services/intelligence/chat/ai-response-integrity.service.ts` `validateResponseIntegrity()` | **Pattern reused** for candidate-answer + final-answer integrity. |
| Communication policy | `lib/ai/response-policy.ts` `AI_COMMUNICATION_POLICY` (+ `terminology.ts`, `compliance.ts` forbidden-phrase scanner) | **Yes** — applied to every Claude call and to ingestion checks. |
| Analytics | `AnalyticsEvent` (append-only, free-string `type`, Json `metadata`); `AnalyticsEventService.record()` | **Yes** — new `type` values + structured metadata. |
| Per-request counters | `RequestLog` (append-only: `userId`, `type`, `createdAt`) | **Pattern reused** — new `KnowledgeRetrievalLog` table. |
| Audit trail | `AuditLog` (append-only, no delete, no update path: `actorUserId`, `action`, `targetType`, `targetId`, `metadata` before/after) | **Yes** — every lifecycle transition. |
| Answer provenance precedent | `IntelligenceAuditTrace` (immutable per-answer snapshot, loose id refs, no FK, no `deletedAt`) | **Pattern reused** — new `KnowledgeAnswerProvenance` table. |
| Governance precedent | `AgentMemoryRecord` + `MemoryGateway` (AN1.9): `resolveWriteDecision`, `status = pending_approval`, `approvePending(recordId, approver)`, "agent-derived never silently promoted" | **Pattern reused directly** for `KnowledgeCandidate`. |
| Admin auth | `requireAdmin(requestId, startedAt)` → `assertRole("admin")`; every `/api/private/admin/*` route gates on it | **Yes, unchanged.** |
| Ingestion provenance precedent | `NewsArticle` (`provider`/`providerArticleId`, `processingStatus` enum, `tagProvenance` Json, `rawPayload` escape hatch) | **Pattern reference** for web-source provenance shape. |
| Agent knowledge tool | `services/agent-framework/tools/impl/research-knowledge-search.tool.ts` — thin adapter over the same stack | **Compatible** — the agent tool and the assistant now read the same store; scope filter keeps them isolated where needed. |

### 9.2 What is missing / needs to change

| Gap | Impact | Resolution (K1+) |
|---|---|---|
| `Knowledge` is **per-user only** — every row has a `userId`, retrieval is always `userId`-scoped. There is no "global assistant knowledge" concept. | A shared AI Assistant knowledge base cannot exist under today's schema. | **Additive columns** on `Knowledge`: `scope` (`user` \| `assistant` \| `support` \| `shared`), `visibility` (`public` \| `customer` \| `admin` \| `internal`), keep `userId` as the *author*. `VectorRepository.searchSimilar` gains a `scope`/`visibility` filter. No new model. (Decision D-CONTRACT-3.) |
| `Knowledge.status` / `embeddingStatus` are free-strings with an ad-hoc vocabulary (`processing`, `pending`, `indexed`, …). No lifecycle. | No candidate / approval / deprecation states. | Introduce a `KnowledgeStatus` enum for the loop's rows (§ `KNOWLEDGE_CONTRACT.md` §4). Legacy per-user rows keep working (mapped). |
| No `KnowledgeCandidate` model. | No candidate loop. | New model (`KNOWLEDGE_CONTRACT.md` §5). |
| No answer/retrieval provenance persistence for the assistant (only the intelligence path has `IntelligenceAuditTrace`). | No traceability / debugging / conflict analytics. | New `KnowledgeAnswerProvenance` table. |
| `ClaudeProvider` has **no tool-use / `web_search` support** and there is **no `ANTHROPIC_API_KEY`** in the project (untested live). | "Claude primary + Claude native web search" is not achievable today. | Provision `ANTHROPIC_API_KEY`; extend `ClaudeProvider` to pass `tools: [{ type: "web_search_20250305", name: "web_search" }]` and parse `server_tool_use` / `web_search_tool_result` blocks. (Decision D-ORCH-2, **pending owner sign-off**.) |
| No shared cache (Redis / Vercel KV / Upstash). Only in-process `TtlCache` (per serverless instance) and a small `ApiClient` client cache. | Answer cache cannot be a KV store on the current plan. | `KnowledgeAnswerCache` **Postgres table** for beta; KV is a post-beta optimisation. (Decision D-RETR-5.) |
| Role vocabulary drift: `lib/roles.ts` = `guest\|customer\|admin\|affiliate`; `User.role` default = `"user"`; `assertRole("admin")` is the real gate. | Minor — governance only needs `admin`. | Governance keys off `assertRole("admin")` only. Note the drift; do not fix it in K0. |

### 9.3 Deployment constraints

- **Vercel Hobby**, one project (`algotraders24-ai-platform`), **one cron/day
  limit** (a sub-daily cron in `vercel.json` silently blocks main deploys — see
  `project_vercel_deployment_topology`). Any Knowledge Loop background job
  (e.g. freshness sweep, candidate-dedup batch) must fit the once/day budget
  or run inline / on-demand.
- **Serverless / stateless** — no shared process memory; the in-process
  retrieval cache is best-effort only.
- **Prisma 7.8**, `postgresql`, pgvector. **Never `prisma migrate dev`**
  (pgvector-reset trap). Migrations are generated offline via
  `prisma migrate diff`, hand-reviewed, and applied via `prisma migrate deploy`
  under an explicit gate (AN1.9 / M-series precedent).

### 9.4 Precise touch points for K1

| File / area | Change |
|---|---|
| `prisma/schema.prisma` | +`KnowledgeStatus`, `KnowledgeScope`, `KnowledgeVisibility`, `KnowledgeFreshnessClass`, `KnowledgeSourceType` enums; +additive `Knowledge` columns; +`KnowledgeCandidate`, `KnowledgeAnswerProvenance`, `KnowledgeRetrievalLog`, `KnowledgeAnswerCache` models; +`KnowledgeVersionCounter` (single-row). Migration generated + reviewed, **not applied** until gate. |
| `repositories/VectorRepository.ts` | `searchSimilar` gains optional `scope: string[]` + `visibility: string[]` filters (parameterized). No behaviour change when omitted. |
| `app/api/private/knowledge/chat/route.ts` | After the existing `IntelligencePresentationService` gate, route non-resolved turns through `KnowledgeLoopOrchestrator.answer()` instead of the inline RAG+Gemini block. Streaming/NDJSON and `Conversation`/`Message` persistence unchanged. |
| `lib/ai/providers/claude.provider.ts` | Add optional `tools` passthrough + `web_search` result-block parsing. Gated behind `ANTHROPIC_API_KEY` presence (existing `hasEnv` pattern). |
| `services/knowledge-loop/**` | New — orchestrator, knowledge service, candidate service, governance, cache, analytics, classifier. |
| `app/api/private/knowledge-loop/**`, `app/api/private/admin/knowledge-loop/**` | New route handlers (admin ones gate on `requireAdmin`). |
| `services/knowledge/IngestionService.ts` | Unchanged; called by Governance on approval. |

---

## 10. Non-goals (LOCKED — sprint §24)

K0 and the K1–K8 sequence MUST NOT: rewrite the existing AI Assistant;
replace Claude/Gemini providers wholesale; introduce Tavily/Exa/Pinecone/
Weaviate/LangChain; build a second RAG system for the Support Agent; build a
large admin UI (a functional candidate queue + a knowledge list is the
ceiling for beta); implement speculative features (reranking, embeddings
re-training, multi-tenant knowledge marketplaces); migrate unrelated models;
or touch the Quant / Marketplace / Paper-Trading systems.

---

## 11. Implementation sequence

| Step | Scope | Gate |
|---|---|---|
| **K1** | DB migration (generated + reviewed) + Knowledge Service (CRUD, lifecycle, scope/visibility filter in `VectorRepository`) | Migration apply authorization |
| **K2** | Embeddings + semantic retrieval contract wired (retrieval cache, freshness/authority weighting, retrieval log) | Retrieval quality smoke |
| **K3** | Orchestrator integration into `knowledge/chat` (Claude preferred, web-search gate, provenance record) | `ANTHROPIC_API_KEY` provisioned + `ClaudeProvider` web_search verified |
| **K4** | Candidate generation + admin approval queue (routes + minimal UI) | Governance review |
| **K5** | Answer cache + provenance completeness + cache invalidation on version change | Cache-safety review |
| **K6** | Governance hardening + analytics events + beta metrics dashboard (read-only) | — |
| **K7** | End-to-end evaluation (acceptance tests, §12) | E2E pass |
| **K8** | Beta hardening (latency, cost caps, privacy-scan tightening, load) | Beta GO |

---

## 12. Proposed acceptance tests

House style: standalone `scripts/validate-knowledge-loop-*.ts` harnesses
(`node:assert/strict` via `tsx`), one `validate:knowledge-loop-*` script per
area, per AN1.2 D2. Build deterministic fake inputs → run the real unmodified
service chain → assert → print pass/fail.

1. **Precedence** — a query with a matching active knowledge chunk answers
   from knowledge (Priority 2), no web search fired.
2. **Threshold fallthrough** — a query with only sub-`RELEVANCE_MIN` hits
   proceeds to web search / general reasoning; `KNOWLEDGE_LOW_RELEVANCE`
   emitted.
3. **Insufficient → web** — zero hits + current-info intent → web search
   fired; `WEB_SEARCH_FALLBACK` emitted; provenance records web sources.
4. **Stale demotion** — a `DYNAMIC` knowledge row past its freshness window is
   not presented as current; orchestrator flags stale and falls through.
5. **Conflict** — knowledge says A, web says B → both provenance records kept,
   authoritative source chosen by policy, `KNOWLEDGE_CONFLICT` emitted, no
   silent knowledge mutation, optional candidate created.
6. **Candidate creation** — an answered how-to question with no knowledge hit
   creates exactly one `KnowledgeCandidate` (status `candidate`) with
   provenance; a market/dynamic question creates none; a PII-bearing turn
   creates none.
7. **Dedup** — a candidate near-identical (cosine > `DUP_HARD`) to active
   knowledge attaches as duplicate, does not create a competing row.
8. **Approval** — `approve(candidateId, admin)` creates one `Knowledge`
   (status `active`), runs ingestion (chunks + embeddings), writes one
   `AuditLog`, emits `KNOWLEDGE_APPROVED`, bumps the version fingerprint.
9. **Rejection** — a rejected candidate is never returned by retrieval, ever;
   `AuditLog` + `KNOWLEDGE_REJECTED`.
10. **Retrieval safety** — deprecated knowledge is excluded; rejected
    candidates are unreachable; a lower-confidence duplicate never outranks
    the canonical row; user-scoped rows never leak into another user's
    results.
11. **Cache safety** — a `STATIC`/public answer is cached and re-served
    (`CACHE_HIT`); a market/user-specific/web-dependent answer is never
    cached; a knowledge approve invalidates the relevant cached answers on
    the next request.
12. **Provenance completeness** — every answer writes a
    `KnowledgeAnswerProvenance` row with a source class
    (`AT24_KNOWLEDGE` \| `CLAUDE_REASONING` \| `CLAUDE_WEB_SEARCH` \| `MIXED`)
    and, for `MIXED`, the per-source contribution.
13. **Authorization** — every admin route rejects a non-admin session (401/403);
    no candidate/knowledge mutation path exists without `requireAdmin`.
14. **Shared foundation** — a `support`-scoped query does not return
    `assistant`-only knowledge and vice versa; `shared` is visible to both.
15. **Regression** — existing `validate:*` suites still pass; the
    non-streaming `knowledge/chat` contract is byte-identical for the
    publishing / trading-copilot / agents callers.

---

## 13. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0.1 created. Core principle (§0) and precedence (§1) proposed for lock. Infrastructure audit (§9) complete. Implementation sequence (§11) and acceptance tests (§12) proposed. GO/NO-GO in `K0_DECISION.md`. |
