# K4.1 — Knowledge Governance: Architecture Audit + Decision Lock

**Program:** AT24 AI Assistant Knowledge Loop / Chat Support Agent
**Sprint:** K4.1 — R&D + Architecture Audit + Decision Lock
**Type:** READ-ONLY. **No implementation, no migration, no admin UI, no code change in this sprint.**
**Base:** fresh `origin/main` @ `63d4eb1` (CS1 merged + live; K3-B live; K3-C decided, not merged)
**Branch:** `feat/k4-knowledge-governance-audit`
**CS1:** CLOSED / FROZEN — not touched, not reopened
**A1–A15:** not touched

---

## 1. Executive summary

AT24 already **designed** knowledge governance in full, three sprints ago. `KNOWLEDGE_CONTRACT.md` (K0.2) and `KNOWLEDGE_GOVERNANCE_CONTRACT.md` (K0.5) — both dated 2026-09-08, both status `PROPOSED` — already specify the lifecycle, the candidate model, the approval contract, the audit trail, the provenance shape, the retrieval-safety invariants, and the analytics event vocabulary that this brief asks K4.1 to define. `config/knowledge-loop.config.ts` already carries the dedup thresholds "(K4)" in a comment. **K4.1's real job turned out to be smaller than the brief assumed: audit what of that design is actually built, confirm it still fits (CS1 shipped since, `scope=support` is live, K3-B/K3-C happened since), lock it as K4's contract, and scope exactly what K4.2 must build.**

**What is already real (code, not just contract):**
- The full `Knowledge` lifecycle schema (11 additive columns, 5 new models, 7 enums) — migrated to prod.
- Retrieval eligibility (scope/visibility/status/supersession/freshness) — the actual safety-critical part — is **fully implemented and prod-verified** (K1/K2), and is what CS1's Support Agent already depends on.
- `KnowledgeService` lifecycle *mechanism* (`create`, `markActive`, `deprecate`, `archive`, `reinstate`, `createVersionOf`) — implemented, unit-tested, used by CS1's bootstrap seed.
- The `KnowledgeCandidate` **table** — exists, migrated, structurally unreachable by retrieval (INV-1, proven both offline and live).
- The analytics event vocabulary and metrics (`KNOWLEDGE_CANDIDATE_CREATED/REVIEWED`, `KNOWLEDGE_APPROVED/REJECTED`, `KNOWLEDGE_CONFLICT`, Approval Rate, Open Candidate Backlog, …) — fully specified, not yet emitted anywhere.

**What is genuinely missing (the real K4.2 scope):**
- **No code anywhere creates a `KnowledgeCandidate` row.** Verified by grep: every reference to `KnowledgeCandidate` in `services/knowledge-loop/**` is a comment asserting *non*-use (INV-1 compliance). `CandidateService.propose()` does not exist.
- **No `Governance` module exists.** `approve` / `reject` / `publishNewVersion` (with the admin gate, the privacy scan, and the `AuditLog` write) are fully specified in K0.5 but there is zero implementing code. The `KnowledgeService` transition methods CS1 calls (`markActive` etc.) are the raw mechanism *without* an admin gate, a privacy scan, or an audit write wrapped around them.
- **No admin surface** for candidates or governance actions (`/dashboard/admin/knowledge-loop/**` does not exist; the existing `/dashboard/admin/knowledge` + `AdminKnowledgeService` is a different, unrelated surface — see §3.3).
- **No dedup implementation** (the `DUP_HARD`/`DUP_SOFT` constants exist in config, unused).
- **The freshness sweep exists but is not scheduled** — `runFreshnessSweep()` is a tested, callable function with no cron entry anywhere.
- **A live, concrete instance of the gap**: CS1's 8 bootstrap `scope=support` rows are `lifecycleStatus=active` in production **today**, having reached that state via a seed script calling `KnowledgeService.create()` → `markActive()` directly — with no candidate, no admin review, no `AuditLog` row. This is the exact failure mode K0.5 §2.1 says must never happen ("No auto-approval… The only path to `active` is this function called by a human admin") — it happened here only because K4 (the enforcement layer) doesn't exist yet, and the owner explicitly authorized the bootstrap as a documented exception (CS1.2 D2, "seed scripts take the same latitude `prisma/seed.ts` already does").

**One open dependency this audit surfaces (not created by it):** `K3C_DECISION.md` (decided, not merged) states *"K4 does not start until K3-C closes"* and flags its C7 finding — the knowledge block injected into the assistant's prompt is not injection-hardened — as **"High (pre-K4)"**, specifically because "K4 will capture candidate-derived content." K4.1 (this document, research-only) does not conflict with that gate. **K4.2 (implementation) should not begin until either K3-C's C7 hardening lands, or the owner explicitly accepts the risk and overrides the gate** — see Open Question OQ-1.

**Recommendation:** lock K4-D1..D14 below as written, park K4.2 implementation behind OQ-1 (K3-C dependency) and the owner's review of this document, per the brief's own stop condition.

---

## 2. Current K1/K2/K3 audit (what already exists, in code)

### 2.1 Schema (K1-A, migrated to prod)

`prisma/schema.prisma`:

| Enum | Values |
|---|---|
| `KnowledgeStatus` | `draft` \| `active` \| `deprecated` \| `archived` |
| `KnowledgeScope` | `user` \| `assistant` \| `support` \| `shared` |
| `KnowledgeVisibility` | `public` \| `customer` \| `admin` \| `internal` |
| `KnowledgeType` | `product` \| `platform` \| `trading_education` \| `policy` \| `support` \| `faq` |
| `KnowledgeFreshnessClass` | `STATIC` \| `PERIODIC` \| `DYNAMIC` |
| `KnowledgeSourceType` | `verified_qa` \| `unanswered_question` \| `assistant_correction` \| `web_researched` \| `admin_authored` \| `support_resolution` \| `existing_documentation` |
| `CandidateStatus` | `candidate` \| `under_review` \| `approved` \| `rejected` \| `duplicate` \| `superseded` |

