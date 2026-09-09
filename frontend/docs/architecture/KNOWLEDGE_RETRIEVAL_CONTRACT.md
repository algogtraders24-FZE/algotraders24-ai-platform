# K0.3 — Knowledge Retrieval Contract

**Sprint:** K0 — AT24 AI Assistant Knowledge Loop
**Stage:** Contract lock — precedes K2
**Depends on:** [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md), [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md)
**Status:** PROPOSED — see [`K0_DECISION.md`](K0_DECISION.md)

Defines: query normalization, embedding, candidate retrieval, metadata
filtering, relevance scoring, ranking, thresholds, freshness weighting,
conflict handling, caching, and the retrieval-safety guarantees.

The retrieval layer is a thin, deterministic wrapper over the **existing**
pgvector store. It introduces **no vector database**, **no new embedding
provider**, and **no reranker** for beta.

---

## 1. Embedding (LOCKED — reuse existing)

| Parameter | Value | Source |
|---|---|---|
| Provider | `GeminiEmbeddingProvider` | `lib/ai/providers/gemini-embedding.provider.ts` |
| Model | `gemini-embedding-001` (env `GEMINI_EMBEDDING_MODEL`) | `lib/ai/env.ts` |
| Native dimensionality | 3072 | Gemini |
| Stored dimensionality | **768** (via `outputDimensionality`, MRL truncation) | pgvector schema locked at `vector(768)` |
| Normalization | L2-normalized to unit length | `GeminiEmbeddingProvider.normalize()` |
| Distance metric | cosine — `1 - (embedding <=> $1::vector)` | `VectorRepository.searchSimilar` |
| Index | HNSW, `vector_cosine_ops` | `20260720000000_add_knowledge_chunk_and_pgvector` |
| Timeout | 30 s | provider default |

**Query and document embeddings MUST use the same model and dimensionality.**
Changing the embedding model is a breaking change requiring a full re-embed of
every chunk and is explicitly out of scope (Decision D-RETR-2). The `provider`
field on `Knowledge` records which embedder produced the chunks so a future
migration can detect mixed-vintage rows.

---

## 2. Chunking (LOCKED — reuse existing)

`services/knowledge/TextChunker.ts` `chunkText(text, options)` — the existing
deterministic chunker. Ingestion is via `IngestionService.ingest()`
(unchanged). Chunk records carry `chunkIndex`, `tokenCount`, `charCount`.
K0 does not re-tune chunk size/overlap; if K7 evaluation shows retrieval
quality issues, chunk-parameter tuning is a scoped K8 item, not a K0 decision.

---

## 3. Retrieval contract

```
retrieve(query: string, opts: {
  callerUserId: string,
  callerRole: "customer" | "admin" | ...,
  scopes: KnowledgeScope[],          // e.g. ["assistant","shared"] for the AI Assistant;
                                      //      ["support","shared"] for the Support Agent
  topK?: number,                     // default RETRIEVE_TOP_K = 12
  knowledgeId?: string,              // optional pin to one document
  includeUserScope?: boolean         // default true — also search the caller's own scope=user rows
}) : RetrievalResult
```

### 3.1 Pipeline

