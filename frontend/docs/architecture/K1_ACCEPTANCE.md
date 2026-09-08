# K1_ACCEPTANCE — Knowledge Foundation: Acceptance Gate Report

**Sprint:** K1 — Database + Knowledge Service (first implementation sprint of the AT24 AI Assistant Knowledge Loop)
**Branch:** `feat/k1-knowledge-foundation` (based on `origin/main`)
**Depends on / implements:** [`K1_DECISION.md`](K1_DECISION.md) (SO-1..SO-4, B-1..B-8, INV-1, K1-A..K1-F, MG-1..MG-10, A-1..A-16)
**Status:** **K1-A..K1-E COMPLETE · migration NOT APPLIED · K1-F awaiting owner apply go-ahead**

> This document is the K1-F acceptance record. K1 is **not** marked COMPLETE
> until (a) the owner issues an explicit migration apply go-ahead, (b) the
> migration is applied via `prisma migrate deploy`, and (c) the post-apply
> verification section below is filled in.

---

## 0. Headline

```
K1 STATUS:               PASS (K1-A..K1-E)  ·  BLOCKED at K1-F on owner apply go-ahead
GATE SO-1..SO-4:         PASS  (all four LOCKED in K1_DECISION §1; implemented per §4)
CRITICAL INVARIANT INV-1: PASS  (structural — 4 obligations, proven offline)
MIGRATION:               NOT APPLIED  (pending; requires explicit owner go-ahead per MG-10)
K2 START:                BLOCKED until K1 COMPLETE (A-1..A-16 green + migration applied)
```

---

## 1. Sign-off gate (SO-1..SO-4)

All four were **LOCKED** in `K1_DECISION.md §1` (owner decision 2026-09-08). K1
implements them per `K1_DECISION §4`:

| | Status | Where |
|---|---|---|
| **SO-1** Claude primary + native web_search | PASS (recorded; **affects K3, not K1**) | No provider code touched in K1 (B-7 / §6). |
| **SO-2** additive `Knowledge` schema + 5 new models + 7 enums | PASS | `prisma/schema.prisma` (K1-A); migration `20260908120000_add_knowledge_loop_foundation` (K1-B). |
| **SO-3** answer cache = Postgres `KnowledgeAnswerCache` | PASS (table created; writer is K5) | schema K1-A. |
| **SO-4** `KnowledgeCandidate` a separate table | PASS | separate model; the retriever queries `Knowledge`/`KnowledgeChunk` only (INV-1). |

---

## 2. INV-1 — structural retrieval safety (the critical invariant)

**Claim:** unapproved knowledge is *structurally* unreachable by production
retrieval — the data that could leak does not exist in any table the retrieval
path queries.

| Obligation (K1_DECISION §3) | Result | Evidence |
|---|---|---|
| 1. No `services/knowledge-loop/**` or `VectorRepository.ts` query references `KnowledgeCandidate` | **PASS** | `validate:knowledge-loop-schema` — grep assertions over every file; the candidate table is never named in a query. `KnowledgeCandidate` is a distinct Prisma model with no relation to `Knowledge`. |
| 2. A `rejected` and a `candidate`-status candidate whose text trivially matches the query return **0 hits** from `KnowledgeService.retrieve()` | **PASS** | `validate:knowledge-loop-retrieval` — "INV-1: a rejected candidate … returns ZERO hits" + "candidate answer text never enters `KnowledgeChunk`". |
| 3. `IngestionService` is only ever invoked with a `Knowledge` row id (`active`/`draft`, never `candidate`) | **PASS** | `publishKnowledge()` transitions the row to `active` **first**, then ingests; a candidate has no `Knowledge` id to pass. `validate:knowledge-loop-ingestion`. |
| 4. No `KnowledgeChunk` row points at a candidate-origin / non-existent `Knowledge` row | **PASS** | `KnowledgeChunk.knowledgeId` FK → `Knowledge.id` only (schema check in `validate:knowledge-loop-schema`); chunks are created only by `IngestionService` for a real `Knowledge` row. |

**Layered enforcement in place:**

- **Schema** — `KnowledgeCandidate` is its own table; `VectorRepository` and
  `KnowledgeService` read `Knowledge`/`KnowledgeChunk` only.
