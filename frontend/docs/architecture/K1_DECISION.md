# K1_DECISION — Database + Knowledge Service: Gate Lock

**Sprint:** K1 — Database + Knowledge Service (first implementation sprint of the Knowledge Loop)
**Stage:** Gate lock — converts the K0 owner sign-offs into an explicit, checkable gate. **Precedes any K1 implementation code.**
**Inputs:** [`K0_DECISION.md`](K0_DECISION.md) (§4 PENDING-1..4); owner sign-off 2026-09-08;
[`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md),
[`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md),
[`KNOWLEDGE_RETRIEVAL_CONTRACT.md`](KNOWLEDGE_RETRIEVAL_CONTRACT.md),
[`KNOWLEDGE_GOVERNANCE_CONTRACT.md`](KNOWLEDGE_GOVERNANCE_CONTRACT.md)
**Status:** **4 sign-offs LOCKED · 8 boundaries LOCKED · 1 critical invariant LOCKED · K1 sub-steps defined · migration gate defined — implementation MAY BEGIN at K1-A**

> This document is the K1 gate. A coding agent starting K1 reads this first.
> A change to any LOCKED item requires a new dated ADR entry here, never an
> inline code choice. K1 ships **no migration application** and **no provider
> changes** — see §4 and §6.

---

## 0. Owner decision (2026-09-08)

K0 is a **GO**. All four K0 pending decisions are **APPROVED**. The K0
architecture and the five companion contracts are **LOCKED** as written.
Deliverables stay in Markdown (canonical format for contracts) — **no PDF
render**.

---

## 1. Sign-offs — now LOCKED

### SO-1 — Claude primary + Claude Native Web Search *(K0 PENDING-1)* — **LOCKED**

- `ANTHROPIC_API_KEY` (+ usage budget) will be provisioned **before K3**.
  K1 and K2 do not require it.
- Claude is promoted to the **preferred** slot in the existing provider chain.
  Order becomes `Claude → Gemini → OpenAI → DeterministicFallback`. The
  mechanism is the existing `AIPresenterOrchestratorService` slot pattern
  (`isAvailable()` env check → `createPresenter()` → `present()` → integrity
  validate → fall through) — **unchanged**.