```
1. normalize(query)
     · trim, collapse internal whitespace
     · a separate lowercased form is used ONLY for the cache key, never for embedding
     · reject empty / whitespace-only → RetrievalResult { hits: [], reason: "empty-query" }

2. cacheKey = sha256( normalizedLowerQuery | sortedScopes | callerScopeSig | knowledgeVersionFingerprint )
     · Retrieval Cache lookup → HIT: hydrate stored chunkIds → step 8 ; emit CACHE_HIT
     · MISS: emit CACHE_MISS ; continue

3. embed(normalizedQuery) via GeminiEmbeddingProvider → 768-d unit vector
     · provider failure → RetrievalResult { hits: [], reason: "embedding-failed" }
       (orchestrator then proceeds as knowledgeSufficiency = INSUFFICIENT)

4. VectorRepository.searchSimilar({
       embedding, topK: RETRIEVE_TOP_K,
       scope: scopes (+ "user" iff includeUserScope),
       visibility: visibilityFor(callerRole),
       userId: callerUserId  // still applied to scope=user rows only
   })
     · SQL adds:  status = 'active'  AND  "supersededById" IS NULL  AND  "deletedAt" IS NULL
                  AND ("expiresAt" IS NULL OR "expiresAt" > now())
     · returns up to RETRIEVE_TOP_K rows with raw cosine similarity

5. threshold filter:  drop rows with similarity < RELEVANCE_MIN (0.30)
     · 0 survivors → emit KNOWLEDGE_MISS ; RetrievalResult { hits: [], reason: "below-threshold", bestSimilarity }
     · survivors but bestSimilarity < RELEVANCE_GOOD (0.45) → also emit KNOWLEDGE_LOW_RELEVANCE

6. enrich + weight each surviving row:
     authorityWeight = AUTHORITY_WEIGHTS[sourceType]        (§4)
     stalePenalty    = 0.15 if PERIODIC past review-due ; 0 otherwise
     freshnessOk     = not (PERIODIC past review-due)       (DYNAMIC-expired already excluded in SQL)
     finalScore      = similarity * authorityWeight - stalePenalty

7. rank + de-dup:
     · sort by finalScore desc
     · collapse chunks sharing a knowledgeId beyond CHUNKS_PER_DOC_MAX (2)
     · collapse near-identical chunk text (cosine > 0.97) keeping the higher finalScore
     · conflict detection: if the top rows contain directly contradictory
       canonical answers for the same canonicalQuestion cluster → mark
       RetrievalResult.conflict = { aId, bId } (§6)

8. context selection:
     · walk ranked rows, accumulate `- <chunk content>\n` until CONTEXT_CHAR_BUDGET (6000)
       (identical budget + format to today's knowledge/chat route)
     · Retrieval Cache write (chunkIds + finalScores, TTL RETRIEVAL_CACHE_TTL)
     · best-effort: Knowledge.lastRetrievedAt = now, retrievalCount += 1
       (the search route already increments retrievalCount — reuse that path)
     · KnowledgeRetrievalLog append (§8)
     · emit KNOWLEDGE_HIT with { count, bestSimilarity, scopes }

RetrievalResult = {
  hits: Array<{ knowledgeId, chunkId, chunkIndex, content, similarity, finalScore,
                sourceType, freshnessClass, stale: boolean, version }>,
  contextBlock: string,          // the assembled text, ≤ CONTEXT_CHAR_BUDGET
  sufficiency: "SUFFICIENT" | "LOW" | "INSUFFICIENT" | "STALE",
  conflict?: { aId: string, bId: string },
  bestSimilarity: number,
  fromCache: boolean,
  latencyMs: number
}
```

### 3.2 Sufficiency mapping (consumed by the orchestrator's web-search gate)

| `sufficiency` | Condition |
|---|---|
| `SUFFICIENT` | ≥1 hit with `finalScore ≥ RELEVANCE_GOOD` (0.45) and not stale |
| `LOW` | hits exist but all `finalScore < RELEVANCE_GOOD` |
| `STALE` | the best hit is `DYNAMIC`/`PERIODIC` and flagged stale |
| `INSUFFICIENT` | 0 hits ≥ `RELEVANCE_MIN`, or embedding/search failed |

---

## 4. Source-authority weighting (LOCKED)

`AUTHORITY_WEIGHTS` by `KnowledgeSourceType`:

| sourceType | weight | rationale |
|---|---|---|
| `admin_authored` | 1.00 | a human with authority wrote it directly |
| `policy` knowledge (any source) | 1.00 | override: policy rows always max authority |
| `existing_documentation` | 0.95 | curated docs |
| `support_resolution` | 0.90 | a real resolved case, admin-approved |
| `verified_qa` | 0.85 | a real interaction, admin-approved |
| `assistant_correction` | 0.85 | a corrected answer, admin-approved |
| `web_researched` | 0.75 | approved, but derived from external content |
| `unanswered_question` (promoted) | 0.75 | admin wrote the answer for a gap |
| `scope = user` unverified rows | 0.50 | never outrank verified knowledge |

Weight affects **ranking only**, never the threshold — a 0.75-weight row at
0.9 similarity still clears `RELEVANCE_MIN` comfortably.

---

## 5. Freshness weighting (LOCKED)

- `DYNAMIC` past `expiresAt` — excluded in SQL (never reaches ranking).
- `PERIODIC` past `lastReviewedAt + freshnessReviewEveryDays` — `stalePenalty
  = 0.15`, row still eligible but demoted, `stale: true` propagated so the
  orchestrator can (a) prefer web search and (b) caveat the answer.
- `STATIC` — no freshness penalty ever.
- The daily sweep (one-cron/day budget) keeps `expiresAt`/review-due state
  current so retrieval-time checks are cheap comparisons.

---