`Knowledge` (existing table + 21 additive columns, all nullable/defaulted, zero backfill): `canonicalQuestion`, `canonicalAnswer`, `knowledgeType`, `scope`, `visibility`, `sourceType`, `provenance`, `confidence`, `lifecycleStatus` (the *new* lifecycle column — the pre-existing free-string `status` is untouched and still carries legacy `scope=user` ingestion state), `version`, `supersedesId`, `supersededById`, `freshnessClass`, `freshnessReviewEveryDays`, `expiresAt`, `lastReviewedAt`, `approvedAt`, `approvedBy`, `deprecatedAt`, `deprecatedBy`, `lastRetrievedAt`.

New models, all migrated + live: `KnowledgeCandidate`, `KnowledgeAnswerProvenance` (K3), `KnowledgeRetrievalLog` (K2), `KnowledgeAnswerCache` (schema-ready, unused — K5), `KnowledgeVersionCounter` (K2), `KnowledgeRetrievalCache` (K2).

`AuditLog` (pre-existing, generic, append-only, no update/delete path anywhere in the app) is the audit model K4 reuses — confirmed no new audit table is warranted.

### 2.2 Retrieval — the part that is actually production-hardened

`repositories/VectorRepository.ts::searchSimilar({scopes, visibilities, includeUserScope, callerUserId})` + `services/knowledge-loop/knowledge/retrieval.ts` implement, in SQL and in the scoring pipeline:

- `lifecycleStatus='active' AND supersededById IS NULL AND deletedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())` — the retrieval-eligibility gate, enforced **before** ranking, not by convention.
- Scope × visibility filtering (`assistant`/`support`/`shared` vs the caller's role-derived visibility set; `scope=user` rows returned only to their own owner, tagged `unverified`).
- Authority weighting (`AUTHORITY_WEIGHTS` by `sourceType`, `policy` type gets a fixed high weight, `scope=user` gets a fixed low weight) + `STALE_PENALTY` for `PERIODIC` rows past review-due + supersede-chain dedup.
- A Postgres-backed retrieval cache (K2) that **re-hydrates and re-filters live on every hit** — a stale cache entry can never resurrect a row that has since become ineligible (this was adversarially tested).

This is the layer CS1's `support.knowledge_search` tool and the K3-B orchestrator both call. **K4 does not touch this layer.** It is the "retrieval eligibility contract" the brief's §12 asks K4 to define — it is already defined and load-bearing.

### 2.3 `KnowledgeService` — mechanism without governance

`services/knowledge-loop/knowledge/knowledge-service.ts` implements, and CS1 already uses:

- `create(input: CreateKnowledgeInput)` → inserts a `draft` row.
- `markActive(id, actorId, confidence?)` → transitions to `active`, sets `approvedAt/approvedBy = actorId`, bumps `KnowledgeVersionCounter` in the same transaction.
- `deprecate` / `archive` / `reinstate` — same transactional pattern.
- `createVersionOf(fromId, input)` → new `active` row (`version+1`, `supersedesId`), old row → `deprecated`, atomic.
- `retrieve(query, opts)` — the retrieval pipeline (§2.2).

**None of these methods check who is calling them, run a privacy scan, or write an `AuditLog` row.** They are the raw transactional primitive K0.5's `Governance.approve()` etc. are specified to wrap. Today, the *only* caller is `scripts/seed-support-kb.ts` (CS1's bootstrap), calling `markActive` directly with an `adminId`-shaped actor id but no actual admin session check, no privacy scan, and — critically — **no `AuditLog` row is written**. This is safe only because it is a same-repo seed script run by the person with production DB access, not a code path reachable from any request. It is *not* what K0.5 calls "the only path to active."

### 2.4 `KnowledgeCandidate` — schema only

Confirmed by grep across `services/`, `app/`, `repositories/`: **every** occurrence of `KnowledgeCandidate` / `knowledgeCandidate` outside `prisma/schema.prisma` and test/validate scripts is a *comment* asserting non-use (the INV-1 discipline). There is no `CandidateService`, no `propose()`, no dedup check, no privacy scan on a candidate. The one production-shaped seam, `ports.ts`'s `CandidateSeedPort`, is explicitly test-only — it exists so a validate script can prove a seeded candidate is unreachable, not to create real candidates.

K3-B's own acceptance record confirms this was a deliberate deferral, not an oversight: **ADR-K3-M8** (`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` §9) — *"candidate creation is deferred entirely to K4… `candidateCreatedId` is always written as `null`."* `KnowledgeAnswerProvenance.candidateCreatedId` exists as a column specifically waiting for K4 to start populating it.

### 2.5 Staleness — implemented, unscheduled