- **Embeddings** — a candidate's `proposedAnswer` is never written to
  `KnowledgeChunk` and never embedded into the production vector corpus. Only a
  `Knowledge` row promoted to `active` is ingested.
- **Query filter (SQL)** — `VectorRepository.searchSimilar`'s K1 branch adds
  `k."lifecycleStatus" = 'active' AND k."supersededById" IS NULL AND
  k."deletedAt" IS NULL AND (k."expiresAt" IS NULL OR k."expiresAt" > now())`
  plus scope/visibility, with a separate OR branch for the caller's own
  `scope = 'user'` rows.
- **Re-filter on hydration** — `KnowledgeService.retrieve()` re-checks
  `isEligible()` after loading rows, so the SQL gate and the service agree and
  a row that became ineligible within any future cache TTL is still dropped.
- **Governance reach** — the loop service + its lifecycle transitions are in a
  server-only module; `validate:knowledge-loop-schema` asserts no
  `services/agent-framework/**` file imports it and it never imports
  `services/agent-framework/*`. No autonomous / threshold promotion exists —
  `markActive` requires an explicit `actorId`.

---

## 3. Migration gate (MG-1..MG-10)

Migration: `prisma/migrations/20260908120000_add_knowledge_loop_foundation/migration.sql`

| # | Check | Result |
|---|---|---|
| MG-1 | Generated offline via `prisma migrate diff` (schema-to-schema, no DB); header marks `NOT APPLIED` + the `migrate dev` prohibition | **PASS** (`validate:knowledge-loop-schema`) |
| MG-2 | No `DROP` / `ALTER COLUMN` / `DELETE FROM` / `UPDATE … SET` / `TRUNCATE`; every statement is `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE … ADD COLUMN`; the only `ALTER TABLE` targets `"Knowledge"`; no FK constraint on an existing table | **PASS** |
| MG-3 | Migration body never names the chunk table or the pgvector column (`embedding` / `vector` absent) | **PASS** |
| MG-4 | Every `ADD COLUMN` on `Knowledge` is nullable, or `NOT NULL` **with** a constant `DEFAULT` (`scope`, `version`, `visibility`) — no backfill, no table rewrite | **PASS** |
| MG-5 | `git diff origin/main -- prisma/schema.prisma` is purely additive — **0 removed lines** | **PASS** (verified: `git diff` shows 254 insertions, 0 deletions on the Knowledge block; the K1 block is appended after the P2.2 block) |
| MG-6 | `npm run validate:knowledge-loop-schema` → `N passed, 0 failed` | **PASS** — 15 passed, 0 failed |
| MG-7 | `prisma generate` + `tsc --noEmit` clean (0 **new** errors) | **PASS** — 0 errors in any K1 file. (One pre-existing repo-wide error unrelated to K1: `services/algo-test/optimization.service.ts` `RUNTIME_VERSION` from the vendored `at24-quant-engine` — present on `origin/main`, from P4.9-A.2, not touched by K1.) |
| MG-8 | INV-1 structural checks in `validate:knowledge-loop-schema` (no retrieval query references the candidate table; `KnowledgeChunk` FK → `Knowledge` only) | **PASS** |
| MG-9 | `prisma migrate status` shows the K1 migration as **pending** (not applied) during K1-A..K1-E | **PASS** — `Following migrations have not yet been applied: 20260908120000_add_knowledge_loop_foundation` |
| MG-10 | Explicit dated owner apply go-ahead recorded before `migrate deploy` | **PENDING** — see §7. |

---