## 6. Conflict handling (LOCKED — deterministic)

When retrieval surfaces two `active` rows whose canonical answers directly
contradict (detected by: same `canonicalQuestion` cluster — cosine of the two
questions > 0.9 — but answer embeddings cosine < 0.4, or an explicit
`conflictsWithId` link an admin set):

1. **Detect** — set `RetrievalResult.conflict = { aId, bId }`.
2. **Preserve both** — both rows go into the context block, each labelled with
   its `sourceType`, `version`, and `approvedAt`.
3. **Prefer** — the orchestrator picks the authoritative one by:
   higher `AUTHORITY_WEIGHTS` → then newer `approvedAt` → then higher
   `version`. The other is included as "an earlier/again alternative
   statement" only if the char budget allows.
4. **No silent mutation** — retrieval never edits, merges, or deletes either
   row.
5. **Signal** — the orchestrator emits `KNOWLEDGE_CONFLICT` with
   `{ aId, bId, chosen, basis }` and creates a `KnowledgeCandidate`
   (`reasonForCandidate = admin-flagged`, `sourceType = admin_authored`,
   `proposedAnswer` = the two statements + the query) so an admin resolves it
   (typically by deprecating one and/or publishing a merged new version).

Knowledge-vs-web conflict (knowledge says A, web says B) is handled in
[`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`](AI_ASSISTANT_ORCHESTRATION_CONTRACT.md) §6.

---

## 7. Caching

### 7.1 Two caches, one key shape

Both keyed by
`sha256( normalizedLowerQuery | sortedScopes | callerScopeSig | knowledgeVersionFingerprint )`.
Embedding the fingerprint in the key means **version changes invalidate
lazily** — a stale entry can never be matched after any knowledge lifecycle
transition; no explicit delete pass is needed.

### 7.2 Retrieval Cache

> **ADR-K2-RETR-CACHE — retrieval cache moved from in-process to Postgres
> (2026-09-09, K2-A).**
>
> - **Original decision (K0.3, 2026-09-08):** the retrieval cache is an
>   in-process `TtlCache<string, {chunkIds, scores}>` — best-effort,
>   per-serverless-instance, lost on cold start.
> - **Reason for change:** AT24 runs on Vercel serverless. An in-process
>   cache is instance-local: with N concurrent lambdas the hit rate is
>   ~1/N and every cold start starts empty, so it cannot be the *canonical*
>   retrieval cache — it is close to dead weight for the exact "repeated
>   question across users/sessions" case it exists to serve. This is an
>   intentional contract amendment, not an accidental implementation detail.
> - **New decision:** the retrieval cache is a **Postgres table
>   `KnowledgeRetrievalCache`** (NOT `KnowledgeAnswerCache` — see §7.5),
>   keyed by the same deterministic fingerprint (§7.1, extended per §7.6),
>   TTL `RETRIEVAL_CACHE_TTL` (10 min), read `WHERE key = $1 AND expiresAt >
>   now()`, written after a fresh retrieval, invalidated lazily by the
>   fingerprint in the key (§7.4) + TTL + a daily `expiresAt < now() - 7d`
>   purge (same shape as the answer-cache cleanup).
> - **Scope of change:** the *backing store* only. The cache **contract**
>   is otherwise unchanged: still stores only chunk ids + similarity, still
>   re-hydrates `Knowledge`/`KnowledgeChunk` **live** on every hit, still
>   re-runs the full eligibility filter + ranking on the hydrated rows, is
>   still never a source of truth, and can never bypass authorization,
>   user isolation, scope/visibility, lifecycle, supersession, or freshness
>   (§7.3 safety row).
> - **What is unchanged:** §7.1 key shape (extended, not replaced, per §7.6);
>   §7.3 answer cache (§7.5 explains the separation); §7.4 fingerprint
>   mechanism; §8 retrieval logging (K2-B only wires `fromCache`); §3
>   pipeline semantics for a cache **miss** are byte-identical to K1.
> - **Migration requirement:** one additive migration adding
>   `KnowledgeRetrievalCache` (`CREATE TABLE` + 2 indexes, no change to any
>   existing table). Generated offline, **NOT APPLIED** until an explicit
>   K2 owner gate (same discipline as K1).
> - **No new infrastructure:** no Redis / Vercel KV / Upstash. Postgres is
>   the canonical beta retrieval-cache store, matching K1_DECISION SO-3's
>   rationale for the answer cache.

