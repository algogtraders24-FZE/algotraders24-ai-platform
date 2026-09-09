# K2_ACCEPTANCE — Embeddings + Semantic Retrieval Infrastructure

**Sprint:** K2 — AT24 AI Assistant Knowledge Loop, retrieval-infrastructure layer
**Branch:** `feat/k2-knowledge-retrieval` (rebased on `origin/main`)
**Depends on / implements:** [`K1_DECISION.md`](K1_DECISION.md) · [`K1_ACCEPTANCE.md`](K1_ACCEPTANCE.md) · [`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md) §7 (incl. **ADR-K2-RETR-CACHE**) · [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md) §5 · [`KNOWLEDGE_ANALYTICS_CONTRACT.md`](KNOWLEDGE_ANALYTICS_CONTRACT.md) §8
**Status:** **K2 OPERATIONALLY COMPLETE (2026-09-09) — implementation merged + migration APPLIED to production + live-verified (§15/§16). K3 UNLOCKED.**

> K2 is the retrieval-infrastructure layer: it makes knowledge retrieval
> cacheable, observable, and freshness-aware, and hardens scope/lifecycle
> safety. It does **not** touch the Claude provider, orchestration, the
> assistant route, candidate governance, or the K5 answer cache. K3 owns
> orchestration.

---

## 0. Headline

```
K2 STATUS:               COMPLETE  (K2-A..K2-E implemented, merged, migration applied + live-verified)
K2-A retrieval cache:    PASS  — Postgres `KnowledgeRetrievalCache` + ADR recorded; table live
K2-B retrieval logging:  PASS  — canonical KnowledgeRetrievalLog emit wired (hit/miss); verified live
K2-C freshness sweep:    PASS  — DYNAMIC-expired auto-deprecate; PERIODIC flag-only
K2-D retrieval integration: PASS — cache↔service↔VectorRepository↔log wired; verified live
K2-E acceptance:         PASS  — 58 offline assertions + regression green
INV-1:                   PASS  — offline (sticky-cache) AND live (lifecycle invalidation, §15.6 TEST C)
CACHE ISOLATION:         PASS  — cross-user + visibility, offline AND live (§15.6 TEST D)
MIGRATION:               APPLIED  (20260909120000_add_knowledge_retrieval_cache, prod, 2026-09-09, once)
K2 MIGRATION GATE:       AUTHORIZED → APPLIED → VERIFIED  (§16)
K3:                      UNLOCKED  (not started)
```

---

## 1. Hard boundary — what K2 did NOT touch

Confirmed absent from `git diff origin/main`:

`lib/ai/providers/*` · Claude provider · `ANTHROPIC_API_KEY` · Claude native
`web_search` · `AIPresenterOrchestratorService` / provider fallback chain ·
`app/api/private/knowledge/chat/route.ts` · `services/ai/assistant.service.ts` ·
`services/ai/context-manager.service.ts` · `services/knowledge/IngestionService.ts` ·
`TextChunker.ts` · `services/agent-framework/**` · Support Agent · Automation ·
Marketplace · Quant · Publishing · any UI/route/page · `KnowledgeAnswerCache`
(the K5 answer cache — a separate model, contract §7.5) · `AnalyticsEvent`.

No K3 functionality was started.

---

## 2. K2-A — Retrieval Cache

### 2.1 Contract reconciliation (REQUIRED FIRST ACTION) — **DONE**

`KNOWLEDGE_RETRIEVAL_CONTRACT.md §7.2` amended with **ADR-K2-RETR-CACHE**
(2026-09-09), plus new **§7.5** (why this is not `KnowledgeAnswerCache`) and
**§7.6** (the extended key). Change-log entry added. No unrelated part of the
contract was rewritten.

| ADR field | Value |
|---|---|
| Original decision | in-process `TtlCache<string, {chunkIds, scores}>` (K0.3) |
| Reason for change | Vercel serverless → instance-local cache ≈ 1/N hit rate, empty on every cold start; unusable as the *canonical* retrieval cache for the cross-user "repeated question" case it exists to serve |
| New decision | Postgres table `KnowledgeRetrievalCache`, same deterministic key, TTL 10 min, `WHERE key=$1 AND expiresAt>now()`, lazy fingerprint invalidation + daily purge |
| Scope of change | the **backing store only** — the cache *contract* (chunk ids + similarity only, live re-hydration + re-filter + re-rank on every hit, never an authority) is unchanged |
| Unchanged | §7.1 key shape (extended, §7.6), §7.3 answer cache, §7.4 fingerprint, §8 logging, §3 miss-path semantics (byte-identical to K1) |
| Migration | one additive migration (`CREATE TABLE` + 2 indexes), NOT APPLIED until the K2 gate |
| Invalidation | (a) TTL; (b) fingerprint-in-key (lazy); (c) `CONFIG_VERSION`-in-key; (d) daily `expiresAt < now() - 7d` purge |
| Not `KnowledgeAnswerCache` | §7.5 — different data (retrieval op vs final answer), different write conditions (any real retrieval vs 5 strict K5 conditions), different owner (K2 vs K5) |

### 2.2 `KnowledgeRetrievalCache` model (schema + migration)

- `prisma/schema.prisma` — new `model KnowledgeRetrievalCache { key @id,
  queryHash, scopeSig, knowledgeVersionFingerprint, results Json,
  resultCount Int, createdAt, expiresAt }` + `@@index([expiresAt])` +
  `@@index([knowledgeVersionFingerprint])`. Additive (0 removed lines vs
  `origin/main`).
- `prisma/migrations/20260909120000_add_knowledge_retrieval_cache/migration.sql`
  — GENERATED offline via `prisma migrate diff`, hand-reviewed, header
  **NOT APPLIED**. `1× CREATE TABLE` + `2× CREATE INDEX`. No `ALTER TABLE`,
  no `DROP`, no reference to any existing table, no FK, no `embedding`.
  `prisma migrate status`: **pending**.

### 2.3 Cache key / fingerprint (contract §7.6)

`sha256( normalizedLowerQuery | sortedScopes | callerScopeSig | topK |
CONFIG_VERSION | knowledgeVersionFingerprint )`:

| Retrieval input | Where in the key |
|---|---|
| query representation | `normalizedLowerQuery` |
| requested scopes | `sortedScopes` (order-insensitive) |
| visibility | `callerScopeSig` = `<role>:…` → role → allowed visibilities |
| user isolation | `callerScopeSig` = `…:<userId>` when `includeUserScope` — a different user's equivalent query has a **different key** |
| result limit | `topK` |
| retrieval threshold / ranking config | `CONFIG_VERSION` (`RETRIEVAL_CONFIG_VERSION = "k2-1"`) — bump it and every entry misses, no migration |
| knowledge version / lifecycle / supersession | `knowledgeVersionFingerprint` (the `KnowledgeVersionCounter`) — bumped by activation / deprecation / archival / reinstatement / new-version / supersession **and the freshness sweep's auto-deprecations** |
| freshness (time-based `expiresAt` passing) | not in the fingerprint, but the hit path re-filters live (`isEligible` checks `expiresAt > now`) and the sweep then deprecates → fingerprint bump |

### 2.4 Cache correctness (the cache is NEVER an authority)

On a cache hit `KnowledgeService`:
1. reads the raw `{chunkId, knowledgeId, chunkIndex, similarity}` list;
2. re-hydrates the **live** `Knowledge` rows (`store.getByIds`) and **live**
   `KnowledgeChunk` content (`store.getChunks`) — a chunk that was deleted /
   re-ingested away is dropped;
3. runs the **identical** `pipeline()` as a fresh retrieval — re-filter
   eligibility (`isEligible` + scope + visibility + user isolation) → threshold
   → score (fresh authority + freshness) → rank → context → sufficiency;
4. if nothing survives, returns `null` → the service does a **fresh
   retrieval** (a stale cache never yields an authoritative empty result).

A cache hit can never bypass authorization, user isolation, scope filtering,
visibility filtering, lifecycle eligibility, supersession filtering, or
expiry/freshness — **proven by `validate:knowledge-loop-cache`** including the
"sticky cache that ignores the fingerprint entirely" adversarial test.

### 2.5 No new infrastructure

No Redis, Upstash, Vercel KV, or any external cache. Postgres is the canonical
beta retrieval-cache store (K1_DECISION SO-3 rationale).

---

## 3. K2-B — Retrieval Logging

`KnowledgeRetrievalLog` (created in K1, live in production) — **no new table**.
K2-B wires the canonical emit in `KnowledgeService`:

- **Every** terminal retrieval emits exactly one log row — cache hit, cache
  miss, fresh retrieval, threshold miss, embedding failure. (`empty-query`
  still logs, with `queryHash("")`.)
- `fromCache` now distinguishes **hit vs miss** (was always `false` in K1).
- `hitCount` = result count; `bestSimilarity`, `sufficiency`, `scopes`,
  `latencyMs`, `conversationId` per contract §8.
- **No sensitive content**: only `queryHash` (sha256 of the normalized query)
  is stored — never raw query text (it is already in `Message`). Asserted:
  `JSON.stringify(log)` never contains the query words.
- The log is not a second source of truth — it is append-only observability;
  retrieval never reads it back.
- `AnalyticsEvent` is **not** modified (no K2 requirement for it).

---

## 4. K2-C — Freshness Sweep

`services/knowledge-loop/knowledge/freshness-sweep.ts` — `runFreshnessSweep({
store, clock?, maxDeprecations? })`. A pure orchestration over
`KnowledgeStore` (no `prisma.` import, no route).

**Freshness is retrieval eligibility metadata, not governance.** The sweep:

| Row state | Sweep action |
|---|---|
| STATIC / fresh PERIODIC / within-window DYNAMIC | **untouched** |
| `PERIODIC` past `lastReviewedAt + freshnessReviewEveryDays` | **FLAGGED ONLY** in the report (`periodicReviewDue`, with `longOverdue`). Never auto-deprecated — a human decides (K4/K6). Retrieval already demotes it via `STALE_PENALTY` at query time. |
| `DYNAMIC` past `expiresAt` (and `active`) | **auto-deprecated** (`to: "deprecated"`, `reason: "expired"`, actor `system:freshness-sweep`) — contract-sanctioned (KNOWLEDGE_CONTRACT §5, transition table §4.4). Bumps the version fingerprint (§7.4). Retrieval already excluded it (`expiresAt > now`); this makes it permanent + auditable + cache-invalidating. |
| `DYNAMIC` with no `expiresAt` | **untouched** |
| already `deprecated` / `archived` / `superseded` | **skipped** (sweep only scans `lifecycleStatus = 'active'` + guards) |

**HARD LIMITS (owner-locked, verified by test + `validate:knowledge-loop-schema`):**
never touches `KnowledgeCandidate`; never transitions **to** `active`/`draft`;
never approves/promotes a candidate; never bypasses human review. A sweep can
only make a row **less** reachable. `maxDeprecations` caps auto-deprecations
per run (safety valve for the first production run).

INV-1: a swept-deprecated row is immediately ineligible for retrieval
(proven). A superseded row is guarded and never transitioned again.

---

## 5. K2-D — Retrieval Integration

`KnowledgeService` (extended, backward-compatible):

```
retrieve(query, opts)
  ├─ normalizeQuery → (empty → log + return, never cached)
  ├─ fingerprint = store.getVersionFingerprint()
  ├─ cacheKey = retrievalCacheKey(lowerQuery, scopes, callerScopeSig, topK, fingerprint)  [+ CONFIG_VERSION inside]
  ├─ retrievalCache?.get(cacheKey)
  │     HIT  → fromCacheEntries():
  │              hydrate LIVE Knowledge + chunks → pipeline() [re-filter/threshold/score/rank/context]
  │              survived → log(fromCache:true) + return
  │              nothing survived → fall through to fresh
  │     MISS → continue
  ├─ embed(normalizedQuery)   (failure → log + return, never cached)
  ├─ vectors.searchSimilar({ embedding, topK, scopes, visibilities, includeUserScope, callerUserId })   ← unchanged K1 VectorRepository
  ├─ store.getByIds(knowledgeIds)  → pipeline() [same as the hit path]
  ├─ log(fromCache:false)
  └─ retrievalCache?.set(cacheKey, {results: eligible-above-threshold hits}, {…}, TTL)
        only when reason ∈ {ok, below-threshold, no-eligible-rows}
```

- `VectorRepository.searchSimilar` and the pgvector architecture are
  **unchanged** — K2 wraps, never rewrites.
- `retrievalCache` is an **optional** dependency. Omit it →
  `KnowledgeService` behaves byte-identically to K1 (`fromCache` always
  `false`, no cache read/write). Proven.
- The `pipeline()` (re-filter → threshold → score → rank → context →
  sufficiency) is **one** deterministic function shared by the fresh and the
  cache-hit path — the INV-1 re-filter runs on both.
- `createKnowledgeService({ withRetrievalCache })` wires
  `PrismaRetrievalCache` by default; `createFreshnessSweep()` /
  `purgeRetrievalCache()` are the K6-cron entry points (functions only, no
  route in K2).

---

## 6. Backward compatibility

| Caller | Result |
|---|---|
| `app/api/private/knowledge/chat/route.ts` | **untouched** (not in the diff) — still calls `VectorRepository.searchSimilar` with no `scopes` → the pre-K1 SQL path, byte-identical |
| `app/api/private/knowledge/search/route.ts` | **untouched** — same |
| `research.knowledge_search` tool | **untouched** — same; `validate:agent-tools` + `validate:agent-research` green |
| `VectorRepository.searchSimilar()` | **not modified in K2** (K1's additive `scopes`/`visibilities` params are unchanged) |
| `KnowledgeService` without a `retrievalCache` dep | byte-identical to K1 — proven by `validate:knowledge-loop-cache` "backward compat" + the unchanged `validate:knowledge-loop-retrieval` 15/15 |
| existing `validate:knowledge-loop-*` (K1) | schema 19/0 (was 15 — +4 K2 checks), retrieval **15/0 unchanged**, ingestion 3/0 |

No unrelated caller was forced to understand K2 cache concepts.

---

## 7. INV-1 — unapproved / ineligible knowledge is structurally unreachable

| Obligation | Result | Evidence |
|---|---|---|
| candidate remains unreachable | **PASS** | `validate:knowledge-loop-cache` "cannot leak a superseded version or a candidate"; the retrieval cache stores only chunk ids of `Knowledge` rows, `retrieval-cache.ts` has zero `Candidate` reference (schema-validator asserted) |
| rejected / pending / under-review knowledge unreachable | **PASS** | inherited from K1 (`KnowledgeCandidate` is a separate table the retriever never queries) + the cache never changes that |
| candidate text with identical embedding/query unreachable | **PASS** | `validate:knowledge-loop-cache` + `-freshness` — identical-text candidate never surfaces, cached or not |
| approved → active → ingested becomes retrievable | **PASS** | K1-F live smoke (unchanged) + `validate:knowledge-loop-retrieval` |
| deactivated / deprecated / superseded becomes ineligible | **PASS** | `validate:knowledge-loop-cache` "fingerprint invalidation" + `-freshness` "swept row ineligible" |
| **a stale cache entry can NEVER resurrect an otherwise-ineligible row** | **PASS** | `validate:knowledge-loop-cache` — the **"sticky cache"** adversarial test: a cache that deliberately ignores the version fingerprint still cannot serve a row that was deprecated after the entry was written, because the service re-hydrates + re-filters live on every hit |

---

## 8. Cache isolation

| Scenario | Result |
|---|---|
| User A retrieves private `scope=user` row → cache populated → User B issues equivalent query | **User B gets 0 hits, `fromCache: false`** — B's `callerScopeSig` differs so B cannot even key into A's entry, and the live re-filter would drop it anyway |
| shared / assistant / support scope | scope-filter enforced on both the fresh and the cache-hit path (K1 semantics, re-run on hit) |
| customer-visibility row requested by a `guest` | **0 hits, `fromCache: false`** — guest's `callerScopeSig` differs; visibility re-filter on hit |
| owner-only visibility | `scope=user` rows keyed to and re-filtered for the owner id |

`validate:knowledge-loop-cache` — "cross-user isolation" + "visibility
isolation" tests.

---

## 9. Migration

| | |
|---|---|
| Migration | `prisma/migrations/20260909120000_add_knowledge_retrieval_cache/migration.sql` |
| Generated | offline via `prisma migrate diff` (schema-to-schema, no DB), hand-reviewed |
| Content | `1× CREATE TABLE "KnowledgeRetrievalCache"` + `2× CREATE INDEX` |
| Additive audit | no `DROP` / `ALTER COLUMN` / `DELETE` / `UPDATE…SET` / `TRUNCATE`; **no `ALTER TABLE` at all** (pure new table); no reference to any existing table; no FK; no `embedding`. `git diff origin/main -- prisma/schema.prisma` = **0 removed lines**. |
| `prisma migrate status` | **`20260909120000_add_knowledge_retrieval_cache` — not yet applied** |
| Applied? | **NO.** `prisma migrate deploy` NOT run. `prisma migrate dev` NOT run. |
| Parity | a fresh `prisma migrate diff` against current `origin/main` is statement-identical to the committed file |

---

## 10. Tests — exact commands + results

**New K2 suites** (offline — `InMemoryKnowledgeBackend` + `InMemoryRetrievalCache`
+ `FakeEmbedder`; ZERO DB, ZERO Gemini):

```
npm run validate:knowledge-loop-cache       → 12 passed, 0 failed
npm run validate:knowledge-loop-freshness    →  8 passed, 0 failed
npm run validate:knowledge-loop-schema       → 19 passed, 0 failed   (K1 15 + 4 new K2 checks)
```

**K1 suites re-run (regression):**

```
npm run validate:knowledge-loop-retrieval    → 15 passed, 0 failed   (UNCHANGED)
npm run validate:knowledge-loop-ingestion    →  3 passed, 0 failed   (UNCHANGED)
```

**Coverage map (K2 sprint prompt §12):**

| Area | Where |
|---|---|
| Cache: miss / hit / deterministic key / fingerprint mismatch / lazy invalidation / expired / concurrent-safe (upsert) | `validate:knowledge-loop-cache` |
| Retrieval: semantic search / threshold / limit / scope / visibility / lifecycle / supersession / freshness | `validate:knowledge-loop-retrieval` (K1, unchanged) + `-cache` (on the cache path) |
| Logging: hit / miss / fresh / result count / metadata / no sensitive content | `validate:knowledge-loop-cache` (K2-B tests) |
| Freshness: fresh / stale / expired / deprecated / superseded / no-expiry / cap | `validate:knowledge-loop-freshness` |
| Security: cross-user cache isolation / scope isolation / candidate exclusion / rejected exclusion / cache-cannot-bypass-eligibility | `validate:knowledge-loop-cache` |
| Regression: knowledge/chat / research.knowledge_search / VectorRepository / agent suites | §11 |

**`tsc --noEmit`:** 1 error total, pre-existing and unrelated
(`services/algo-test/optimization.service.ts` — `at24-quant-engine`
`RUNTIME_VERSION`, on `origin/main`, **left untouched** per instruction). 0
errors in any K2 file. **`eslint`:** clean for all K2 files.

---

## 11. Regression

**19 / 19 existing suites green, 0 failures:**

| Suite | | Suite | |
|---|---|---|---|
| `agent-tools` | 20 / 0 | `agent-supervisor` | 11 / 0 |
| `agent-research` | 9 / 0 | `agent-credit` | 13 / 0 |
| `agent-memory` | 19 / 0 | `agent-run-persistence` | 17 / 0 |
| `agent-contracts` | 38 / 0 | `agent-hardening` | 18 / 0 |
| `agent-runtime` | 9 / 0 | `context` (Context Manager) | 21 / 0 |
| `agent-integrity` | 21 / 0 | `messages` (Conversation msgs) | 13 / 0 |
| `agent-authorization` | 17 / 0 | `orchestration` (chat) | 7 / 0 |
| `agent-evaluation` | 9 / 0 | `publishing-contract` | 39 / 0 |
| `decision-context` | 16 / 0 | `publishing-persistence` | 16 / 0 |
| | | `internal-blog-adapter` | 15 / 0 |

The agent suites are the load-bearing signal: `research.knowledge_search` and
the whole agent framework sit on the same `RepositoryFactory.vectors()` /
`VectorRepository` — untouched by K2. No pre-existing test was weakened.

`knowledge/chat` non-stream contract: unchanged (route not in the diff).
`research.knowledge_search`: unchanged; agent suites green.

---

## 12. Files changed

**Added (5):**

```
frontend/services/knowledge-loop/knowledge/retrieval-cache.ts    PrismaRetrievalCache + InMemoryRetrievalCache
frontend/services/knowledge-loop/knowledge/freshness-sweep.ts    runFreshnessSweep
frontend/prisma/migrations/20260909120000_add_knowledge_retrieval_cache/migration.sql   (GENERATED, NOT APPLIED)
frontend/scripts/validate-knowledge-loop-cache.ts
frontend/scripts/validate-knowledge-loop-freshness.ts
frontend/docs/architecture/K2_ACCEPTANCE.md   (this file)
```

**Modified (7):**

```
frontend/docs/architecture/KNOWLEDGE_RETRIEVAL_CONTRACT.md   + ADR-K2-RETR-CACHE (§7.2), §7.5, §7.6, change-log entry
frontend/prisma/schema.prisma                                + model KnowledgeRetrievalCache (appended; 0 removed lines)
frontend/config/knowledge-loop.config.ts                     + RETRIEVAL_CONFIG_VERSION, RETRIEVAL_CACHE_PURGE_GRACE_MS, PERIODIC_LONG_OVERDUE_FACTOR
frontend/types/knowledge-loop/index.ts                       + CachedRetrieval / CachedRetrievalEntry / FreshnessSweepResult
frontend/services/knowledge-loop/knowledge/ports.ts          + RetrievalCachePort
frontend/services/knowledge-loop/knowledge/retrieval.ts      retrievalCacheKey extended (+ topK, + CONFIG_VERSION)
frontend/services/knowledge-loop/knowledge/knowledge-service.ts  cache read/write + fromCacheEntries + shared pipeline() + canonical log()
frontend/services/knowledge-loop/knowledge/index.ts          + exports; createKnowledgeService wires the cache; createFreshnessSweep / purgeRetrievalCache
frontend/scripts/validate-knowledge-loop-schema.ts           + 4 K2 checks
frontend/package.json                                        + 2 validate scripts
```

---

## 13. Files intentionally UNTOUCHED

`VectorRepository.ts` · `IngestionService.ts` · `TextChunker.ts` ·
`in-memory-backend.ts` · `prisma-backend.ts` · `ingestion-adapter.ts` ·
`KnowledgeChunk` model · the K1 migration · `KnowledgeAnswerCache` model ·
every do-not-touch item in §1.

---

## 14. Known limitations (carried to K3+)

| Limitation | Owner |
|---|---|
| `PrismaRetrievalCache` / the `KnowledgeRetrievalCache` table are **inert until the K2 migration is applied**. No production path exercises them until then. | K2 gate |
| The retrieval cache stores the **eligible, threshold-passing** hit set (chunk ids + similarity). If a row in that set becomes ineligible on replay it is dropped and not backfilled from pgvector — a slight quality dip on a stale hit, never a safety issue (contract: "never a source of truth"). | — |
| Conflict detection (`RetrievalResult.conflict`) is still typed but not computed (K0 §6) — deferred. | K3 |
| Near-duplicate chunk collapse is still a conservative prefix-match (K1). | — |
| The freshness sweep + retrieval-cache purge are **functions**, not wired to a Vercel cron — that wiring (and the analytics-event emit, `KNOWLEDGE_ANALYTICS_CONTRACT.md`) is K6. `createFreshnessSweep()` / `purgeRetrievalCache()` are the entry points. | K6 |
| `KnowledgeRetrievalLog` `webSearchFollowed` stays `false` — it is set by the K3 orchestrator when it goes to web search after a retrieval. | K3 |
| No production smoke in this report — the migration is NOT APPLIED. A K1-F-style controlled smoke runs after the gate is authorised (§15). | K2 gate |

---

## 15. Post-apply verification — **EXECUTED 2026-09-09 (owner-authorized)**

> Owner authorization: "K2 MIGRATION GATE — PRODUCTION APPLY + LIVE VERIFICATION"
> — authorized applying **only** `20260909120000_add_knowledge_retrieval_cache`.

### 15.1 Pre-migration production check (STEP 1)

| Check | Result |
|---|---|
| `prisma migrate status` (pre) | exactly **one** pending migration — `20260909120000_add_knowledge_retrieval_cache`. Migration history clean (all prior `done: true`, no rolled-back rows). |
| `_prisma_migrations` K2 row (pre) | **absent** — not yet applied |
| `Knowledge` table | present, 43 columns (22 base + 21 K1) |
| `KnowledgeChunk` table | present; `embedding` column `udt_name = vector` |
| `KnowledgeChunk` indexes (pre) | `KnowledgeChunk_pkey`, `KnowledgeChunk_deletedAt_idx`, `KnowledgeChunk_knowledgeId_idx`, `KnowledgeChunk_userId_idx`, **`KnowledgeChunk_embedding_hnsw_idx`** |
| `KnowledgeChunk_knowledgeId_fkey` | present |
| pgvector extension | `vector 0.8.2` |
| `KnowledgeRetrievalCache` (pre) | **does not exist** (as expected) |

### 15.2 Final migration review (STEP 2)

`git hash-object` of the migration file on disk == the blob on `origin/main`
(`9e3482fe63ab9c8033829665275ecb4062c0736e`) — unchanged since the K2-A commit
`eccee32`. Content: `1× CREATE TABLE "KnowledgeRetrievalCache"` +
`1× PRIMARY KEY` + `2× CREATE INDEX`. Greps (non-comment body): **0** for
`DROP`, `ALTER TABLE`, `ALTER COLUMN`, `FOREIGN KEY`, `DELETE FROM`,
`TRUNCATE`, `embedding`, `vector`, `hnsw`, `"Knowledge"`, `"KnowledgeChunk"`.

### 15.3 Migration applied (STEP 3 / STEP 4)

```
$ npx prisma migrate deploy
Applying migration `20260909120000_add_knowledge_retrieval_cache`
All migrations have been successfully applied.

$ npx prisma migrate status
Database schema is up to date!
```

Applied **exactly once**, ~2026-09-09T08:44Z. `_prisma_migrations` row:
`{ migration_name: "20260909120000_add_knowledge_retrieval_cache", finished_at:
<set>, rolled_back_at: null }`. `migrate dev` NOT used. No other migration ran.

### 15.4 Live schema verification (STEP 5)

| Check | Result |
|---|---|
| `KnowledgeRetrievalCache` table | **exists** — 8 columns, correct types (`key` text PK, `queryHash`/`scopeSig`/`knowledgeVersionFingerprint` text, `results` jsonb, `resultCount` integer, `createdAt`/`expiresAt` timestamp) |
| `KnowledgeRetrievalCache` indexes | `KnowledgeRetrievalCache_pkey`, `KnowledgeRetrievalCache_expiresAt_idx`, `KnowledgeRetrievalCache_knowledgeVersionFingerprint_idx` — the 2 K2 indexes + pkey |
| `KnowledgeRetrievalCache` FKs | **none** (structural island, as designed) |
| `Knowledge` post-migration | **43 columns — unchanged** |
| `KnowledgeChunk` post-migration | `embedding` still `vector`; indexes **byte-identical** to pre (HNSW `KnowledgeChunk_embedding_hnsw_idx` intact); FK `KnowledgeChunk_knowledgeId_fkey` intact |
| pgvector extension | `vector 0.8.2` — **unchanged** |
| unintended schema drift | **NONE** — K2 adds only its retrieval-cache table |

### 15.5 Offline K2 suite post-migration (STEP 6)

```
validate:knowledge-loop-cache       → 13 passed, 0 failed
validate:knowledge-loop-freshness    →  8 passed, 0 failed
validate:knowledge-loop-schema       → 19 passed, 0 failed
validate:knowledge-loop-retrieval    → 15 passed, 0 failed
validate:knowledge-loop-ingestion    →  3 passed, 0 failed
```
Regression (`agent-tools` 20, `agent-research` 9, `orchestration` 7, `context`
21) — all `/ 0`.

### 15.6 Controlled live smoke against production (STEP 7) — **23 / 23 PASS**

Real `PrismaKnowledgeStore` + `PrismaVectorSearch` (pgvector) +
`PrismaRetrievalCache` + real `KnowledgeService`. Every row tagged
`_k2gate_<ts>`; all hard-deleted afterward.

| Test | Result |
|---|---|
| **A — MISS → WRITE** | first retrieval `fromCache: false`; valid pgvector result; exactly one `KnowledgeRetrievalCache` row created; the row's `results` holds `{chunkId, knowledgeId, chunkIndex, similarity}` **only** — no answer text; `KnowledgeRetrievalLog` row `fromCache: false`, sha256 `queryHash`, **no raw query text** |
| **B — HIT → LIVE REHYDRATION** | identical retrieval `fromCache: true`; returns the same knowledge; **hit content == the LIVE `KnowledgeChunk` content** (not a cached snapshot); the full re-filter/rank pipeline ran (context block + sufficiency); log `fromCache: true` |
| **C — LIFECYCLE INVALIDATION (live INV-1)** | `deprecate` bumped the version fingerprint; the next retrieval — with the stale cache entry still present — **cannot return the now-deprecated row**; no invalid result leaked |
| **D — USER ISOLATION** | owner retrieves their `scope=user` row (tagged unverified); a **different user gets ZERO hits** for the equivalent query and does **not** key into the owner's cache entry; guest boundary holds on the cache path |
| **E — CONFIG / FINGERPRINT INVALIDATION** | same config → HIT; a different `topK` (a key dimension, §7.6) → **MISS, not a false HIT**; a fingerprint change **orphans the old entry with no migration**; no production config was mutated |
| **F — CACHE FAILURE RESILIENCE** | with an injected `RetrievalCachePort` whose `get` **and** `set` both throw, retrieval **still returns the correct result** (`fromCache: false`, no user-visible outage); the no-cache (K1) path returns the same knowledge |
| **CLEANUP** | `Knowledge=0  KnowledgeChunk=0  KnowledgeRetrievalCache=0  KnowledgeRetrievalLog=0` — every tagged temp row removed |

### 15.7 Defect found + fixed during verification

Live smoke TEST B initially failed: `PrismaRetrievalCache.get()` passed the raw
jsonb `results` column (a bare array) to a helper that expected `{ results: […] }`,
so every cache **hit** deserialized to an empty result set — the cache-hit path
was a silent no-op in production. The offline `InMemoryRetrievalCache` never
hit that shape, so the offline suite missed it.

**Fix:** `normalizeCachedResults()` (renamed, exported) now accepts **both**
`{ results: […] }` (the `set` input) and a bare entries array (the Postgres
`get` output). + a regression test in `validate:knowledge-loop-cache` pinning
the jsonb-array read path. Re-run: **offline cache suite 13/0, live smoke
23/23**. No schema/contract/design change — a read-path defect fix. Committed
as a K2 fix and merged to `main`.

### 15.8 Final sanity (STEP 9)

`prisma migrate status` → "Database schema is up to date!" (applied once).
`git diff origin/main` after the gate = only the K2 defect fix (3 files:
`retrieval-cache.ts`, `index.ts`, `validate-knowledge-loop-cache.ts`) + this
`K2_ACCEPTANCE.md` update. **No K3 files. No provider / orchestration /
assistant-route / answer-cache / agent-framework / publishing / quant /
marketplace / UI change.**

---

## 16. K2 Migration Gate

```
K2 MIGRATION GATE:  AUTHORIZED → APPLIED → VERIFIED
```

- **AUTHORIZED** — owner, 2026-09-09 ("K2 MIGRATION GATE — PRODUCTION APPLY +
  LIVE VERIFICATION"), scoped to `20260909120000_add_knowledge_retrieval_cache`
  only.
- **APPLIED** — `prisma migrate deploy`, ~2026-09-09T08:44Z, that migration
  only, once, `rolled_back_at: null`. `migrate dev` not used.
- **VERIFIED** — production schema introspection (§15.4): the retrieval-cache
  table + 2 indexes exist; every existing table / index / FK / pgvector /
  HNSW is byte-identical to pre-migration; zero unintended drift. Offline K2
  suite 58/0 post-migration (§15.5). Live smoke 23/23 with full cleanup
  (§15.6). One read-path defect found + fixed + re-verified (§15.7).

**K2 is OPERATIONALLY COMPLETE.**

---

## 17. Change log

| Date | Entry |
|---|---|
| 2026-09-09 | K2-A..K2-E implemented on `feat/k2-knowledge-retrieval`, merged to `main` `4128312`. ADR-K2-RETR-CACHE recorded (retrieval cache → Postgres). `KnowledgeRetrievalCache` model + migration (GENERATED, NOT APPLIED at merge). Retrieval-cache read/write + canonical logging wired into `KnowledgeService`, backward-compatible. Freshness sweep (DYNAMIC-expired auto-deprecate; PERIODIC flag-only; never touches candidates). 57 offline assertions + 19/19 regression green. |
| 2026-09-09 | **K2 Migration Gate — AUTHORIZED → APPLIED → VERIFIED.** Owner authorized applying `20260909120000_add_knowledge_retrieval_cache` only. `prisma migrate deploy` (~08:44Z, once, no `migrate dev`). Post-apply: schema up to date; retrieval-cache table + 2 indexes live; every existing table/index/FK/pgvector/HNSW byte-identical; zero drift. Offline K2 suite 58/0 post-migration. Live smoke against prod **23/23** (miss→write, hit→live-rehydrate, lifecycle invalidation [live INV-1], user isolation, config/fingerprint invalidation, cache-failure resilience) + full cleanup. One read-path defect found + fixed live (`normalizeCachedResults` now reads both `{results}` and a bare jsonb array) + regression test added + re-verified. **K2 OPERATIONALLY COMPLETE. K3 UNLOCKED (not started).** |