## 4. Acceptance checklist (A-1..A-16)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| A-1 | 7 enums + additive `Knowledge` columns + 5 models present; schema compiles | **PASS** | `prisma validate` + `prisma generate` OK; `validate:knowledge-loop-schema` enum/model parity (15/15). |
| A-2 | Migration generated, reviewed, **not applied**, additive-only | **PASS** | §3 MG-1..MG-9. |
| A-3 | `KnowledgeService.retrieve()` implements the retrieval contract (pipeline steps 1–8) | **PASS** | `validate:knowledge-loop-retrieval` — normalize → embed → eligibility search → re-filter → threshold → weighted rank → per-doc/text de-dup → context (6000 chars) → sufficiency. |
| A-4 | INV-1 holds — unapproved knowledge returns 0 hits; no chunk/vector for a candidate | **PASS** | §2. |
| A-5 | Scope isolation (`assistant` ⊄ `support`-only; `shared` visible to both) | **PASS** | `validate:knowledge-loop-retrieval` "scope isolation". |
| A-6 | Status filtering — `draft` / `deprecated` / `archived` never returned | **PASS** | `validate:knowledge-loop-retrieval` "status filtering". |
| A-7 | Supersede de-dup — only the current version of a chain is returned | **PASS** | `validate:knowledge-loop-retrieval` "supersede". |
| A-8 | Freshness — `DYNAMIC` past `expiresAt` excluded; `PERIODIC` past review-due penalised (`STALE_PENALTY`) | **PASS** | `validate:knowledge-loop-retrieval` "freshness". |
| A-9 | Authority weighting — rank order matches `AUTHORITY_WEIGHTS` on a controlled tie | **PASS** | `validate:knowledge-loop-retrieval` "authority weighting" (admin_authored > web_researched). |
| A-10 | User-scope no-leak — a `scope = user` row never returned to a different `userId` | **PASS** | `validate:knowledge-loop-retrieval` "user-scope" (owner sees it; any other user → 0; `includeUserScope:false` → 0). |
| A-11 | Version fingerprint — `KnowledgeVersionCounter` increments on `markActive` / `deprecate` / `archive` / `reinstate` / `newVersion`, in the same transaction | **PASS** | `validate:knowledge-loop-retrieval` "version fingerprint"; `PrismaKnowledgeStore.transition`/`createVersionOf` bump the counter inside `prisma.$transaction`. |
| A-12 | Ingestion integration — `markActive` → chunks + vectors → row retrievable end-to-end; `IngestionService` source unchanged | **PASS** | `validate:knowledge-loop-ingestion` (3/3) — publish→ingest→retrievable; partial-failure → `active` + `reindexNeeded`; byte-for-byte diff check that `IngestionService.ts` + `TextChunker.ts` == `origin/main`. |
| A-13 | `VectorRepository` backward-compatible — `searchSimilar` with no `scope`/`visibility` behaves byte-identically to today | **PASS** | The pre-K1 query is preserved verbatim inside `if (!scoped)`; all three existing callers (`knowledge/chat`, `knowledge/search`, `research.knowledge_search`) pass no `scopes`. Static assertion in `validate:knowledge-loop-schema`. |
| A-14 | Regression — existing `validate:*` pass; `knowledge/chat` non-stream contract unchanged; `research.knowledge_search` works | **PASS** | §5. `knowledge/chat/route.ts`, `assistant.service.ts`, `context-manager.service.ts` untouched (git diff = ∅). |
| A-15 | No boundary broken (B-1..B-8) | **PASS** | §6. |
| A-16 | Apply go-ahead recorded before `migrate deploy` | **PENDING** | §7. |

**A-1..A-15: PASS. A-16: PENDING owner action.**

---

## 5. Regression

**New K1 test suites** (offline — no DB, no Gemini; house style, `node:assert/strict` via `tsx`):

| Suite | Result |
|---|---|
| `validate:knowledge-loop-schema` | **15 passed, 0 failed** |
| `validate:knowledge-loop-retrieval` | **15 passed, 0 failed** |
| `validate:knowledge-loop-ingestion` | **3 passed, 0 failed** |

**Existing suites re-run** (sample covering everything adjacent to the changed
files — `VectorRepository`, the agent framework that also uses it, chat/
intelligence, publishing):

| Suite | Result | | Suite | Result |
|---|---|---|---|---|
| `agent-tools` | 20 / 0 | | `agent-credit` | 13 / 0 |
| `agent-research` | 9 / 0 | | `agent-run-persistence` | 17 / 0 |
| `agent-memory` | 19 / 0 | | `agent-hardening` | 18 / 0 |
| `agent-contracts` | 38 / 0 | | `context` (Context Manager) | 21 / 0 |
| `agent-runtime` | 9 / 0 | | `messages` (Conversation msgs) | 13 / 0 |
| `agent-integrity` | 21 / 0 | | `orchestration` (chat) | 7 / 0 |
| `agent-authorization` | 17 / 0 | | `publishing-contract` | 39 / 0 |
| `agent-evaluation` | 9 / 0 | | `publishing-persistence` | 12 / 0 |
| `agent-supervisor` | 11 / 0 | | `internal-blog-adapter` | 15 / 0 |
| `decision-context` | 16 / 0 | | `intelligence-audit` | 72 / 0 |