| Property | Value |
|---|---|
| Backing | **Postgres `KnowledgeRetrievalCache`** (K2-A; was in-process `TtlCache` in K0.3 — see ADR-K2-RETR-CACHE above) |
| TTL | `RETRIEVAL_CACHE_TTL` = 10 min |
| Purpose | latency + embedding-cost saver for repeated queries across instances/users; never a source of truth |
| Safety | stores only chunk ids + similarity; `Knowledge`/`KnowledgeChunk` are re-hydrated **live** on every hit and the full eligibility filter + ranking re-runs, so a row that was deprecated / archived / superseded / expired within the TTL is dropped at hydration exactly as on a fresh retrieval |
| Read | `WHERE key = $1 AND expiresAt > now()` → hit; else miss |
| Write | after a fresh retrieval that reached `reason ∈ {ok, below-threshold, no-eligible-rows}` (never on `empty-query` / `embedding-failed`) |
| Invalidation | (a) TTL; (b) `knowledgeVersionFingerprint` change → key mismatch (lazy, §7.4); (c) `CONFIG_VERSION` change in the key (§7.6); (d) daily `expiresAt < now() - 7d` purge |

### 7.5 Why this is NOT `KnowledgeAnswerCache`

`KnowledgeRetrievalCache` and `KnowledgeAnswerCache` are **separate models,
mandatorily**:

| | `KnowledgeRetrievalCache` (K2) | `KnowledgeAnswerCache` (K5) |
|---|---|---|
| Caches | the *retrieval operation* — which chunk ids matched, with what similarity | the *final AI answer* text + its source attribution |
| Depends on | query + scope + knowledge version | all of that **plus** the LLM output, `privacyClass`, `freshnessClass`, whether web search ran, the integrity-check result |
| Write conditions | after any real retrieval | 5 strict conditions (§7.3) — public + STATIC + no web + integrity-passed + AT24/MIXED source |
| Owned by | K2 | K5 — **untouched by K2** |

Merging them would let a lax retrieval-cache write path leak into the strict
answer-cache contract. They stay apart.

### 7.6 Retrieval-cache key (extends §7.1)

`sha256( normalizedLowerQuery | sortedScopes | callerScopeSig | topK |
CONFIG_VERSION | knowledgeVersionFingerprint )` where:

- `callerScopeSig` = `"<callerRole>:<callerUserId-iff-includeUserScope>"` —
  captures **visibility** (role → allowed visibilities) and **user isolation**
  (a `scope=user` query is keyed to its owner; a different user's equivalent
  query has a different key and cannot hit the same row).
- `topK` — the result-limit dimension.
- `CONFIG_VERSION` — a constant bumped whenever a ranking/threshold constant
  (`RELEVANCE_MIN`, `RELEVANCE_GOOD`, `STALE_PENALTY`, `AUTHORITY_WEIGHTS`,
  `CHUNKS_PER_DOC_MAX`, `CONTEXT_CHAR_BUDGET`) changes — a config change then
  invalidates every entry with no migration.
- `knowledgeVersionFingerprint` — captures activation / deprecation /
  archival / reinstatement / new-version / supersession / freshness-sweep
  auto-deprecation (§7.4). Time-based `expiresAt` passing does **not** bump
  the fingerprint, but the live hydration re-filter (`isEligible` checks
  `expiresAt > now`) drops such a row on the hit path, and the daily
  freshness sweep then deprecates it (fingerprint bump).
- `RELEVANCE_MIN` (threshold) is a constant folded into `CONFIG_VERSION`;
  `visibility` is folded into `callerScopeSig`. No separate key dimension is
  added for a value that can't independently vary per request.

### 7.3 Answer Cache

| Property | Value |
|---|---|
| Backing | **`KnowledgeAnswerCache` Postgres table** (no shared KV store exists on the current Vercel plan — architecture §9.3) |
| Columns | `key` (pk), `normalizedQuery`, `scopeSig`, `knowledgeVersionFingerprint`, `answerText`, `sources` (Json), `sourceClass`, `createdAt`, `expiresAt` |
| TTL | `ANSWER_CACHE_TTL` = 24 h |
| Write conditions (ALL must hold) | `privacyClass = public` · `freshnessClass = STATIC` · no `web_search` used this turn · integrity check passed · `sourceClass ∈ {AT24_KNOWLEDGE, MIXED}` |
| Never cache | dynamic info, user-specific / account / financial info, market data, anything whose correctness depends on current web state, any `CLAUDE_WEB_SEARCH`-only answer |
| Read | `WHERE key = $1 AND expiresAt > now()` → `CACHE_HIT`; else `CACHE_MISS` |
| Invalidation | (a) TTL; (b) `knowledgeVersionFingerprint` change → key mismatch (lazy); (c) manual admin flush (`DELETE FROM "KnowledgeAnswerCache"` — a governance action, audited) |
| Cleanup | daily sweep deletes `expiresAt < now() - 7d` rows (fits the cron budget) |

