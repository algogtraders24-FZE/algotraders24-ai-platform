# K0.2 — Knowledge Contract

**Sprint:** K0 — AT24 AI Assistant Knowledge Loop
**Stage:** Contract lock — precedes K1
**Depends on:** [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md)
**Status:** PROPOSED — schema changes are additive; migration generated + reviewed, **NOT applied** until the gate in [`K0_DECISION.md`](K0_DECISION.md)

Defines the canonical **Knowledge** entity, the **Knowledge Candidate**
entity, the lifecycle, provenance, freshness, versioning, and approval
semantics. All new Prisma models follow the repo conventions: denormalized
owner id (never trusted from client input), `deletedAt` soft-delete on mutable
models, **append-only + no update path** on audit/event models, no vendor name
in any type, and the `pgvector`-safe migration discipline (offline
`migrate diff` → hand review → `migrate deploy`, never `migrate dev`).

---

## 1. Design rules (LOCKED)

1. **Reuse `Knowledge` + `KnowledgeChunk`.** The canonical Knowledge entity is
   the *existing* `Knowledge` model with additive columns — not a new table.
   `KnowledgeChunk` (and its `embedding vector(768)` column, accessed only via
   `VectorRepository`) is unchanged.
2. **Candidates are a separate model.** `KnowledgeCandidate` never shares a
   table with `Knowledge`. The retriever reads `Knowledge` only, so an
   unreviewed candidate is *structurally* unable to be served — the same
   defense AN1.9 uses ("pending memory is never surfaced by `read()`").