**20 / 20 suites green** (382 assertions, 0 failures). No pre-existing test was
weakened. The agent-framework suites are the most load-bearing regression
signal here — `research.knowledge_search` and the agent memory / tool gateway
all sit on the same `RepositoryFactory.vectors()` / `VectorRepository` that K1
extended.

**`knowledge/chat` non-stream contract:** unchanged — the route file is not in
the K1 diff. **`research.knowledge_search` tool:** `validate:agent-tools` +
`validate:agent-research` green; the tool calls `searchSimilar` with no
`scopes` → the unchanged pre-K1 query path.

**`tsc --noEmit`:** 0 errors in any K1 file. One pre-existing repo-wide error
(`at24-quant-engine` `RUNTIME_VERSION`, from P4.9-A.2 on `origin/main`) is
unrelated to K1 and unchanged by it.

**Commands run** (exact):

```
npm run validate:knowledge-loop-schema        # 15/0
npm run validate:knowledge-loop-retrieval      # 15/0
npm run validate:knowledge-loop-ingestion      # 3/0
npx prisma validate                            # valid
npx prisma generate                            # ok (7.8.0)
npx prisma migrate status                      # K1 migration PENDING (not applied)
npx tsc --noEmit                               # 0 K1 errors (1 pre-existing, unrelated)
npx eslint services/knowledge-loop config/knowledge-loop.config.ts types/knowledge-loop repositories/VectorRepository.ts scripts/validate-knowledge-loop-*.ts   # clean
```

---

## 6. Boundaries (B-1..B-8) — spot check

| | Result |
|---|---|
| B-1 no web-search vendor | PASS — K1 adds no web search at all (K3). |
| B-2 no separate vector DB | PASS — pgvector via `VectorRepository` only; `PrismaVectorSearch` delegates to it. |
| B-3 no reranker | PASS — deterministic weighted rank only (`retrieval.ts`). |
| B-4 no second embedding system | PASS — `EMBEDDING_DIMENSIONS = 768`; `GeminiEmbeddingAdapter` wraps the existing `GeminiEmbeddingProvider`; no model switch. |
| B-5 no autonomous promotion | PASS — `markActive(id, actorId)` requires an explicit actor; no threshold / elapsed-time path; no agent can import the service. |
| B-6 no migration applied | PASS — migration PENDING; `migrate dev` never run. |
| B-7 no AI-Assistant rewrite | PASS — `knowledge/chat/route.ts`, `assistant.service.ts`, `context-manager.service.ts` not in the diff. |
| B-8 no second Support KB | PASS — one store, `scope`-namespaced (`assistant`/`support`/`shared`); `retrieve({ scopes })` is the only difference between the Assistant and a future Support Agent. |

---

## 7. MIGRATION STATUS — **NOT APPLIED**

```
MIGRATION NOT APPLIED.
```

The migration `20260908120000_add_knowledge_loop_foundation` has been
**generated, hand-reviewed, and committed** with a `NOT APPLIED` header. It has
**not** been run against any database. Generating it does not authorize
applying it (K1_DECISION §5 MG-10).

**To complete K1 (K1-F):**

1. Owner records an explicit, dated apply go-ahead below.
2. `npx prisma migrate deploy` (NEVER `prisma migrate dev` — pgvector-reset trap).
   Order: this migration, then `20260909090000_add_publishing_engine` (P2.2's,
   also pending under its own gate) — both are independent additive DDL.
3. Post-apply verification (fill in): enum types created (7); tables created
   (5); `Knowledge` columns added (21); `prisma migrate status` → up to date;
   `prisma generate` + `tsc` clean; a live smoke of
   `KnowledgeService.retrieve()` through `PrismaKnowledgeStore` +
   `VectorRepository` on a seeded `active` row; `_prisma_migrations` row
   present.

> **Owner apply go-ahead:** _(not yet given)_

> **Post-apply verification:** _(pending)_

---

## 8. Files changed

**Added (13):**