`services/knowledge-loop/knowledge/freshness-sweep.ts::runFreshnessSweep()` is fully implemented and matches §5 of `KNOWLEDGE_CONTRACT.md` exactly: `DYNAMIC` past `expiresAt` → auto-`deprecated` (actor `system:freshness-sweep`, itself an `AuditLog`-shaped precedent for a system actor); `PERIODIC` past review-due → **flagged only**, never auto-deprecated. It never touches `KnowledgeCandidate` and can only make a row *less* reachable, never more (a hand-audited invariant in the file's own header). **Nothing calls it.** `vercel.json` has exactly 3 crons today (`evaluate-outcomes` 2am, `ingest-news` 6am, `publishing/dispatch` 7am) — no fourth entry for the sweep. Per the [[Vercel deployment topology]] constraint (Hobby plan, 1 cron/day per path), a K4.2 wiring needs its own daily slot.

### 2.6 Analytics vocabulary — specified, not emitted

`KNOWLEDGE_ANALYTICS_CONTRACT.md` already locks the event names (`KNOWLEDGE_CANDIDATE_CREATED`, `KNOWLEDGE_CANDIDATE_REVIEWED`, `KNOWLEDGE_APPROVED`, `KNOWLEDGE_REJECTED`, `KNOWLEDGE_CONFLICT`, plus the existing `KNOWLEDGE_MISS`/retrieval events) and the governance metrics (Approval Rate, Open Candidate Backlog, Duplicate Suppression Rate, Unresolved Questions, Knowledge Growth Rate). The generic `AnalyticsEvent` model exists (pre-dates the Knowledge Loop). None of the candidate/governance event types are emitted anywhere yet, because nothing creates the events they describe. K1_DECISION §9 explicitly defers "analytics event payload finalisation" to K6 — K4.2 should emit the events K0 already named; formalising the K6 dashboard is out of K4 scope.

### 2.7 Privacy / classification building blocks that already exist

`services/knowledge-loop/classifier/classify.ts` already classifies a message's `privacyClass` (`public` / `user-specific` / `sensitive`) via regex over account-specific language and PII/secret patterns — built for the orchestrator's web-search gate, not for candidate scanning, but the same regex families (§7.2 of K0.5) are the right building block to reuse for a candidate-creation privacy scan rather than writing a second one. `lib/ai/compliance.ts`'s `scanForForbiddenLanguage` (trading-directive language) is the second scan K0.5 §7.2 calls for and it already exists, used today by A6 (agent-framework) and the orchestrator.

### 2.8 Existing admin surface — not reusable, but the pattern is

`services/admin/AdminKnowledgeService.ts` + `app/api/private/admin/knowledge/**` is a **different, pre-existing** surface: a read-only list + soft-delete moderation tool over the *legacy* `scope=user` `Knowledge.status` free-string column (Sprint L2.6). It has no concept of `lifecycleStatus`, candidates, or approval. It is not extended by K4 — a new `/dashboard/admin/knowledge-loop/**` surface is additive, per K0.5 §9. What *is* reused is the gate primitive: `lib/auth/adminRoute.ts::requireAdmin(requestId, startedAt)`, built on the real `assertRole("admin")` — this is the exact gate every K4.2 admin route calls first, with no new auth mechanism.

---

## 3. CS1 integration boundary (inspected, not modified)

CS1 (`63d4eb1`, frozen) is a **consumer**, not a governance actor:

- `support.knowledge_search` (`services/agent-framework/tools/impl/support-knowledge-search.tool.ts`) calls `RepositoryFactory.vectors().searchSimilar({scopes:["support"]})` directly — the repository layer, never `KnowledgeService`, never `Governance` (none exists to call). It only **reads**.
- `support.account_read` is unrelated to the knowledge loop (billing/license tables).
- `supportSpecialist` (the CS1 planning/synthesis logic) has no code path that could create a candidate, approve anything, or write to `Knowledge`/`KnowledgeCandidate`. It cannot, structurally — it never imports `services/knowledge-loop/**` (INV-1, `validate:knowledge-loop-schema` enforces this by grep for every file under `services/agent-framework/**`).
- The only place CS1 touches the governance surface at all is the **bootstrap seed** (`scripts/seed-support-kb.ts`, §2.3 above) — a one-time, human-run script, not a runtime path.

**Conclusion for K4:** CS1 needs nothing changed for K4.2 to ship. The only interaction K4.2 introduces is *retroactive*: an admin reviewing the 8 bootstrap rows through the new governance surface (§9, K4-D13) — which reads/edits `Knowledge` rows CS1's tool already retrieves, no different in kind from any other `scope=support` row. K4.2 must not add a "propose a candidate" tool to the Support Agent — that would reopen CS1, which is out of scope for this program and would need its own CS-series sprint (noted as backlog item, not K4).

---

## 4. Research: knowledge-governance principles applied (not copied)

This synthesizes established, vendor-neutral practice — document-control/CMS lifecycle (draft → review → publish → supersede → archive), ITIL-style change management (nothing goes live without an accountable approver and a recorded reason), and the current (2024–2026) consensus on human-in-the-loop RAG governance (an LLM may retrieve and *propose*; a human is the only path to "this is now organizational truth"). No single vendor's architecture is adopted wholesale — AT24 already independently arrived at the same shape in K0, which is itself a signal these are the load-bearing principles, not incidental choices:

1. **Immutable audit trail, separate from the content it audits.** AT24 already has this (`AuditLog`) — reused, not rebuilt.
2. **Draft/candidate content lives outside the retrievable set until promoted**, structurally, not by a status flag alone (a flag can be forgotten to check; a separate table cannot be accidentally joined into a query nobody wrote). AT24's `KnowledgeCandidate` table already is this.
3. **Versioning is append-only; "current" is a pointer, not an edit.** A material change to authoritative content creates a new immutable version and deprecates the old one, so "what did we tell users on date X" stays answerable. AT24's `supersedesId`/`supersededById` chain already is this.
4. **Approval is a human act with an identity attached, never a threshold.** No confidence score, no repetition count, no elapsed time promotes content on its own — this is the single most consistent lesson from RAG-governance postmortems (an unreviewed answer that gets cached, repeated, and eventually "feels true" is the classic failure). AT24's K0.5 §2.1 already states this as a rule; K4 must ensure the code enforces it (§2.3–2.4 show it currently does *not*, because nothing calls the missing `Governance` layer yet).
5. **Staleness is a review signal, not a deletion trigger**, except for content that is explicitly time-boxed (AT24's `DYNAMIC`/`expiresAt`). Automatically deleting "possibly stale" content destroys the historical record and is worse than flagging it for a human.
6. **Duplicate/conflict detection assists a human decision; it does not resolve on its own** past a very high similarity bar (AT24's `DUP_HARD`). Below that bar, present it, don't merge it.
7. **Provenance must answer "why does this exist" without replaying logs** — every promoted item traces to a source, an evidence set, and a reviewer, kept forever (even a *rejected* candidate, so "we already said no to this" is answerable next time it's asked).
8. **Scope/tenant isolation belongs in the query, not just in application-layer discipline** — the same principle CS1 and K1/K2 already apply (`scope` is a `WHERE` clause, not a convention).

Nothing here recommends a new database, a reranker, an LLM-based approval step, or a vendor CMS. AT24's existing design already reflects the field's current best practice; the gap is entirely in the *missing enforcement code* (§2.3–2.4), not in the design.

---

## 5. Capability matrix

| Capability | Exists | Partial | Missing | Evidence |
|---|:---:|:---:|:---:|---|
| Knowledge source (canonical entity) | ✅ | | | `Knowledge` model, K1-A, migrated |
| Knowledge version | ✅ | | | `version`/`supersedesId`/`supersededById` + `createVersionOf` |
| Draft state | ✅ | | | `KnowledgeStatus.draft`, `KnowledgeService.create()` |
| Review (candidate queue / triage) | | | ❌ | no `CandidateService`, no admin route, no UI |
| Approval (human, audited) | | ⚠️ | | mechanism (`markActive`) exists; the *gated, audited* `Governance.approve()` does not |
| Publication (→ retrievable) | ✅ | | | retrieval eligibility gate (§2.2), prod-verified |
| Provenance | | ⚠️ | | `Knowledge.provenance` (Json) + `KnowledgeProvenance` shape specified (K0.2 §3) and the column exists; no code populates it via a governed path yet (CS1's seed writes a provenance object by hand, not through `Governance`) |
| Effective date / freshness | ✅ | | | `freshnessClass`/`expiresAt`/`freshnessReviewEveryDays` + retrieval demotion, K1/K2 |
| Supersession | ✅ | | | `supersedesId`/`supersededById`, retrieval dedupes by chain |
| Audit trail | | ⚠️ | | `AuditLog` model exists and is the right reuse; nothing in the knowledge loop writes to it yet |
| Candidate knowledge (creation) | | | ❌ | table exists (`KnowledgeCandidate`); zero creation code (§2.4) |
| Verified resolution | | ⚠️ | | `sourceType=support_resolution` + `reasonForCandidate` values exist in the enum/contract; no code path produces one |
| Conflict handling | | ⚠️ | | `KNOWLEDGE_CONFLICT` event + dedup thresholds specified; no detection code |
| Rollback | | ⚠️ | | `reinstate()` exists (deprecated→active); no "revert to a specific prior version" beyond that single-step reinstate |
| Scope isolation | ✅ | | | enforced in the retrieval SQL, prod-verified (K1/K2, and by CS1's own use) |
| Retrieval eligibility | ✅ | | | the most mature layer in the whole loop — see §2.2 |
| Staleness sweep | ✅ | ⚠️ | | implemented + tested; not scheduled (no cron) |
| Analytics events | | | ❌ | vocabulary specified (`KNOWLEDGE_ANALYTICS_CONTRACT.md`); nothing emits them |
| Admin UI (governance) | | | ❌ | none; existing `/dashboard/admin/knowledge` is the unrelated legacy surface (§2.8) |
| Privacy/PII scan for candidates | | ⚠️ | | the regex building blocks exist (`classify.ts` privacyClass, `compliance.ts` forbidden-language) but are not wired to a candidate-creation path |

---

## 6. Governance lifecycle (LOCKED)

The brief's evaluation question ("is DRAFT→IN_REVIEW→APPROVED→PUBLISHED→SUPERSEDED→ARCHIVED the right minimum state machine?") is already answered in K0.2 §4 — and it is *not* six states on one model; it is a smaller machine split across two models on purpose, and that split is correct and should stay:

```
KnowledgeCandidate.status:  candidate ──▶ under_review ──┬──▶ rejected (+ duplicate/superseded variants)
                                                          └──▶ approved (terminal on the candidate; finalKnowledgeId set)
                                                               │
                                                               ▼
Knowledge.lifecycleStatus:                                   active ──▶ deprecated ──▶ archived
                                                               ▲            │
                                                               └────────────┘ (reinstate, rare)
```

Why collapsed, not six states on one row: there is no meaningful window where a `Knowledge` row is "approved but not yet active" — the approval *event* (the `AuditLog` row + `approvedAt`) and the *activation* (retrievability) happen in the same transaction (K0.5 §2.1 steps 4–9). Modeling them as two states on one row would create a state that must always co-occur with another, which is a sign they are one state, not two.

| State | Model | Who creates it | Who transitions it | Retrieval-eligible? | Authoritative? | Editable? | Audited? |
|---|---|---|---|:---:|:---:|:---:|:---:|
| `candidate` | `KnowledgeCandidate` | any allowed source (§7) via `CandidateService.propose()` (K4.2, new) | admin (open→under_review) or the dedup check (→duplicate) | No — structurally (INV-1) | No | Yes (proposal fields) | Creation event only |
| `under_review` | `KnowledgeCandidate` | admin opens/defers | admin (→approved/rejected) | No | No | Yes | review-opened event |
| `rejected` / `duplicate` / `superseded` | `KnowledgeCandidate` | `Governance.reject()` (K4.2, new) | terminal | No, never | No, never | No (retained verbatim for audit) | Yes |
| `draft` | `Knowledge` | admin-authored only (`KnowledgeService.create()`, direct authoring, no candidate) | admin (→active via `markActive`) | No | No | Yes | edit events, not approval |
| `active` | `Knowledge` | `Governance.approve()` / `publishNewVersion()` (K4.2, wraps existing `markActive`/`createVersionOf`) | admin (→deprecated), sweep (DYNAMIC expiry only) | **Yes** | **Yes** | No in substance (a material change makes a new version, §K4-D5) | Yes (approval or new-version event) |
| `deprecated` | `Knowledge` | `Governance.deprecate()`, sweep, or `publishNewVersion`'s superseded-row side effect | admin (→archived or →active via reinstate) | No | No (historical record only) | No | Yes |
| `archived` | `Knowledge` | `Governance.archive()` | admin (→active via reinstate, rare) | No | No | No | Yes |

**K4-D2: LOCKED.** No new states needed. No admin UI change to the collapse.

---

## 7. Authority model (LOCKED)

**Principle (verbatim, locked):** *A generated, retrieved, cached, or repeatedly-used answer never becomes authoritative merely by having occurred. Authority is granted exactly once, by a human admin, at `Governance.approve()`/`publishNewVersion()`, and nowhere else.*

| Authority level | Meaning | Retrieval `authorityWeight` | Can it be cited as "the platform's answer"? |
|---|---|---|---|
| `active` (any `sourceType` except `assistant_correction`/pre-review) | admin-approved, `scope ∈ {assistant, support, shared}` | per `AUTHORITY_WEIGHTS` (policy highest) | **Yes** |
| `active`, `scope = user` | the user's own note | fixed low (`USER_SCOPE_AUTHORITY`), tagged `unverified` | Only to that same user, never presented as platform truth |
| `candidate` / `under_review` | proposed, unreviewed | n/a — not retrievable | **Never** |
| `rejected` / `duplicate` / `superseded` | closed | n/a — not retrievable | **Never** |
| `deprecated` / `archived` | was authoritative, no longer | excluded from retrieval | **Never** as current; may be shown to an admin as history |
| CS1's 8 bootstrap rows (today) | `active` via seed, no `Governance` gate | full weight (they satisfy the SQL eligibility filter) | **Currently yes, by omission** — flagged as the concrete gap instance (§9, K4-D13) |

**K4-D1: LOCKED.** No new "authority level" enum is needed — `KnowledgeStatus` (whether it's `active`) already *is* the authority boundary once `Governance` actually gates the only path to `active`. The gap is enforcement, not model.

---

## 8. Candidate pipeline (LOCKED)

```
Source ──▶ CandidateService.propose() [K4.2, new]
              │  (privacy scan §11.2 → block on hit; dedup §10 → attach as duplicate ≥ DUP_HARD)
              ▼
       KnowledgeCandidate (status=candidate)
              │  admin opens
              ▼
       under_review ──▶ Governance.reject() ──▶ rejected/duplicate/superseded  [K4.2, new]
              │
              └────────▶ Governance.approve() ──▶ Knowledge (active, v1) + AuditLog + ingest  [K4.2, new]
```

**Allowed to create a candidate** (`reasonForCandidate` / `sourceType`, per K0.2 §8.1–8.2, unchanged): `unanswered-high-value` (assistant), `web-answer-worth-keeping` (K3-B orchestrator, currently forced `candidateCreatedId=null` by ADR-K3-M8 — K4.2 lifts that), `assistant-correction` (a user flags a bad answer), `admin-flagged`, `support-resolution` (§K4-D4), `imported-doc`.

**Never allowed to directly publish** (i.e. never call `Governance.approve` themselves): the AI Assistant, the Support Agent, the K3-B orchestrator, the freshness sweep, any agent-framework tool, any automated pipeline. This is enforced the same way AN1.9/CS1 enforce it — the module is server-only and not imported by any of those callers (`validate:knowledge-loop-schema`'s INV-1 grep pattern extends unchanged to also assert nothing under `services/agent-framework/**` or the orchestrator imports the new `Governance` module).

**K4-D3: LOCKED.**

---

## 9. Verified-resolution model (LOCKED)

Answering the brief's §8 questions directly:

- **What qualifies:** a human support interaction (today: outside the platform — there is no ticket system yet, CS1.1 §6 deferred it; CS2 backlog) that reached a confirmed correct answer to a real user's question.
- **Who verifies:** the human who resolved it (a support agent/admin), or — once CS2 ships tickets — the ticket's assigned resolver. Never the Chat Support Agent itself (it is read-only, §3).
- **Evidence required:** the resolution text + a reference to the originating interaction (today: free text describing the case, since no ticket id exists yet; `originatingConversationId` on the candidate is nullable specifically for this reason). `sourceType = support_resolution`, `reasonForCandidate = support-resolution`.
- **One resolution → multiple candidates:** allowed, not required — a single resolution touching two distinct questions may propose two candidates; each carries its own evidence, not a shared blob.
- **Original ticket linkage:** `originatingConversationId`/`originatingMessageId` today are loose string refs (no ticket system to point at yet); once CS2 ships a ticket model, that becomes the natural value for these fields — additive, no schema change needed now.
- **Provenance preservation:** the candidate's `evidence` (Json, `KnowledgeProvenance` shape) carries `origin: "support-resolution"`, `createdBy`, and the reference above; on approval this flows into `Knowledge.provenance` unedited except for reviewer notes (K0.2 §3, "immutable once written").
- **Can an AI-generated answer qualify without human verification?** **No.** A verified resolution is definitionally human-verified; an AI Assistant or Support Agent answer that was never corrected by a human may become a candidate (`reasonForCandidate = unanswered-high-value` or similar) but is *not* a "verified resolution" and carries no special authority — it goes through the same review as any other candidate.
- **Conflict with existing knowledge:** the dedup check (§10) fires at proposal time; if it's a near-duplicate of an *active* row, the candidate is created with `duplicateOfId` set and the admin decides (supersede via `publishNewVersion` with `deprecateRelatedIds`, or reject the candidate) — never automatic.

**K4-D4: LOCKED.**

---

## 10. Versioning model (LOCKED — already built, confirmed correct)

`version` (int, starts at 1) / `supersedesId` / `supersededById` — immutable versions, `active` rows are substance-immutable (a material edit makes a new version via `createVersionOf`/`publishNewVersion`), retrieval only ever returns the current version of a supersede chain (`supersededById IS NULL`). Non-material edits (typo, tag) update in place, bump `updatedAt`, still get an `AuditLog` row (`knowledge.edit_metadata`) but no new version — this distinction ("material" vs not) is a **reviewer judgment call**, not automatable, and K4.2 should not try to auto-detect it.

**Retrieval never accidentally returns an unpublished or superseded version merely because its embedding is similar** — already true today (§2.2); this was the brief's explicit worry and it does not need new work.

Rollback beyond a single reinstate step: `reinstate()` only flips `deprecated → active` for the *immediately preceding* row. A rollback to an older version two steps back is: `publishNewVersion` from the old version's content (an admin re-approves it as a fresh version, `version = current + 1`), which is honest (it doesn't pretend time didn't pass) rather than a destructive "restore." **K4-D5: LOCKED** — no new rollback primitive; document the two-step-back procedure for K4.2's UI.

---

## 11. Provenance & retrieval-safety contracts (LOCKED — already built)

**Provenance** (`KnowledgeProvenance`, K0.2 §3) is reused as-is; it is a **deliberate sibling**, not a duplicate, of the agent-framework's `AgentEvidence.provenance` — the two exist for different systems (durable knowledge vs. one agent run's trace) and unifying them was never proposed and should not be: `AgentEvidence` is append-only per-run audit for the *agent framework*; `KnowledgeProvenance` is the durable record of *why this knowledge item exists*. CS1's evidence rows (`support-kb:*` source, `provenance.producer`) and `Knowledge.provenance` are correctly two different things pointing at overlapping facts.

**Retrieval eligibility** ("only knowledge satisfying ALL publication criteria is retrieval-eligible") is **already the enforced contract**, in SQL, not application convention (§2.2): `lifecycleStatus='active' AND supersededById IS NULL AND deletedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`, plus the `scope`/`visibility` filter. This is the one part of the brief's ask that is fully done. **K4-D6: LOCKED, no new work.**

---

## 12. Scope isolation (LOCKED — already built)

`scope` is enforced as a **retrieval-level SQL constraint** (§2.2), not metadata-only and not merely an authorization convention — this is the combination the brief's §11 asks to determine, and the existing implementation already picked "retrieval-level constraint," correctly. `support` scope is isolated from `assistant`/`shared` (the main Assistant's K3-B orchestrator retrieves `["assistant","shared"]`, never `support`; CS1 retrieves `["support"]` only) — proven by CS1's own build + the K3-B acceptance record. **K4-D8: LOCKED, no new work.**

---

## 13. Conflict management (mostly OPEN — no detection code exists)

The `KNOWLEDGE_CONFLICT` event and the dedup thresholds (`DUP_HARD=0.94` create-as-duplicate, `DUP_SOFT=0.85` create-with-`duplicateOfId`) are specified and configured but unimplemented. Per the brief's own instruction ("do not build automatic conflict resolution unless justified... human review should remain the authority"):

- **K4.2 builds:** the dedup check at candidate-creation time (cosine similarity of the candidate's embedding against `active` knowledge in the same scope, using the existing embedding provider — no new infra) — this is a *creation-time* guard, not a standing conflict scanner.
- **K4.2 does NOT build:** a background/scheduled scanner that hunts for conflicting *existing* active knowledge, an automatic "newer wins" rule, or any LLM-based conflict adjudication. A human noticing two contradictory active rows resolves it via `publishNewVersion` (supersede one) — same mechanism as any other edit.

**K4-D9: LOCKED at "creation-time dedup only, no standing conflict scanner."** Whether AT24 later wants a periodic conflict scan (comparing all `active` rows pairwise per scope) is genuinely **OPEN (OQ-2)** — it's a real feature, not a K4.2 blocker, and should be scoped separately if wanted.

---

## 14. Staleness (LOCKED — already built, needs scheduling)

Already correct and implemented (§2.5): `DYNAMIC` past `expiresAt` → auto-deprecated (never silently — it's an `AuditLog`-equivalent-shaped sweep transition with `actorId = system:freshness-sweep`, and it can only ever move a row to *less* reachable, never more). `PERIODIC` past due → flagged, never auto-deprecated; **stale ≠ automatically false**, exactly the distinction the brief calls out — a `PERIODIC` row past due stays retrievable with a similarity penalty (`STALE_PENALTY`) until a human confirms or supersedes it.

**K4-D10: LOCKED on behavior.** The only real work item is **scheduling** — add one Vercel cron entry calling the existing `createFreshnessSweep()` factory. Given the Hobby-plan 1-cron/day-per-path constraint and 3 slots already used (2am/6am/7am UTC), this needs a 4th slot — **OPEN (OQ-3):** confirm Hobby plan still allows a 4th distinct path (it should — the constraint is sub-daily per path, not a total cron count — but confirm before K4.2, per the [[Vercel deployment topology]] outage precedent).

---

## 15. Auditability (LOCKED — reuse `AuditLog`, zero new model)

K0.5 §5's mapping (action vocabulary `knowledge.approve` / `.reject` / `.new_version` / `.deprecate` / `.archive` / `.reinstate` / `.candidate_defer` / `.edit_metadata` / `.answer_cache_flush` / `.freshness_review`, each one `AuditLog` row with `actorUserId`, `targetType`+`targetId`, `metadata.before`/`metadata.after`) is confirmed correct and requires no new model — `AuditLog` is already append-only with no update/delete path anywhere in the app, exactly the property an audit trail needs. **K4-D11: LOCKED.** The freshness sweep's `system:freshness-sweep` actor id is the pattern for any future automated actor.

---

## 16. Admin authority (LOCKED)

Beta = `admin` only (via the real `assertRole("admin")`/`requireAdmin` gate, already used by every other admin route — no new auth mechanism). No separate "reviewer" role in beta; `resolveGovernanceDecision(role, action)` is the one seam K0.5 already names for a finer role model later, not built now. **Actions that must never be available to the end-user or any AI agent:** approve, reject, publish (new version), deprecate, archive, reinstate, edit an `active` row's canonical fields, flush the answer cache. **K4-D-adjacent, folded into K4-D12 below.**

---

## 17. AI authority boundary (LOCKED)

**AI may:** retrieve knowledge (unchanged, already true); propose candidates (K4.2, new — via `CandidateService.propose()`, never `Governance.*` directly); surface possible duplicates to a reviewer (the dedup score, computed at proposal time, shown to the admin); summarize evidence already gathered (no new summarization capability — reuses what the orchestrator/agent already produced); flag potentially stale content for a human (a candidate with `reasonForCandidate` describing "this looks outdated" is just another candidate, not a new mechanism).

**AI may NOT, ever, autonomously:** approve, publish, supersede a policy, delete/archive knowledge, or silently modify a published row. No exception is recommended by this research; if a future sprint proposes one, it must be a new, explicit ADR, not a K4.2 code path. **K4-D12: LOCKED, no exceptions.**

---

## 18. Bootstrap corpus (LOCKED recommendation)

The 8 CS1 `scope=support` rows are `active` in production without ever having passed through `Governance.approve()` — because `Governance` doesn't exist yet, not because anyone bypassed it. Evaluating the brief's three options:

- **Option A — promote after human review.** Recommended.
- **Option B — replace with product-authored versions.** Good longer-term direction, not mutually exclusive with A.
- **Option C — archive + recreate.** Unnecessarily destroys a working, already-embedded corpus for no governance benefit — rejected.

**Recommendation (locked): Option A, then B over time.** Once K4.2's admin surface exists, an admin reviews each of the 8 rows for real (confirm, edit, or supersede via `publishNewVersion`) — this is not theater: it's a genuine first human read of content that has never had one, and it produces the `AuditLog` row that should have existed from day one, honestly timestamped at the actual review date (never backdated to pretend it was reviewed at seed time). Each row's `provenance.origin` stays `"admin-authored"` with a note that it originated as the CS1 bootstrap, so the history stays truthful. As real, richer, product-authored content becomes available for a topic (Option B), it supersedes the bootstrap row via the normal `publishNewVersion` path — no special-case migration.

**K4-D13: LOCKED.**

---

## 19. Proposed logical data model (no migration — everything needed already exists)

**Zero new tables, zero new columns.** Every entity the brief's §19 example list names already exists:

| Brief's example name | Actual AT24 entity | Status |
|---|---|---|
| `Knowledge` | `Knowledge` | exists |
| `KnowledgeVersion` | `Knowledge.version`/`supersedesId`/`supersededById` (same table, not a separate one) | exists |
| `KnowledgeChunk` | `KnowledgeChunk` | exists, untouched |
| `KnowledgeCandidate` | `KnowledgeCandidate` | exists (schema only) |
| `KnowledgeReview` | folded into `KnowledgeCandidate.status/assignedReviewerId/reviewedAt/reviewNotes` + `AuditLog` | no separate table needed |
| `KnowledgePublication` | the `approvedAt`/`approvedBy` pair on `Knowledge` + the `AuditLog` row | no separate table needed |
| `KnowledgeAuditEvent` | `AuditLog` (generic, reused) | exists |
| `VerifiedResolution` | `KnowledgeCandidate` with `sourceType=support_resolution` | no separate table needed |

K4.2 is **pure service + route + UI code against the existing schema.** This is the strongest evidence that K0's original design was sized correctly — nothing about CS1 shipping, `scope=support` going live, or K3-B/K3-C landing since has revealed a missing column or a wrong relationship.

---

## 20. Proposed service/API boundaries (K4.2 scope, not built now)

**Governance is a shared K4 capability** (`services/knowledge-loop/governance/`), not folded into Support or Assistant code — consistent with K0's own framing and with keeping CS1 frozen.

| Capability | Module (proposed) | Reuses |
|---|---|---|
| Candidate creation | `services/knowledge-loop/governance/candidate-service.ts` | dedup via existing embedding provider + `VectorRepository`; privacy scan via `classify.ts` regex + `compliance.ts` |
| Review / approve / reject / defer | `services/knowledge-loop/governance/governance-service.ts` | `KnowledgeService`'s existing `markActive`/`createVersionOf`/`deprecate`/etc. as the transactional primitive it wraps; `AuditLog` write; `requireAdmin` |
| Supersession / archive / restore | same `governance-service.ts` | same |
| Audit read (for the UI) | thin query against `AuditLog` filtered by `targetType` | no new model |
| Admin routes | `app/api/private/admin/knowledge-loop/**` | `requireAdmin` pattern (identical to every other admin route) |
| Admin UI | `/dashboard/admin/knowledge-loop/{candidates,knowledge,metrics}` (3 pages, per K0.5 §9) | existing admin shell/layout pattern |
| Freshness scheduling | one new `vercel.json` cron entry calling the existing `createFreshnessSweep()` | no new sweep logic |
| Analytics emission | `AnalyticsEvent` writes at each governance transition | existing generic model |

Governance code, like `KnowledgeService`, must remain **server-only and never imported by `services/agent-framework/**`, any tool handler, the orchestrator, or the client bundle** — the same INV-1 discipline, extended.

---

## 21. Required architectural decisions

Answered inline above; consolidated in the decision table (§22).

---

## 22. Decision table

| ID | Decision | Status | Rationale |
|---|---|---|---|
| K4-D1 | Authority model | **LOCKED** | `KnowledgeStatus.active`, reached only via a gated `Governance.approve/publishNewVersion`, IS the authority boundary; no new enum (§7) |
| K4-D2 | Lifecycle | **LOCKED** | Two-model collapsed state machine already correct (§6); no new states |
| K4-D3 | Candidate workflow | **LOCKED** | `CandidateService.propose()` (new, K4.2) → admin review → `Governance.approve/reject` (new, K4.2); allowed/forbidden sources enumerated (§8) |
| K4-D4 | Verified resolution | **LOCKED** | `sourceType=support_resolution`; human-only; no ticket system yet so `originatingConversationId` stays free-text until CS2 (§9) |
| K4-D5 | Versioning | **LOCKED** | Already built and correct (§10); rollback = re-approve an old version as a new one, never a destructive restore |
| K4-D6 | Publication / retrieval eligibility | **LOCKED** | Already built, prod-verified, no new work (§11) |
| K4-D7 | Provenance | **LOCKED** | Reuse `KnowledgeProvenance` as-is; deliberately not unified with `AgentEvidence` (§11) |
| K4-D8 | Scope isolation | **LOCKED** | Already a SQL-level constraint, no new work (§12) |
| K4-D9 | Conflict handling | **LOCKED** (narrow) | Creation-time dedup only (`DUP_HARD`/`DUP_SOFT`, K4.2); no standing conflict scanner (§13); a periodic scanner is OQ-2, separately scoped if wanted |
| K4-D10 | Staleness | **LOCKED** | Sweep logic already correct; K4.2 adds only a cron entry (§14); cron-slot availability is OQ-3 |
| K4-D11 | Auditability | **LOCKED** | Reuse `AuditLog`, zero new model, K0.5's action vocabulary stands (§15) |
| K4-D12 | AI authority boundary | **LOCKED** | Retrieve + propose only; never approve/publish/supersede/delete; no exceptions (§17) |
| K4-D13 | Bootstrap corpus | **LOCKED** | Option A (retroactive human review through the new surface) then B (progressive replacement); no backdated audit rows (§18) |
| K4-D14 | K4.2 implementation boundary | **LOCKED** | See §20 for what's built; explicit non-goals below |

---

## 23. Open questions

- **OQ-1 (blocking for K4.2, not for this document):** `K3C_DECISION.md` states *"K4 does not start until K3-C closes"* and flags the knowledge-block injection-hardening (C7) as a pre-K4 requirement specifically because K4 introduces candidate-derived content into the corpus. K3-C is decided but **not merged**, and its implementation branch (`feat/k3c-orchestration-hardening`) has not started. **K4.2 implementation should not begin until either (a) K3-C's C7 hardening lands, or (b) the owner explicitly reviews and overrides this dependency.** This document (K4.1, research-only) does not violate the gate; starting K4.2 code today would.
- **OQ-2:** a periodic (not just creation-time) conflict scanner across existing `active` knowledge — real feature, not scoped here, needs its own decision if wanted.
- **OQ-3:** confirm a 4th Vercel Hobby cron slot is available/acceptable for the freshness sweep before K4.2 wires it (3 of presumably-unlimited daily slots are in use; the known constraint is *sub-daily per path*, not a slot ceiling, but confirm before touching `vercel.json` given the prior cron outage).
- **OQ-4 (non-blocking):** whether `originatingConversationId`/`originatingMessageId` should eventually point at a real support-ticket id once CS2 ships tickets — no action now, the fields are already nullable strings and need no schema change either way.

---

## 24. K4.2 implementation plan (scope only — not started)

1. `services/knowledge-loop/governance/candidate-service.ts` — `propose()` with the privacy scan (reusing `classify.ts` + `compliance.ts` patterns) and creation-time dedup (`DUP_HARD`/`DUP_SOFT` against `VectorRepository`).
2. `services/knowledge-loop/governance/governance-service.ts` — `approve`, `reject`, `publishNewVersion`, `deprecate`, `archive`, `reinstate` as thin, audited wrappers around the existing `KnowledgeService` transitions + `AuditLog` writes. Server-only barrel, INV-1-style import guard extended to it.
3. `app/api/private/admin/knowledge-loop/**` routes, `requireAdmin`-gated, delegating to (2) — no duplicated logic in the route layer (same discipline as A15's agent-framework API seam).
4. `/dashboard/admin/knowledge-loop/{candidates,knowledge,metrics}` — the 3 minimal surfaces from K0.5 §9, extending the existing admin shell.
5. One `vercel.json` cron entry wiring the existing `createFreshnessSweep()`.
6. `AnalyticsEvent` emission at each governance transition, using the event names `KNOWLEDGE_ANALYTICS_CONTRACT.md` already locked.
7. A retroactive review pass (via the new UI, by a human) over the 8 CS1 bootstrap rows (§18).
8. Regression: `validate:knowledge-loop-schema` INV-1 assertions extended to the new governance module; full agent-framework + knowledge-loop suites stay green; CS1/A1–A15 untouched (structural test: no diff outside `services/knowledge-loop/governance/**`, `app/api/private/admin/knowledge-loop/**`, `app/dashboard/admin/knowledge-loop/**`, `vercel.json`, `package.json` scripts).

**Explicit non-goals (K4.2 and beyond, restated from the brief + this audit):** no LLM-based auto-approval; no reranker; no second vector DB or embedding model; no new admin RBAC tier beyond `admin`; no rewrite of retrieval, `KnowledgeService`, `KnowledgeChunk`, or CS1; no automatic conflict resolution; no destructive rollback; no support-ticket system (CS2); no "propose a candidate" tool added to the Chat Support Agent (would reopen CS1); no periodic conflict scanner (OQ-2) unless separately scoped; no migration in K4.1 (this sprint) and no schema change at all expected in K4.2 either (§19).

---

## 25. Change log

| Date | Entry |
|---|---|
| 2026-09-13 | K4.1 created. Audited K1/K2/K3/CS1 against the K0.2/K0.5 contracts; found the design already complete and the gap entirely in missing enforcement code (no `Governance` module, no candidate creation, no admin UI, sweep unscheduled). Locked K4-D1..D14. Surfaced the CS1 bootstrap corpus as a live instance of the exact gap K0.5 warns about (Option A recommended). Flagged OQ-1: K3-C's pre-K4 injection-hardening gate is not yet closed — K4.2 coding should wait on it or an explicit owner override. No code, no migration, no CS1/A1-A15 change in this sprint. |
| 2026-09-15 | OQ-1 resolved — K3-C closed + merged (`ff1fb9d`). Owner explicitly authorized K4.2 implementation to begin, superseding the earlier beta-priority "K4 not yet" exclusion. **K4.2-A (candidate capture, first implementation slice) started and PASSED** on `feat/k4.2a-candidate-capture` — see [`K4.2A_CANDIDATE_CAPTURE.md`](K4.2A_CANDIDATE_CAPTURE.md) for the full decision lock + acceptance record. K4.1's decisions above are the baseline, unmodified by K4.2-A. |