- Web search is **Claude's native `web_search_20250305` server tool** only.
  `ClaudeProvider` (`lib/ai/providers/claude.provider.ts`) is extended to pass
  a `tools` array and parse `server_tool_use` / `web_search_tool_result`
  content blocks — REST, no `@anthropic-ai/sdk`, injectable `fetch` (the
  file's existing convention).
- **Affects K3, not K1.** Recorded here so K3 does not relitigate it.
- The `claude-api` skill MUST be consulted for model id / params / pricing
  before the K3 wiring.

### SO-2 — Knowledge additive-schema change *(K0 PENDING-2)* — **LOCKED**

- The canonical Knowledge entity is the **existing `Knowledge` model** +
  additive columns (never a separate `AssistantKnowledge` model).
- Additive columns on `Knowledge` (all nullable or defaulted — **no
  backfill**): `canonicalQuestion`, `canonicalAnswer`, `knowledgeType`,
  `scope` (default `user`), `visibility`, `sourceType`, `provenance` (Json),
  `confidence`, `status` (`KnowledgeStatus`, used for loop rows;
  `scope = user` legacy rows keep working per `KNOWLEDGE_CONTRACT.md` §4.3),
  `version` (default 1), `supersedesId`, `freshnessClass`,
  `freshnessReviewEveryDays`, `expiresAt`, `lastReviewedAt`, `approvedAt`,
  `approvedBy`, `deprecatedAt`, `deprecatedBy`, `lastRetrievedAt`.
  (`retrievalCount` already exists — reused as the usage counter, **not**
  duplicated.)
- New models: `KnowledgeCandidate`, `KnowledgeAnswerProvenance`,
  `KnowledgeRetrievalLog`, `KnowledgeAnswerCache`, `KnowledgeVersionCounter`
  (single-row).
- New enums: `KnowledgeStatus`, `KnowledgeScope`, `KnowledgeVisibility`,
  `KnowledgeType`, `KnowledgeFreshnessClass`, `KnowledgeSourceType`,
  `CandidateStatus`.
- `KnowledgeChunk` and its `embedding vector(768)` column are **untouched**.

### SO-3 — Answer-cache store *(K0 PENDING-3)* — **LOCKED**

- The answer cache is a **Postgres table** (`KnowledgeAnswerCache`) for beta.
- **No Redis / Vercel KV / Upstash / any cache SaaS** in beta.
- A future migration to a KV store is allowed **only** behind the unchanged
  cache interface, as a separately-scoped post-beta item.
- The retrieval cache stays an in-process `TtlCache` (best-effort,
  per-instance) — unchanged from `KNOWLEDGE_RETRIEVAL_CONTRACT.md` §7.2.

### SO-4 — `KnowledgeCandidate` as a separate model *(K0 PENDING-4)* — **LOCKED**

- `KnowledgeCandidate` is its **own table**. It is never merged into
  `Knowledge`, and a `Knowledge` row is never created in a "candidate" status.
- The production retriever queries **`Knowledge` only**. An unreviewed item
  has no row in a table the retriever reads — see INV-1 (§3).
- This is the AN1.9 `MemoryGateway` guarantee applied to knowledge:
  "pending is never surfaced by `read()`".

---

## 2. Locked boundaries (the do-not list)

These are LOCKED for the entire K1–K8 sequence. Breaking one requires a new
ADR entry here signed off by the owner.

| # | Boundary |
|---|---|
| B-1 | **No Tavily / Exa / Brave / any web-search vendor.** Web search is Claude-native only (SO-1). |
| B-2 | **No separate/alternative vector database.** pgvector + HNSW via `VectorRepository` only. |
| B-3 | **No reranker** (cross-encoder or LLM) in beta. Deterministic weighted rank only (`KNOWLEDGE_RETRIEVAL_CONTRACT.md` §3–§5). |
| B-4 | **No second embedding system / no embedding-model switch.** `gemini-embedding-001` @ 768-d stays. |
| B-5 | **No autonomous knowledge promotion.** No confidence threshold, no elapsed-time rule, no agent caller can move a candidate to `active`. Human admin only (`KNOWLEDGE_GOVERNANCE_CONTRACT.md` §2). |
| B-6 | **No migration applied until the K1 migration gate (§5) passes and the owner gives an explicit apply go-ahead.** Never `prisma migrate dev` (pgvector-reset trap). |
| B-7 | **No rewrite of the existing AI Assistant.** `app/api/private/knowledge/chat/route.ts`, `services/ai/assistant.service.ts`, `context-manager.service.ts`, the streaming/NDJSON contract, and `Conversation`/`Message` persistence are extended in K3, not rewritten. K1 touches none of them. |
| B-8 | **No duplication of the future Chat Support Agent KB.** One shared store, `scope`-namespaced (`assistant` / `support` / `shared`). |

Additional K0 non-goals still in force (`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md` §10):
no large admin UI, no speculative features, no unrelated model migrations, no
touching Quant / Marketplace / Paper-Trading.

---

## 3. Critical invariant — LOCKED

### INV-1 — Unapproved knowledge is **structurally** unreachable by production retrieval

Not "filtered out by application code" — **structurally unreachable**: the
data that could leak does not exist in any table the retrieval path queries.

**Enforcement (layered):**

| Layer | Mechanism |
|---|---|
| Schema | `KnowledgeCandidate` is a separate table. `VectorRepository.searchSimilar` and every `KnowledgeService.retrieve` query read `Knowledge` / `KnowledgeChunk` only — never `KnowledgeCandidate`. |
| Embeddings | A candidate's `proposedAnswer` is **not embedded into `KnowledgeChunk`**. Embeddings for a candidate (dedup only) are computed transiently and never persisted to the `embedding` column. Chunk rows + vectors exist **only** for `Knowledge` created by `Governance.approve()`. |
| Query filter | Every retrieval SQL adds `status = 'active' AND "supersededById" IS NULL AND "deletedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())`. `draft` / `deprecated` / `archived` are never returned to the orchestrator. |
| Scope | `scope = user` rows are returned only to their own `userId` and carry `authorityWeight ≤ 0.5`, tagged `unverified`. They never enter `assistant`/`shared` scope without `Governance.approve()`. |
| Governance reach | `Governance.approve/reject/deprecate/publishNewVersion` live in a server-only module never imported by `services/agent-framework/*`, any tool handler, or the client bundle. |

**Proof obligations (K1-B / K1-E tests — see §7):**

- `grep`-level assertion: no query builder in `services/knowledge-loop/**` or
  `repositories/VectorRepository.ts` references `KnowledgeCandidate` /
  `knowledgeCandidate`.
- A `rejected` candidate and a `candidate`-status candidate, each with content
  that would trivially match a query, return **zero** hits from
  `KnowledgeService.retrieve()`.
- `IngestionService` is only ever called with a `knowledgeId` of a row whose
  `status = 'active'` (or `draft` for admin-authored, never `candidate`).
- No row in `KnowledgeChunk` has a `knowledgeId` pointing at a non-existent or
  candidate-origin `Knowledge` row.

---

## 4. K1 scope — what this sprint builds

K1 = **schema + Knowledge Service + ingestion integration + retrieval-readiness
tests**. K1 does **not** build the orchestrator, the classifier, the candidate
generation path, the admin UI, the cache, the analytics events, or any provider
change. Those are K2–K6.

### K1-A — Schema implementation
- Add the 7 enums + additive `Knowledge` columns + 5 new models to
  `prisma/schema.prisma` (appended; **no existing line changed**).
- `prisma generate` succeeds; `npx tsc --noEmit` clean for the new types.
- **Exit:** schema compiles, generated client has the new models, no
  behavioural change (nothing reads the new columns yet).

### K1-B — Migration + invariant tests
- Generate the migration **offline** via `prisma migrate diff` (never
  `migrate dev`). Hand-review the SQL. Header marks it **`NOT APPLIED`**
  (AN1.9 / M-series precedent).
- SQL is **purely additive**: `CREATE TYPE`, `ADD COLUMN` (all nullable/
  defaulted), `CREATE TABLE`, `CREATE INDEX`. **No `DROP`, no
  `ALTER COLUMN`, no data migration.** Never references `KnowledgeChunk`'s
  `embedding` column.
- `scripts/validate-knowledge-loop-schema.ts` — asserts enum/model parity
  with the contracts, the migration's additive-only property, and the INV-1
  structural checks (§3 proof obligations 1 & 3).
- **Exit:** migration file reviewed + committed with `NOT APPLIED` header;
  schema validation script passes N/N; §5 gate items 1–6 green.

### K1-C — Knowledge Service
- `services/knowledge-loop/knowledge/` — `KnowledgeService` with:
  `create(draft)`, `getById`, `list(filter)`, `retrieve(query, opts)` (per
  `KNOWLEDGE_RETRIEVAL_CONTRACT.md` §3 — embed → `VectorRepository` →
  metadata filter → weighted rank → freshness → dedup → context select),
  and the lifecycle transition helpers **that Governance will call**
  (`markActive`, `deprecate`, `archive`, `reinstate`, `newVersion`) — the
  transitions exist and are tested; the **Governance wrapper + AuditLog +
  admin routes are K4**, not K1.
- `VectorRepository.searchSimilar` gains optional `scope: string[]` +
  `visibility: string[]` parameterized filters. **No behaviour change when
  omitted** (regression-tested).
- `KnowledgeVersionCounter` read/increment helper (single-row
  `UPDATE ... SET value = value + 1`, called inside the transition helpers'
  transaction).
- **Exit:** `KnowledgeService` unit-tested against a seeded set (fake
  embeddings); INV-1 retrieval proof (§3 obligation 2) passes.

### K1-D — Ingestion integration
- On `markActive`, `KnowledgeService` calls the **existing, unmodified**
  `IngestionService.ingest({ knowledgeId, userId, text })` → `KnowledgeChunk`
  rows + embeddings. `reembed()` reused for re-index.
- Partial embedding failure → `embeddingStatus = 'failed'`, row still
  `active`, a "re-index needed" flag surfaced (matches existing
  `IngestionService` semantics).
- **Exit:** an approved `Knowledge` row produces real chunks + vectors and is
  retrievable end-to-end in a test; `IngestionService` source is unchanged
  (asserted).

### K1-E — Retrieval-readiness tests
- `scripts/validate-knowledge-loop-retrieval.ts` — seeded knowledge across
  scopes/statuses/freshness classes; asserts:
  threshold behaviour (`RELEVANCE_MIN` 0.30, `RELEVANCE_GOOD` 0.45),
  scope isolation (`assistant` vs `support` vs `shared`),
  status filtering (`draft`/`deprecated`/`archived` never returned),
  supersede-chain de-dup (only current version),
  freshness demotion (`DYNAMIC` past `expiresAt` excluded; `PERIODIC` past
  review-due penalised),
  authority weighting order,
  user-scope leakage (a `scope = user` row never returned to another user),
  version-fingerprint changes on every transition.
- Regression: existing `validate:*` suites pass; `knowledge/chat` non-stream
  contract byte-identical; agent `research.knowledge_search` tool still works.
- **Exit:** all K1-E assertions green; regression green.

### K1-F — K1 acceptance gate
- §5 (migration gate) + §7 (acceptance checklist) all green.
- Owner gives the explicit **apply go-ahead**; migration applied via
  `prisma migrate deploy` (never `migrate dev`); post-apply verification
  recorded in a `K1.x` completion doc (AN1.9 "post-apply verification" style).
- **Only then** does K2 begin.

---

## 5. K1 migration gate — machine-checkable

Every item is a concrete check. K1-B is not complete until all are green.

| # | Check | How to verify |
|---|---|---|
| MG-1 | Migration generated offline, not via `migrate dev` | migration file header contains `GENERATED via prisma migrate diff (offline)` and `NOT APPLIED`; PR description states it |
| MG-2 | Migration is additive-only | `grep -iE '\b(DROP|ALTER COLUMN|DELETE FROM|UPDATE .* SET|TRUNCATE)\b' <migration.sql>` returns **nothing** |
| MG-3 | Migration never touches the vector column | `grep -i 'embedding' <migration.sql>` returns **nothing** |
| MG-4 | All new `Knowledge` columns are nullable or defaulted | `grep -iE 'ADD COLUMN.*NOT NULL' <migration.sql>` returns only lines that also contain `DEFAULT` |
| MG-5 | No existing schema line changed | `git diff origin/main -- prisma/schema.prisma` shows only appended blocks (no `-` lines except trailing-newline) |
| MG-6 | Schema validation passes | `npm run validate:knowledge-loop-schema` → `N passed, 0 failed` |
| MG-7 | `prisma generate` + `tsc --noEmit` clean | both run in CI on the K1 branch with 0 new errors |
| MG-8 | INV-1 structural checks pass | `validate:knowledge-loop-schema` includes: no retrieval query references `KnowledgeCandidate`; `KnowledgeChunk` FK only ever points at `Knowledge` |
| MG-9 | Migration **not applied** to any live DB during K1-A..K1-E | `prisma migrate status` on the K1 branch shows the new migration as *pending*; no `_prisma_migrations` row for it until K1-F |
| MG-10 | Apply go-ahead is explicit | K1-F: a dated owner authorization line in the `K1.x` completion doc before `migrate deploy` is run |

---

## 6. Do-not-touch in K1

| Area | Status in K1 |
|---|---|
| `lib/ai/providers/*`, `AIPresenterOrchestratorService`, any provider chain | **untouched** (SO-1 is K3) |
| `app/api/private/knowledge/chat/route.ts`, `services/ai/assistant.service.ts`, `context-manager.service.ts` | **untouched** (K3) |
| `services/knowledge/IngestionService.ts`, `TextChunker.ts` | **called, not modified** |
| `KnowledgeChunk` model + `embedding` column + `20260720000000` migration | **untouched** |
| Legacy `scope = user` `Knowledge` rows | **not rewritten** — mapped per `KNOWLEDGE_CONTRACT.md` §4.3 |
| `services/agent-framework/**`, `research.knowledge_search` tool | **untouched** (regression-tested only) |
| Admin UI / `/dashboard/admin/**`, candidate generation, cache, analytics events | **not built in K1** (K4/K5/K6) |
| `AnalyticsEvent` new `type` values | **not added in K1** (K6) |
| Quant / Marketplace / Paper-Trading / Automation / any unrelated model | **untouched** |

---

## 7. K1 acceptance checklist — machine-checkable

| # | Criterion | Verify |
|---|---|---|
| A-1 | 7 enums + additive `Knowledge` columns + 5 models present, schema compiles | `prisma generate` + `tsc --noEmit` |
| A-2 | Migration generated, reviewed, **not applied**, additive-only | §5 MG-1..MG-9 |
| A-3 | `KnowledgeService.retrieve()` implements the retrieval contract | `validate:knowledge-loop-retrieval` covers pipeline steps 1–8 |
| A-4 | INV-1 holds — unapproved knowledge returns 0 hits | `validate:knowledge-loop-retrieval` cases: rejected candidate, candidate-status candidate → 0 hits; no chunk/vector persisted for a candidate |
| A-5 | Scope isolation | `assistant` query ⊄ `support`-only rows and vice versa; `shared` visible to both |
| A-6 | Status filtering | `draft`/`deprecated`/`archived` never returned |
| A-7 | Supersede de-dup | only the current version of a chain is returned |
| A-8 | Freshness | `DYNAMIC` past `expiresAt` excluded; `PERIODIC` past review-due penalised by `STALE_PENALTY` |
| A-9 | Authority weighting | rank order matches `AUTHORITY_WEIGHTS` on a controlled tie |
| A-10 | User-scope no-leak | a `scope = user` row is never returned to a different `userId` |
| A-11 | Version fingerprint | `KnowledgeVersionCounter.value` increments on `markActive` / `deprecate` / `newVersion` / `archive` / `reinstate`, in the same transaction |
| A-12 | Ingestion integration | `markActive` → real chunks + vectors → row retrievable end-to-end; `IngestionService` source unchanged |
| A-13 | `VectorRepository` backward-compatible | `searchSimilar` with no `scope`/`visibility` args behaves byte-identically to today (regression test) |
| A-14 | Regression | existing `validate:*` suites pass; `knowledge/chat` non-stream contract unchanged; `research.knowledge_search` tool works |
| A-15 | No boundary broken | B-1..B-8 spot-checked; no provider file, no chat route, no `IngestionService` diff |
| A-16 | Apply go-ahead recorded | K1-F: dated owner authorization before `migrate deploy` |

K1 is **COMPLETE** only when A-1..A-16 are all green **and** the migration has
been applied under authorization with post-apply verification recorded.

---

## 8. Test house style (LOCKED — AN1.2 D2)

Standalone `scripts/validate-knowledge-loop-*.ts` harnesses (`node:assert/strict`
via `tsx`), one `validate:knowledge-loop-*` entry per area in `package.json`.
Build deterministic fake inputs (including **fake 768-d embeddings** so tests
never call Gemini) → run the real unmodified service chain → assert → print
`N passed, M failed`. K1 ships at least:
`validate:knowledge-loop-schema`, `validate:knowledge-loop-retrieval`.

---

## 9. What is NOT decided here (deferred to the sprint that owns it)

- Exact `ClaudeProvider` tool-block parsing shape → K3 (with the `claude-api`
  skill).
- Classifier heuristics tuning → K3.
- Candidate dedup thresholds in practice → K4 (defaults `DUP_HARD 0.94` /
  `DUP_SOFT 0.85` from the contract).
- Answer-cache write-condition edge cases → K5.
- Analytics event payload finalisation → K6.
- Chunk size/overlap re-tuning → only if K7 evaluation demands it (K8).

---

## 10. K1 GO / NO-GO

```
K0:                      LOCKED (arch + 5 contracts + K0_DECISION)
OWNER SIGN-OFFS SO-1..4:  LOCKED (§1)
BOUNDARIES B-1..8:        LOCKED (§2)
CRITICAL INVARIANT INV-1: LOCKED (§3)
K1 SCOPE:                 DEFINED (§4, K1-A..F)
MIGRATION GATE:           DEFINED + MACHINE-CHECKABLE (§5)
ACCEPTANCE GATE:          DEFINED + MACHINE-CHECKABLE (§7)
DO-NOT-TOUCH:             DEFINED (§6)

K1 DECISION:             GO — implementation may begin at K1-A.
MIGRATION APPLY:         BLOCKED until K1-F (§5 MG-10 + explicit owner go-ahead).
K2 START:                BLOCKED until K1 COMPLETE (§7 A-1..A-16 green).
```

---

## 11. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K1_DECISION created. Owner approved all 4 K0 pending decisions → SO-1..SO-4 LOCKED. 8 boundaries + INV-1 (structural unreachability) LOCKED. K1 split into K1-A..K1-F with a machine-checkable migration gate (§5) and acceptance gate (§7). Implementation may begin at K1-A; migration apply blocked until K1-F. |