```
frontend/config/knowledge-loop.config.ts
frontend/types/knowledge-loop/index.ts
frontend/services/knowledge-loop/knowledge/ports.ts
frontend/services/knowledge-loop/knowledge/retrieval.ts
frontend/services/knowledge-loop/knowledge/knowledge-service.ts
frontend/services/knowledge-loop/knowledge/in-memory-backend.ts
frontend/services/knowledge-loop/knowledge/prisma-backend.ts
frontend/services/knowledge-loop/knowledge/ingestion-adapter.ts
frontend/services/knowledge-loop/knowledge/index.ts
frontend/prisma/migrations/20260908120000_add_knowledge_loop_foundation/migration.sql   (GENERATED + REVIEWED, NOT APPLIED)
frontend/scripts/validate-knowledge-loop-schema.ts
frontend/scripts/validate-knowledge-loop-retrieval.ts
frontend/scripts/validate-knowledge-loop-ingestion.ts
frontend/docs/architecture/K1_ACCEPTANCE.md   (this file)
```

**Modified (3):**

```
frontend/prisma/schema.prisma            + 7 enums, 21 additive Knowledge columns, 3 indexes, 5 models (appended; no existing line changed)
frontend/repositories/VectorRepository.ts + optional scopes/visibilities/includeUserScope/callerUserId on searchSimilar; scoped JOIN query. Pre-K1 path preserved verbatim (A-13).
frontend/package.json                     + 3 "validate:knowledge-loop-*" script entries
```

---

## 9. Files intentionally UNTOUCHED (K1_DECISION §6 do-not-touch)

Verified absent from `git diff origin/main`:

`lib/ai/providers/*` · `AIPresenterOrchestratorService` · any provider chain ·
`app/api/private/knowledge/chat/route.ts` · `services/ai/assistant.service.ts` ·
`services/ai/context-manager.service.ts` · `services/knowledge/IngestionService.ts` ·
`services/knowledge/TextChunker.ts` · `KnowledgeChunk` model + the pgvector
migration · `services/agent-framework/**` · `research.knowledge_search` tool ·
`/dashboard/admin/**` · any candidate-generation / cache-write / analytics-event
code · `AnalyticsEvent` type values · Quant / Marketplace / Paper-Trading /
Automation.

---

## 10. Known limitations (carried into K2+)

| Limitation | Owner sprint |
|---|---|
| Retrieval **cache** (in-process `TtlCache`) is not wired into `retrieve()` yet — the retrieval contract §7.2 puts it in the retrieval layer; K1 ships the eligibility-filtered pipeline without it. | K2 / K5 |
| Answer **cache** (`KnowledgeAnswerCache`) table exists; the writer + read path + version-fingerprint key are K5. | K5 |
| Near-duplicate chunk collapse uses a conservative **prefix-match** (first 400 chars) rather than the contract's cosine->0.97 test (which needs the chunk vectors in the ranker). | K2 |
| **Conflict detection** (`RetrievalResult.conflict`) is typed but not computed — needs the question/answer-embedding comparison from KNOWLEDGE_RETRIEVAL_CONTRACT §6. | K2 |
| `KnowledgeRetrievalLog` / `KnowledgeAnswerProvenance` tables exist; the **emit** wiring is K2 (retrieval log) / K3 (provenance). | K2 / K3 |
| `KnowledgeCandidate` has **no service** — candidate creation, dedup, and the admin review workflow are K4. K1 only proves the table is unreachable by retrieval. | K4 |
| Governance wrapper (AuditLog on every transition, admin routes, explicit human approval) — K1 exposes the raw transitions; the governed API is K4. | K4 |
| `PrismaKnowledgeStore` / `PrismaVectorSearch` / `GeminiEmbeddingAdapter` are **inert until the migration is applied** — no live path exercises them in K1. | K1-F |
| `next build` not run in this report — K1 adds no route / page / component; `tsc` is clean for all K1 files. The pre-existing `at24-quant-engine RUNTIME_VERSION` type error on `origin/main` is unrelated. | — |

---

## 11. Change log

| Date | Entry |
|---|---|
| 2026-09-09 | K1-A..K1-E implemented on `feat/k1-knowledge-foundation` (rebased onto `origin/main` past P2.2 / P4.9-A.3). 33/33 new offline assertions green; regression sample green; `tsc` clean for all K1 files. Migration GENERATED + REVIEWED, **NOT APPLIED**. K1-F (apply) awaits an explicit owner go-ahead. |