3. **Scope, not tenancy.** `Knowledge.userId` stays as the **author**. A new
   `scope` column says *whose knowledge base this belongs to*
   (`user` \| `assistant` \| `support` \| `shared`). Per-user knowledge
   (today's only mode) is `scope = user` and keeps working untouched.
4. **Approval is an event, not a field flip.** The `active` state is reached
   only through `Governance.approve()`, which writes an immutable `AuditLog`
   row and sets `approvedBy` / `approvedAt`. There is no code path that sets
   `status = active` without that audit row.
5. **No web result is knowledge until approved.** A web-derived answer can
   only enter as a `KnowledgeCandidate` with `sourceType = web-researched`.

---

## 2. Canonical Knowledge entity

Backed by `model Knowledge` (existing) + additive columns below.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` cuid | existing |
| `userId` | `String` | existing — **author / creator**, not an access-control scope |
| `title` | `String` | existing |
| `canonicalQuestion` | `String?` | **new** — the representative question this knowledge answers (null for pure documentation) |
| `canonicalAnswer` | `String?` | **new** — the verified answer text. For document knowledge this is null and `content` (chunks) carries the body. For verified-Q&A knowledge this is the short authoritative answer. |
| `description` | `String` | existing — summary |
| `knowledgeType` | `KnowledgeType` enum | **new** — see §7 |
| `category` | `String` | existing — free-string sub-topic (kept; not promoted to enum) |
| `scope` | `KnowledgeScope` enum | **new** — `user` \| `assistant` \| `support` \| `shared` (default `user`) |
| `visibility` | `KnowledgeVisibility` enum | **new** — `public` \| `customer` \| `admin` \| `internal` (default `public` for `assistant`/`shared`, `customer` otherwise) |
| `source` | `String` | existing — free text; for loop rows: `"candidate:<id>"` \| `"admin"` \| `"import:<ref>"` \| `"support:<ticketRef>"` |
| `sourceType` | `KnowledgeSourceType` enum | **new** — see §8.2 |
| `provenance` | `Json` | **new** — structured origin record (§3) |
| `confidence` | `Float?` | **new** — 0–1, the reviewer's or pipeline's confidence at approval; advisory only |
| `status` | `KnowledgeStatus` enum | **replaces** the free-string `status` for loop rows (§4). Legacy per-user rows: mapped (§4.3) |
| `version` | `Int` | **new** — starts at 1; a material edit to an `active` row creates a new version (§6) |
| `supersedesId` | `String?` | **new** — points to the prior version's `Knowledge.id` |
| `embeddingStatus` | `String` | existing (`pending`/`processing`/`embedded`/`failed`) — unchanged |
| `chunkCount` | `Int` | existing |
| `freshnessClass` | `KnowledgeFreshnessClass` enum | **new** — `STATIC` \| `PERIODIC` \| `DYNAMIC` (§5) |
| `freshnessReviewEveryDays` | `Int?` | **new** — for `PERIODIC`; null for `STATIC` |
| `expiresAt` | `DateTime?` | **new** — for `DYNAMIC`/time-boxed knowledge; past `expiresAt` → treated stale by retrieval, surfaced to admin for review |
| `lastReviewedAt` | `DateTime?` | **new** — last time an admin confirmed this is still correct |
| `createdAt` | `DateTime` | existing |
| `updatedAt` | `DateTime` | existing |
| `approvedAt` | `DateTime?` | **new** |
| `approvedBy` | `String?` | **new** — admin user id from the verified session |
| `deprecatedAt` | `DateTime?` | **new** |
| `deprecatedBy` | `String?` | **new** |
| `usageCount` | `Int` | **rename-in-spirit of** existing `retrievalCount` — kept as `retrievalCount` (already written by the search route); do not add a duplicate |
| `lastRetrievedAt` | `DateTime?` | **new** — set best-effort by the retriever |
| `deletedAt` | `DateTime?` | existing — soft delete (hard-delete never happens; chunks preserved for audit) |

`embeddingReference`: there is no separate embedding-id field. The chunk rows
in `KnowledgeChunk` (FK `knowledgeId`, cascade) *are* the embedding reference;
the `embedding` column lives on those rows. This matches the existing design
and issue #28867 (Prisma cannot type `vector`).

### 2.1 Additive columns — migration shape

All new columns are **nullable or defaulted**, so no backfill is required
(AN1.2 P1 rule). The migration adds the enums + columns + the new models in
one reviewed file, generated via `prisma migrate diff` offline.

---

## 3. Provenance contract

`Knowledge.provenance` (Json) and `KnowledgeCandidate.evidence` (Json) share
one shape, `KnowledgeProvenance`:

```
KnowledgeProvenance = {
  origin: "candidate" | "admin-authored" | "support-resolution" | "import" | "web-researched",
  createdBy: string,                    // user id (admin) or "system"
  createdAt: string,                    // ISO
  originatingConversationId?: string,   // when origin = candidate
  originatingMessageId?: string,
  knowledgeSources?: Array<{            // AT24 chunks that informed the answer
    knowledgeId: string, chunkId: string, similarity: number
  }>,
  webSources?: Array<{                  // when web search contributed
    url: string, title: string, domain: string,
    retrievedAt: string, excerpt: string, relevance?: number
  }>,
  reviewerNotes?: string,
  editedByReviewer?: boolean            // true if the admin changed the proposed text before approving
}
```

Rules:

- `provenance` is **never** a secret, an API key, or a raw provider payload
  (identical rule to `IntelligenceAuditTrace` and `AgentEvidence.provenance`).
- Web-derived knowledge MUST retain `webSources` with at least `url`,
  `title`, `domain`, `retrievedAt`.
- Once written on an `active` row, `provenance` is immutable — a new version
  (§6) carries its own fresh provenance.

---

## 4. Knowledge lifecycle

### 4.1 Canonical states

```
DRAFT ──▶ CANDIDATE ──▶ UNDER_REVIEW ──┬──▶ REJECTED
                                       └──▶ APPROVED ──▶ ACTIVE ──▶ DEPRECATED ──▶ ARCHIVED
```

### 4.2 Implemented mapping (LOCKED)

The 8 canonical states map to **two enums on two models** — `APPROVED` and
`ACTIVE` are collapsed (the approval *event* is the `AuditLog` row +
`approvedAt`; there is no meaningful window where a row is "approved but not
active").

**`KnowledgeCandidate.status` — `CandidateStatus` enum:**

| Value | Canonical | Meaning |
|---|---|---|
| `candidate` | CANDIDATE | created, awaiting triage |
| `under_review` | UNDER_REVIEW | an admin has opened / deferred it |
| `approved` | APPROVED (transient) | approval committed; `finalKnowledgeId` set; terminal on the candidate |
| `rejected` | REJECTED | terminal; retained forever; never retrievable |
| `duplicate` | (REJECTED variant) | closed as a duplicate of existing knowledge / another candidate; `duplicateOfId` set |
| `superseded` | (REJECTED variant) | a newer candidate for the same question replaced it |

**`Knowledge.status` — `KnowledgeStatus` enum:**

| Value | Canonical | Retrievable? |
|---|---|---|
| `draft` | DRAFT | **No** — admin-authored WIP, not yet published |
| `active` | APPROVED + ACTIVE | **Yes** |
| `deprecated` | DEPRECATED | **No** — kept for audit + as a "was true until" record; may still be shown to admins |
| `archived` | ARCHIVED | **No** — cold storage; excluded from all default queries |

Minimum mandatory states from the brief — coverage: `candidate` → `CandidateStatus.candidate`;
`under_review` → `CandidateStatus.under_review`; `approved`/`active` → collapsed to
`KnowledgeStatus.active` + the approval `AuditLog` row; `rejected` →
`CandidateStatus.rejected`; `deprecated` → `KnowledgeStatus.deprecated`.

### 4.3 Legacy per-user rows

Existing `Knowledge` rows (all `scope = user`) have free-string `status`
values (`processing`, `indexed`, `pending`, `failed`, …). The migration does
**not** rewrite them. The Knowledge Service treats any `scope = user` row
with `embeddingStatus = embedded` (or legacy `indexed`) as retrievable for
that user, exactly as today. The `KnowledgeStatus` enum governs
`scope ∈ {assistant, support, shared}` rows only. A follow-on cleanup sprint
may normalise the legacy rows; K0 does not.

### 4.4 Transition table (LOCKED)

| From | To | Trigger | Side effects |
|---|---|---|---|
| — | `candidate` | `CandidateService.propose()` | dedup check; `KNOWLEDGE_CANDIDATE_CREATED` |
| `candidate` | `under_review` | admin opens / defers | `KNOWLEDGE_CANDIDATE_REVIEWED` |
| `candidate` / `under_review` | `approved` | `Governance.approve()` | create `Knowledge` (`active`, v1); `IngestionService.ingest()`; `AuditLog`; `KNOWLEDGE_APPROVED`; version-fingerprint bump |
| `candidate` / `under_review` | `rejected` | `Governance.reject()` | `AuditLog`; `KNOWLEDGE_REJECTED` |
| `candidate` | `duplicate` | dedup ≥ `DUP_HARD` or admin action | link `duplicateOfId`; optional `retrievalCount` note on the canonical row |
| `active` | `active` (v+1) | `Governance.publishNewVersion()` | new `Knowledge` row, `supersedesId` set, old row → `deprecated`; re-ingest; `AuditLog`; fingerprint bump |
| `active` | `deprecated` | `Governance.deprecate()` | drop from retrieval next query; `AuditLog`; `KNOWLEDGE_DEPRECATED`; fingerprint bump |
| `deprecated` | `archived` | `Governance.archive()` or freshness sweep | excluded from admin default views; `AuditLog` |
| `deprecated` | `active` | `Governance.reinstate()` | rare; `AuditLog`; fingerprint bump |
| any | `deletedAt` set | never in normal operation | only a privacy-erasure request (§ `KNOWLEDGE_GOVERNANCE_CONTRACT.md` §8) |

No unreviewed candidate may be used as authoritative knowledge. There is no
transition that produces a retrievable row without passing
`Governance.approve()`.

---

## 5. Freshness

`Knowledge.freshnessClass` (LOCKED taxonomy):

| Class | Examples | Retrieval treatment | Review cadence |
|---|---|---|---|
| `STATIC` | product documentation, stable platform concepts, trading-theory explainers, MQL5 how-tos | full weight; cacheable | none required; `lastReviewedAt` optional |
| `PERIODIC` | feature behaviour, policies, pricing tiers *as documented*, operational runbooks, support procedures | full weight until `freshnessReviewEveryDays` since `lastReviewedAt`; then demoted + surfaced to admin | `freshnessReviewEveryDays` (default 90) |
| `DYNAMIC` | current pricing values, current product availability, "what's the price of X", news-derived facts | **never cached as an answer**; if past `expiresAt` → treated stale, retrieval demotes it and the orchestrator prefers web search | `expiresAt` required |

Rules:

- A `DYNAMIC` fact should generally **not** be stored as permanent knowledge
  at all unless it has an explicit `expiresAt` and a documented reason.
  The default for a dynamic answer is: answer via web search, do not create a
  candidate.
- The daily freshness sweep (fits the one-cron/day budget) sets `status`
  hints: `PERIODIC` past due → flag for review; `DYNAMIC` past `expiresAt` →
  auto-`deprecated` + `KNOWLEDGE_DEPRECATED` (reason: `expired`).

---

## 6. Versioning

- `version` starts at `1`. `active` rows are **immutable in substance** — a
  material change to the canonical answer creates a **new `Knowledge` row**
  with `version = prev + 1`, `supersedesId = prev.id`, fresh `provenance`,
  and its own ingested chunks. The prior row → `deprecated` (not deleted), so
  "what did we tell users last month" is answerable.
- Non-material edits (typo fix, tag change) update the row in place and bump
  `updatedAt` only — no new version, but an `AuditLog` row is still written.
- `KnowledgeChunk` rows are replaced wholesale on re-ingest (existing
  `IngestionService` idempotency: soft-delete old chunks → create new).
- Retrieval only ever returns the current (`active`, highest `version` in a
  supersede chain) row.

---

## 7. Knowledge types (recommended minimal taxonomy — LOCKED)

`KnowledgeType` enum — **6 values**, deliberately small:

| Value | Covers | Rationale |
|---|---|---|
| `product` | product features, EA/indicator behaviour, marketplace listings, "what does X do" | distinct authority + freshness profile (PERIODIC) |
| `platform` | platform how-to, workspace/chart/automation usage, account & billing *procedures* | the largest assistant category; STATIC/PERIODIC |
| `trading_education` | SMC/ICT/Wyckoff/Elliott concepts, risk-management theory, MQL5/Python how-to | STATIC; never a directive (subject to `AI_COMMUNICATION_POLICY`) |
| `policy` | terms, disclaimers, refund/subscription policy, data-handling statements | PERIODIC; admin-authored only; higher authority weight |
| `support` | troubleshooting, known issues, resolution steps | `scope = support` or `shared`; sourced from support resolutions |
| `faq` | short verified Q&A that doesn't fit the above; the default landing type for a promoted candidate | verified-Q&A origin |

Rejected finer-grained candidates from the brief (`feature knowledge`,
`troubleshooting`, `verified Q&A`, `research`, `documentation`,
`operational knowledge`) — folded in: *feature* → `product`; *troubleshooting*
→ `support`; *verified Q&A* → `faq` (origin is tracked separately in
`sourceType`, so the type stays about *subject*, not *provenance*);
*research* / *documentation* / *operational* → `platform` or `trading_education`
by subject. `category` (free-string) carries any finer sub-topic.

---

## 8. Knowledge Candidate entity

### 8.1 `model KnowledgeCandidate`

| Field | Type | Notes |
|---|---|---|
| `id` | `String` cuid | |
| `createdByUserId` | `String` | the end user whose turn produced it, or the admin who flagged it; denormalized, not FK |
| `originatingConversationId` | `String?` | loose ref (like `IntelligenceAuditTrace.conversationId`) |
| `originatingMessageId` | `String?` | the assistant message being preserved/corrected |
| `canonicalQuestion` | `String` | normalized question the candidate answers |
| `proposedAnswer` | `String` | the answer text (as generated, or as edited by a reviewer before approval) |
| `knowledgeType` | `KnowledgeType` | proposed type (reviewer may change) |
| `proposedScope` | `KnowledgeScope` | default `assistant` |
| `proposedVisibility` | `KnowledgeVisibility` | default `public` |
| `proposedFreshnessClass` | `KnowledgeFreshnessClass` | default `STATIC`; a `DYNAMIC` proposal is a red flag for the reviewer |
| `sourceType` | `KnowledgeSourceType` | §8.2 |
| `evidence` | `Json` | `KnowledgeProvenance` shape (§3) — knowledge chunks + web sources that informed `proposedAnswer` |
| `confidence` | `Float` | 0–1; pipeline confidence at creation |
| `reasonForCandidate` | `String` | enum-like: `unanswered-high-value` \| `web-answer-worth-keeping` \| `assistant-correction` \| `admin-flagged` \| `support-resolution` \| `imported-doc` |
| `duplicateOfId` | `String?` | `Knowledge.id` or `KnowledgeCandidate.id` if dedup fired |
| `similarityScore` | `Float?` | cosine to `duplicateOfId` |
| `status` | `CandidateStatus` | §4.2 |
| `assignedReviewerId` | `String?` | admin id |
| `reviewedAt` | `DateTime?` | |
| `reviewNotes` | `String?` | |
| `finalKnowledgeId` | `String?` | set on approval |
| `createdAt` / `updatedAt` | `DateTime` | |
| `deletedAt` | `DateTime?` | soft delete only for a privacy-erasure request |

Indexes: `[status]`, `[createdAt]`, `[createdByUserId]`,
`[originatingConversationId]`, `[duplicateOfId]`, `[assignedReviewerId]`.

### 8.2 `KnowledgeSourceType` enum

`verified_qa` · `unanswered_question` · `assistant_correction` ·
`web_researched` · `admin_authored` · `support_resolution` ·
`existing_documentation`

Maps 1:1 to the brief's "a candidate may originate from" list.

### 8.3 Candidate provenance rule

A candidate MUST retain enough provenance to answer, without replaying logs:
*where did this question come from, what evidence produced this answer, and
who/what proposed it.* `evidence` (§3) + `originatingConversationId` +
`reasonForCandidate` satisfy this. A candidate with `sourceType = web_researched`
and no `webSources` in `evidence` is invalid and is rejected at creation.

---

## 9. Approval contract

See [`KNOWLEDGE_GOVERNANCE_CONTRACT.md`](KNOWLEDGE_GOVERNANCE_CONTRACT.md) for
roles, permissions, and the full audit shape. Summary of the contract this
document owns:

- **Explicit only.** `Governance.approve(candidateId, adminId, opts)` — no
  threshold auto-approval, no agent caller (enforced the same way AN1.9
  enforces "approver is a real user/admin id, NEVER an agent").
- The admin can, in one review: view the candidate + originating
  conversation; inspect every evidence source; **edit** `proposedAnswer`,
  `knowledgeType`, `scope`, `visibility`, `freshnessClass`; approve; reject;
  defer; and deprecate a related existing `Knowledge` row in the same action.
- Approval **must** create an `AuditLog` row with: `actorUserId` (the admin),
  `action = "knowledge.approve"`, `targetType = "KnowledgeCandidate"`,
  `targetId`, and `metadata = { knowledgeId, version, editedByReviewer,
  before: <candidate snapshot>, after: <knowledge snapshot> }`.
- Approving a **new version** of existing knowledge records `previousVersionId`
  in the audit metadata.

---

## 10. Retrieval-safety invariants (LOCKED — deterministic rules)

The Knowledge Service enforces these in the query layer, not by convention:

| Risk | Rule |
|---|---|
| Deprecated knowledge served as active | `WHERE status = 'active'` on every retrieval query; `deprecated`/`archived`/`draft` never returned to the orchestrator |
| Rejected candidate retrieved as authoritative | Candidates live in a different table the retriever never queries. Structurally impossible. |
| Conflicting versions returned together | Retrieval de-dupes by supersede-chain root and returns only the current version; a `supersededById IS NOT NULL` row is excluded |
| Stale knowledge presented as current | `DYNAMIC` past `expiresAt` → excluded from retrieval (swept to `deprecated`); `PERIODIC` past review-due → similarity penalty `STALE_PENALTY` (0.15) and `stale: true` flag passed to the orchestrator |
| Low-confidence knowledge overriding better knowledge | Final rank = `similarity × authorityWeight − stalePenalty`; on a tie the higher `confidence`, then newer `version`, then higher `authorityWeight` wins |
| User-generated content treated as verified truth | `scope = user` rows are only ever returned to their own `userId` and are tagged `unverified` in the context block; they never carry `authorityWeight > 0.5` |

---

## 11. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0.2 created. Knowledge entity (§2) = existing model + additive columns. `KnowledgeCandidate` new model (§8). Lifecycle mapping (§4.2), 6-type taxonomy (§7), 3-class freshness (§5), retrieval-safety invariants (§10) proposed for lock. |
