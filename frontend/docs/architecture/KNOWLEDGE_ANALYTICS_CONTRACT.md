# K0.6 — Knowledge Analytics Contract

**Sprint:** K0 — AT24 AI Assistant Knowledge Loop
**Stage:** Contract lock — precedes K6
**Depends on:** [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md), [`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md)
**Status:** PROPOSED — see [`K0_DECISION.md`](K0_DECISION.md)

Defines every analytics event, its payload, and the beta dashboard metrics.
Reuses the existing internal analytics infrastructure — `AnalyticsEvent`
(append-only Prisma model, free-string `type`, Json `metadata`) +
`AnalyticsEventService.record()` — plus one new append-only structured table,
`KnowledgeRetrievalLog` (mirror of `RequestLog`), for per-retrieval quality
data that needs real columns for aggregation.

**No third-party analytics integration** (Segment/Amplitude/etc.) — same
explicit constraint as Sprint R1.2's `AnalyticsEvent`.

---

## 1. Event backing (LOCKED)

| Event group | Backing | Why |
|---|---|---|
| Lifecycle / funnel events (`KNOWLEDGE_QUERY`, `WEB_SEARCH_FALLBACK`, `ANSWER_GENERATED`, `KNOWLEDGE_CANDIDATE_*`, `KNOWLEDGE_APPROVED/REJECTED/DEPRECATED`, `KNOWLEDGE_CONFLICT`, `CACHE_HIT/MISS`) | `AnalyticsEvent` — new `type` values, structured `metadata` | append-only, indexed on `(type)`, `(userId,type)`, `(createdAt)`; funnel/rate math already supported (`countsByType`, `distinctUserCount`) |
| Per-retrieval quality (`KNOWLEDGE_HIT`, `KNOWLEDGE_MISS`, `KNOWLEDGE_LOW_RELEVANCE` + similarity, latency, sufficiency) | `KnowledgeRetrievalLog` — new table | needs numeric columns (`bestSimilarity`, `latencyMs`) for `AVG`/percentile aggregation; a Json blob in `AnalyticsEvent` can't be indexed/aggregated efficiently |
| Answer-level provenance (source class, provider, conflict) | `KnowledgeAnswerProvenance` — new table (orchestration §8) | the durable per-answer record; analytics reads from it, doesn't duplicate it |

`AnalyticsEventService` gains the new `type` values in its
`AnalyticsEventType` union. A thin `KnowledgeLoopAnalytics` wrapper
(`services/knowledge-loop/analytics/`) fans a single call out to the right
backing store(s) so call sites stay one line, best-effort, `.catch(() => {})`.

---

## 2. Canonical events

Every event carries a common envelope + event-specific `metadata`.

**Common envelope** (from `AnalyticsEvent` columns + standard metadata keys):

| Field | Source |
|---|---|
| `type` | the event name (below) |
| `userId` | session-derived; `null` only for guest public reads; `"system"` for sweep-driven events |
| `createdAt` | server time |
| `metadata.requestId` | request correlation id |
| `metadata.conversationId` | when applicable |
| `metadata.latencyMs` | segment or total latency, when applicable |

### 2.1 Retrieval & answer events

| Event | Actor | Fires when | Key `metadata` |
|---|---|---|---|
| `KNOWLEDGE_QUERY` | user | orchestrator starts a knowledge turn | `queryHash`, `scopes`, `intent`, `freshnessNeed`, `privacyClass`, `servedFromCache` |
| `KNOWLEDGE_HIT` | user | retrieval returns ≥1 hit ≥ `RELEVANCE_MIN` | `hitCount`, `bestSimilarity`, `topKnowledgeId`, `sufficiency`, `fromCache`, `latencyMs` |
| `KNOWLEDGE_MISS` | user | retrieval returns 0 hits ≥ `RELEVANCE_MIN` | `bestSimilarity` (the highest that still failed), `scopes`, `latencyMs` |
| `KNOWLEDGE_LOW_RELEVANCE` | user | hits exist but all `finalScore < RELEVANCE_GOOD` | `bestSimilarity`, `hitCount`, `topKnowledgeId` |
| `WEB_SEARCH_FALLBACK` | user | orchestrator's web-search gate resolves true | `reason` (`explicit-freshness` \| `dynamic-need` \| `insufficient` \| `stale` \| `conflict`), `knowledgeSufficiency`, `webAvailable` |
| `ANSWER_GENERATED` | user / system | final answer produced (incl. cache hit + deterministic fallback) | `sourceClass`, `providerUsed`, `webSearchUsed`, `integrityPassed`, `servedFromCache`, `answerCached`, `latencyMs`, `estTokensIn`, `estTokensOut` |
| `KNOWLEDGE_CONFLICT` | user / system | knowledge-vs-knowledge or knowledge-vs-web contradiction detected | `kind` (`kk` \| `kw`), `aId`, `bId`/`webDomain`, `chosen`, `basis`, `candidateCreatedId?` |
| `CACHE_HIT` | user | answer cache or retrieval cache hit | `cache` (`answer` \| `retrieval`), `key`, `ageMs` |
| `CACHE_MISS` | user | lookup missed | `cache`, `key` |

### 2.2 Knowledge-loop lifecycle events

| Event | Actor | Fires when | Key `metadata` |
|---|---|---|---|
| `KNOWLEDGE_CANDIDATE_CREATED` | user / system | `CandidateService.propose()` creates a row | `candidateId`, `reasonForCandidate`, `sourceType`, `knowledgeType`, `confidence`, `duplicateOfId?`, `similarityScore?` |
| `KNOWLEDGE_CANDIDATE_REVIEWED` | admin | approve/reject/defer committed | `candidateId`, `decision` (`approved` \| `rejected` \| `deferred`), `adminId`, `reviewLatencyMs` (created→reviewed), `editedByReviewer?` |
| `KNOWLEDGE_APPROVED` | admin / system | a `Knowledge` row reaches `active` (new or new-version) | `knowledgeId`, `candidateId?`, `version`, `previousVersionId?`, `adminId`, `knowledgeType`, `scope` |
| `KNOWLEDGE_REJECTED` | admin | `Governance.reject()` | `candidateId`, `reason`, `closeAs`, `adminId` |
| `KNOWLEDGE_DEPRECATED` | admin / system | `deprecate()` or sweep auto-deprecation | `knowledgeId`, `reason` (`superseded` \| `expired` \| `incorrect` \| `manual`), `actorUserId` |

### 2.3 Notes

- `KNOWLEDGE_APPROVED`/`REJECTED`/`DEPRECATED` are **also** implied by
  `AuditLog` rows (governance §5). The analytics events are the
  **rate/volume** signal (cheap to aggregate); the `AuditLog` is the
  **forensic** record. They are written in the same code path but neither
  depends on the other.
- Every event write is best-effort and never on the critical path of the
  user's answer (same convention as `analyticsEventService.record(...).catch()`
  in the current chat route).

---

## 3. Beta dashboard metrics (LOCKED)

Read-only page at `/dashboard/admin/knowledge-loop/metrics`. All numbers are
computed from real rows; **no metric shows a value it can't derive** (a metric
with no data yet shows "—" / "no data yet", never a placeholder — the
platform's established no-fabrication rule).

### 3.1 Retrieval

| Metric | Definition |
|---|---|
| Knowledge Hit Rate | `count(KNOWLEDGE_HIT) / count(KNOWLEDGE_QUERY)` over the window |
| Knowledge Miss Rate | `count(KNOWLEDGE_MISS) / count(KNOWLEDGE_QUERY)` |
| Low-Relevance Rate | `count(KNOWLEDGE_LOW_RELEVANCE) / count(KNOWLEDGE_QUERY)` |
| Average Retrieval Relevance | `AVG(bestSimilarity)` over `KnowledgeRetrievalLog` where `hitCount > 0` |
| Retrieval Relevance p50 / p95 | percentiles of `bestSimilarity` (hits only) |
| Top Knowledge Items | top N `Knowledge` by `retrievalCount` (already maintained) + `lastRetrievedAt` |
| Stale Knowledge Rate | `count(active Knowledge where freshnessClass=PERIODIC and review-due) / count(active Knowledge)` |
| Unretrieved Knowledge | `active` rows with `retrievalCount = 0` older than 30 days (candidates for archival) |

### 3.2 Web

| Metric | Definition |
|---|---|
| Web Search Fallback Rate | `count(WEB_SEARCH_FALLBACK) / count(KNOWLEDGE_QUERY)` |
| Web Search Success Rate | `count(ANSWER_GENERATED where webSearchUsed and integrityPassed) / count(WEB_SEARCH_FALLBACK)` |
| Web-Unavailable Rate | `count(WEB_SEARCH_FALLBACK where webAvailable=false) / count(WEB_SEARCH_FALLBACK)` |

### 3.3 Knowledge Loop

| Metric | Definition |
|---|---|
| Candidate Creation Rate | `count(KNOWLEDGE_CANDIDATE_CREATED) / count(KNOWLEDGE_QUERY)` (and absolute count) |
| Approval Rate | `count(reviewed decision=approved) / count(reviewed)` |
| Rejection Rate | `count(reviewed decision=rejected) / count(reviewed)` |
| Average Review Time | `AVG(reviewLatencyMs)` from `KNOWLEDGE_CANDIDATE_REVIEWED` |
| Open Candidate Backlog | `count(KnowledgeCandidate where status in {candidate, under_review})` + oldest age |
| Knowledge Growth Rate | net `active` `Knowledge` added per week (approvals − deprecations) |
| Duplicate Suppression Rate | `count(candidate closed as duplicate) / count(candidates created + suppressed)` |

### 3.4 Quality

| Metric | Definition |
|---|---|
| Correction Rate | `count(KNOWLEDGE_CANDIDATE_CREATED where reasonForCandidate=assistant-correction) / count(ANSWER_GENERATED)` |
| Unresolved Questions | `count(KNOWLEDGE_MISS)` where the same `queryHash` recurred ≥ 2× with no candidate/knowledge added since |
| Repeated Questions | top `queryHash` values by frequency in `KnowledgeRetrievalLog` (the knowledge-gap worklist) |
| Conflict Rate | `count(KNOWLEDGE_CONFLICT) / count(KNOWLEDGE_QUERY)` |
| User Feedback | reuse the existing `Feedback` model, filtered to `page` containing `assistant`/`knowledge` |

### 3.5 Performance

| Metric | Definition |
|---|---|
| Retrieval Latency p50 / p95 | `KnowledgeRetrievalLog.latencyMs` percentiles (split cache-hit vs miss) |
| Claude Latency p50 / p95 | from `KnowledgeAnswerProvenance.providerAttempts` (per-provider) |
| Web Search Latency p50 / p95 | segment latency when `webSearchUsed` |
| Total Answer Latency p50 / p95 | `KnowledgeAnswerProvenance.latencyMs` |
| Answer Cache Hit Rate | `count(CACHE_HIT cache=answer) / (count(CACHE_HIT cache=answer) + count(CACHE_MISS cache=answer))` |
| Retrieval Cache Hit Rate | same for `cache=retrieval` |
| Est. Cost / 1k answers | `Σ(estTokensIn·inRate + estTokensOut·outRate + webSearchUses·searchRate)` from `ANSWER_GENERATED` metadata; rates from `config/knowledge-loop.config.ts` |

### 3.6 Windowing

All rates support `7d` / `30d` / `all` windows (the `AnalyticsEvent` `createdAt`
index + `KnowledgeRetrievalLog` `createdAt` index make these cheap). The page
computes on request (no pre-aggregation table for beta); if a window query
gets slow at volume, a nightly rollup table is a K8 item.

---

## 4. Instrumentation points (where each event fires)

| Event | Call site |
|---|---|
| `KNOWLEDGE_QUERY`, `WEB_SEARCH_FALLBACK`, `ANSWER_GENERATED`, `KNOWLEDGE_CONFLICT`, `CACHE_*` | `KnowledgeLoopOrchestrator.answer()` |
| `KNOWLEDGE_HIT/MISS/LOW_RELEVANCE` + `KnowledgeRetrievalLog` append | `KnowledgeService.retrieve()` |
| `KNOWLEDGE_CANDIDATE_CREATED` | `CandidateService.propose()` |
| `KNOWLEDGE_CANDIDATE_REVIEWED`, `KNOWLEDGE_APPROVED`, `KNOWLEDGE_REJECTED`, `KNOWLEDGE_DEPRECATED` | `Governance.*` (same txn/path as the `AuditLog` write) |

The existing `ai_chat` `AnalyticsEvent` the chat route already fires stays —
it is the coarse "an AI chat happened" signal; the new events are the
knowledge-loop detail underneath it.

---

## 5. Privacy in analytics (LOCKED)

- `KnowledgeRetrievalLog` stores `queryHash` (sha256 of normalized query),
  **not raw query text** — raw text already lives in `Message`; a second
  plaintext copy in an analytics table is an unnecessary PII surface.
- Event `metadata` never contains answer text, message text, account
  identifiers, or web-page bodies — only ids, enums, scores, and latencies.
- "Repeated question" / "knowledge gap" worklists show the admin the
  `queryHash` + a count; to see the actual wording the admin opens one linked
  `Message`/`Conversation` (already access-controlled), which is an audited
  admin read.

---

## 6. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0.6 created. 15 canonical events on `AnalyticsEvent` + a new `KnowledgeRetrievalLog` table for numeric aggregation. Beta dashboard metrics (§3) defined for retrieval / web / loop / quality / performance. No third-party analytics; `queryHash` not raw text. |