### 7.4 `knowledgeVersionFingerprint`

A single-row `KnowledgeVersionCounter { id = "singleton", value: BigInt,
updatedAt }`. `value` is incremented **in the same transaction** as every
`Knowledge` lifecycle transition that changes what retrieval would return
(`approve`, `publishNewVersion`, `deprecate`, `archive`, `reinstate`, and the
sweep's auto-deprecations). Read once per request, cheap. This is the only
new "hot" write the loop adds and it is a single-row `UPDATE ... SET value =
value + 1`.

---

## 8. Retrieval logging

`model KnowledgeRetrievalLog` — append-only, no update, no delete (mirror of
`RequestLog`):

| Field | Type |
|---|---|
| `id` | `String` cuid |
| `userId` | `String` |
| `conversationId` | `String?` |
| `queryHash` | `String` — sha256 of normalized query (not the raw text, to keep the log PII-light) |
| `scopes` | `String[]` |
| `hitCount` | `Int` |
| `bestSimilarity` | `Float?` |
| `sufficiency` | `String` |
| `fromCache` | `Boolean` |
| `webSearchFollowed` | `Boolean` — did the orchestrator go to web search after this retrieval |
| `latencyMs` | `Int` |
| `createdAt` | `DateTime` |

Indexes: `[userId]`, `[createdAt]`, `[sufficiency]`, `[conversationId]`.
Raw query text is **not** stored here (it is already in `Message`); the hash
lets "repeated question" and "top knowledge gaps" be computed without a second
copy of user text.

---

## 9. Constants (LOCKED defaults — tunable via `config/knowledge-loop.config.ts`)

| Constant | Default | Meaning |
|---|---|---|
| `RETRIEVE_TOP_K` | 12 | rows pulled from pgvector before filtering (today's chat route uses 5; 12 gives ranking headroom) |
| `RELEVANCE_MIN` | 0.30 | hard floor (matches today's `MIN_SIMILARITY`) |
| `RELEVANCE_GOOD` | 0.45 | "sufficient" threshold |
| `CONTEXT_CHAR_BUDGET` | 6000 | matches today's `MAX_CONTEXT_CHARS` |
| `CHUNKS_PER_DOC_MAX` | 2 | de-dup cap per document |
| `STALE_PENALTY` | 0.15 | score penalty for a review-due `PERIODIC` row |
| `RETRIEVAL_CACHE_TTL` | 10 min | in-process |
| `ANSWER_CACHE_TTL` | 24 h | Postgres |
| `DUP_HARD` | 0.94 | candidate → attach as duplicate, don't create |
| `DUP_SOFT` | 0.85 | candidate created with `duplicateOfId` recorded |

---

## 10. Reranking (Decision D-RETR-4 — NOT in beta)

A cross-encoder / LLM reranker is deliberately excluded: it adds a second
model call (latency + cost) to every knowledge turn for a marginal ordering
gain at `topK = 12`. The weighted-score ranking (§3–§5) is the beta ranker.
If K7 evaluation shows ranking is the bottleneck, a reranker slots in at
pipeline step 6.5 behind a config flag — no contract change.

---

## 11. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0.3 created. Reuse-existing embedding/chunking/pgvector locked. Pipeline (§3), authority weights (§4), freshness (§5), deterministic conflict handling (§6), two-cache model with version-fingerprint invalidation (§7), retrieval log (§8) proposed for lock. No vector DB, no reranker, no new embedder. |
| 2026-09-09 | **ADR-K2-RETR-CACHE (§7.2):** retrieval cache backing store amended from in-process `TtlCache` → Postgres `KnowledgeRetrievalCache` (serverless makes an instance-local cache near-useless as the canonical store). Contract otherwise unchanged — same key shape (extended §7.6: + `topK`, + `CONFIG_VERSION`), same live re-hydration + re-filter + re-rank on every hit, still never an authority. §7.5 records why this is NOT `KnowledgeAnswerCache` (K5, untouched). One additive migration, NOT APPLIED until the K2 owner gate. |
