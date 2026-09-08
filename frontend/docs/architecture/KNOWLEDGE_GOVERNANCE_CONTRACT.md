# K0.5 — Knowledge Governance Contract

**Sprint:** K0 — AT24 AI Assistant Knowledge Loop
**Stage:** Contract lock — precedes K4/K6
**Depends on:** [`KNOWLEDGE_CONTRACT.md`](KNOWLEDGE_CONTRACT.md), [`AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md`](AI_ASSISTANT_KNOWLEDGE_LOOP_ARCHITECTURE.md)
**Status:** PROPOSED — see [`K0_DECISION.md`](K0_DECISION.md)

Defines roles, approval, rejection, deprecation, versioning, audit, and the
security/authorization model for the knowledge lifecycle. Reuses the
platform's existing `AuditLog` (append-only, no delete, no update path) and
`requireAdmin` / `assertRole("admin")` gate. The candidate-approval mechanism
is the **same one AN1.9 proved** for agent memory: an unreviewed item is
invisible to retrieval, and promotion requires a real admin id — never an
agent, never a threshold, never the system itself.

---

## 1. Roles (LOCKED)

| Role | Source | Knowledge-loop capability |
|---|---|---|
| `admin` | `User.role` checked by `assertRole("admin")` | full: review, edit, approve, reject, defer, deprecate, archive, reinstate, publish new version, flush answer cache, run manual freshness review |
| `customer` / `user` | authenticated non-admin session | read `visibility ∈ {public, customer}` knowledge via the assistant; create `scope = user` knowledge (today's flow, unchanged); **no** governance actions; may *flag* an answer/knowledge item ("this looks wrong") → creates a `KnowledgeCandidate` with `reasonForCandidate = assistant-correction` |
| `guest` | unauthenticated | read `visibility = public` knowledge via public surfaces only; no writes |
| Automated pipeline / agents | server code | may **propose** candidates; may **never** approve, reject, deprecate, or write `Knowledge` directly |

> **Role vocabulary note (do not fix in K0):** `lib/roles.ts` defines
> `guest\|customer\|admin\|affiliate` while `User.role` defaults to `"user"`.
> Governance keys **only** off `assertRole("admin")`, which is the real,
> already-correct gate. The drift is documented in the architecture audit
> (§9.2) and left for a separate cleanup.

There is no separate "reviewer" or "knowledge-editor" sub-role in beta. If the
owner wants a `knowledge_reviewer` role that can approve but not do other admin
actions, that is a one-line additive enum + a second gate helper — a
post-beta decision, not a K0 blocker.

---

## 2. Approval contract (LOCKED)

### 2.1 `Governance.approve(candidateId, adminId, opts)`

`adminId` comes from the verified admin session (`requireAdmin().user.id`),
**never** from a request body. `opts` may carry reviewer edits:
`{ editedAnswer?, knowledgeType?, scope?, visibility?, freshnessClass?,
freshnessReviewEveryDays?, expiresAt?, deprecateRelatedIds?: string[] }`.

Atomic sequence (single DB transaction where possible; ingestion runs after
commit because it calls an external embedding API):

```
1. load candidate; assert status ∈ {candidate, under_review}; else 409
2. resolve final fields = candidate proposals ⊕ opts overrides
3. privacy re-scan on the final answer text (§7.2) — a hard fail here aborts approval
4. create Knowledge {
       userId: adminId (author = approving admin),
       title, canonicalQuestion, canonicalAnswer, description,
       knowledgeType, category, scope, visibility,
       source: "candidate:" + candidateId, sourceType,
       provenance: candidate.evidence ⊕ { reviewerNotes, editedByReviewer },
       confidence, status: "active", version: 1,
       freshnessClass, freshnessReviewEveryDays?, expiresAt?,
       lastReviewedAt: now, approvedAt: now, approvedBy: adminId
   }
5. candidate.status = "approved"; candidate.finalKnowledgeId = knowledge.id;
   candidate.reviewedAt = now; candidate.assignedReviewerId = adminId
6. AuditLog {
       actorUserId: adminId, action: "knowledge.approve",
       targetType: "KnowledgeCandidate", targetId: candidateId,
       metadata: { knowledgeId, version: 1, editedByReviewer,
                   before: <candidate snapshot>, after: <knowledge snapshot>,
                   deprecatedRelated: deprecateRelatedIds ?? [] }
   }
7. KnowledgeVersionCounter: value += 1   (same txn as steps 4–6)
8. for each id in opts.deprecateRelatedIds: Governance.deprecate(id, adminId, "superseded-by:" + knowledge.id)
9. COMMIT
10. IngestionService.ingest({ knowledgeId, userId: adminId, text: canonicalBody })
       → KnowledgeChunk rows + embeddings (existing pipeline)
       → on partial embedding failure: Knowledge.embeddingStatus = "failed",
         KNOWLEDGE_APPROVED still emitted, admin sees a "re-index needed" flag
11. emit KNOWLEDGE_APPROVED { knowledgeId, candidateId, adminId, editedByReviewer }
12. emit KNOWLEDGE_CANDIDATE_REVIEWED { candidateId, decision: "approved", adminId, reviewLatencyMs }
```

**No auto-approval.** There is no confidence threshold, no "trusted user", and
no elapsed-time rule that promotes a candidate. The only path to `active` is
this function called by a human admin.

**No agent caller.** `approve` (and `reject`, `deprecate`, `archive`,
`publishNewVersion`, `reinstate`, `flushAnswerCache`) live in a server module
that is never imported by `services/agent-framework/*` or any tool handler —
enforced the same way AN1.9 keeps `approvePending` out of agent reach.

### 2.2 What an admin can do in one review

- View the candidate and the **full originating conversation** (read-only).
- Inspect **every** evidence source: each knowledge chunk opens its parent
  `Knowledge` row; each web source opens its URL + shows domain + retrieval
  timestamp + excerpt.
- **Edit** the proposed answer and every proposed field.
- **Approve** (→ §2.1), **Reject** (→ §3), **Defer** (→ `under_review` with
  notes), or **Deprecate a related existing knowledge row** in the same
  action.
- See **duplicate / similar** knowledge: the dedup similarity and the
  top-3 nearest `active` rows by embedding cosine.

### 2.3 New-version approval

`Governance.publishNewVersion(knowledgeId, adminId, { newAnswer, ...fields,
reason })`:

```
1. load current = Knowledge[knowledgeId]; assert status = "active"
2. create Knowledge { ...current fields ⊕ edits, version: current.version + 1,
                      supersedesId: current.id, approvedAt: now, approvedBy: adminId,
                      provenance: fresh (origin: "admin-authored", reviewerNotes: reason) }
3. current.status = "deprecated"; current.deprecatedAt = now; current.deprecatedBy = adminId
4. AuditLog { action: "knowledge.new_version", targetType: "Knowledge", targetId: newId,
             metadata: { previousVersionId: current.id, version, before, after, reason } }
5. KnowledgeVersionCounter += 1  (same txn)
6. COMMIT → IngestionService.ingest(newId)
7. emit KNOWLEDGE_APPROVED { knowledgeId: newId, previousVersionId: current.id, adminId }
```

---

## 3. Rejection contract (LOCKED)

`Governance.reject(candidateId, adminId, reason, closeAs?)`:

- `closeAs ∈ { rejected (default), duplicate, superseded }`.
- Sets `candidate.status`, `reviewedAt`, `assignedReviewerId`,
  `reviewNotes = reason`; for `duplicate` also sets `duplicateOfId`.
- Writes `AuditLog { action: "knowledge.reject", targetType:
  "KnowledgeCandidate", targetId, metadata: { reason, closeAs,
  candidateSnapshot } }`.
- Emits `KNOWLEDGE_REJECTED { candidateId, reason, closeAs, adminId }` and
  `KNOWLEDGE_CANDIDATE_REVIEWED { decision: "rejected", reviewLatencyMs }`.
- The candidate row is **retained forever** (soft-delete only for a privacy
  request). A rejected candidate is **structurally unreachable** by retrieval
  (different table; retriever queries `Knowledge` only).

---

## 4. Deprecation & archival (LOCKED)

| Action | Effect | Audit action |
|---|---|---|
| `deprecate(knowledgeId, adminId, reason)` | `status = deprecated`, `deprecatedAt/By` set; **excluded from retrieval on the next query** (version fingerprint bumped in the same txn); still visible to admins and in provenance history | `knowledge.deprecate` |
| `archive(knowledgeId, adminId)` | `deprecated → archived`; excluded from admin default lists; retained | `knowledge.archive` |
| `reinstate(knowledgeId, adminId, reason)` | `deprecated → active` (rare; e.g. a wrongful deprecation); fingerprint bump | `knowledge.reinstate` |
| freshness sweep auto-deprecation | a `DYNAMIC` row past `expiresAt` → `deprecated` (reason `expired`); a `PERIODIC` row long past review-due (e.g. 2× the interval) → flagged, **not** auto-deprecated (admin decides) | `knowledge.deprecate` with `actorUserId = "system"` |

Deprecation never deletes. The row remains a "this was our verified answer
from X to Y" record — useful for governance and for answering "what changed".

---

## 5. Audit trail (LOCKED — reuse `AuditLog`)

Every governance transition writes exactly one `AuditLog` row. `AuditLog` is
already append-only with **no update path and no `deletedAt`** anywhere in the
app — an audit trail the same admins could edit would defeat its purpose.

Required content per the brief, mapped to `AuditLog` columns:

| Brief requirement | `AuditLog` field |
|---|---|
| who approved/rejected/deprecated | `actorUserId` (verified admin session id; `"system"` for the sweep) |
| what was approved | `targetType` + `targetId` + `metadata.after` (full knowledge snapshot) |
| version | `metadata.version` |
| when | `createdAt` |
| previous version if applicable | `metadata.previousVersionId` |
| source / evidence | `metadata.before` (candidate snapshot incl. `evidence` provenance) |
| the change itself | `metadata.before` / `metadata.after` (real values, never a summary invented after the fact — `AuditLog`'s own documented rule) |

`action` vocabulary (free-string, consistent):
`knowledge.approve` · `knowledge.reject` · `knowledge.new_version` ·
`knowledge.deprecate` · `knowledge.archive` · `knowledge.reinstate` ·
`knowledge.candidate_defer` · `knowledge.edit_metadata` ·
`knowledge.answer_cache_flush` · `knowledge.freshness_review`.

Reviewer identity, permissions, and the before/after are therefore all
captured with **no new audit model**.

---

## 6. Permissions model (LOCKED)

- Every `/api/private/admin/knowledge-loop/**` route calls
  `requireAdmin(ctx.requestId, ctx.startedAt)` first and does nothing until it
  returns `ok: true` — identical to every existing admin route.
- Every non-admin `/api/private/knowledge-loop/**` route calls
  `getUserOrNull()` and scopes all reads/writes to the session user id
  (`userId` never from the body) — identical to the existing knowledge routes.
- `approve` / `reject` / `deprecate` / `publishNewVersion` are **not exposed
  as HTTP at all** except behind the admin gate, and are **not exported** from
  any module an agent tool or client bundle can import (server-only barrel,
  same as `services/agent-framework/memory/index.ts`).
- Role-based approval permissions: `admin` only in beta. The
  `resolveGovernanceDecision(role, action)` helper is the single seam where a
  finer role model plugs in later (the AN1.9 `resolveWriteDecision` pattern).

---

## 7. Security / privacy — knowledge classification & ingestion checks (LOCKED)

### 7.1 Visibility classes

| `visibility` | Who can retrieve it via the assistant |
|---|---|
| `public` | everyone (guest, customer, admin) |
| `customer` | authenticated users + admins |
| `admin` | admins only (internal ops knowledge surfaced only in admin tools) |
| `internal` | never surfaced to any end-user answer; retained for reference/import only |

`scope` × `visibility` are both applied in the `VectorRepository` filter. A
`scope = user` row is *additionally* filtered to its owning `userId` and is
never promoted to `assistant`/`shared` scope without going through the
candidate → approval flow.

### 7.2 Ingestion privacy/security checks (LOCKED — run before any candidate is created AND again before approval)

A candidate's `proposedAnswer` and `canonicalQuestion` are scanned for:

| Check | Action on hit |
|---|---|
| email address, phone, full name patterns, postal address | **block** candidate creation; if found at approval → abort approval, flag for admin edit |
| API key / token / secret patterns (`sk-`, `Bearer `, long hex/base64 blobs, `ANTHROPIC_API_KEY=` etc.) | **block** |
| card number (Luhn), IBAN, SSN/passport patterns | **block** |
| account-specific references ("your order #", "your subscription expires", user id / cuid patterns) | **block** — this is user-specific, not general knowledge |
| a `userId`, `conversationId`, `licenseKey`, `invoiceId` value | **block** (redact-or-reject; beta = reject) |
| forbidden trading language (`scanForForbiddenLanguage`, `lib/ai/compliance.ts`) | **warn** — admin must resolve before approval; a directive ("buy now") can never become knowledge |

The scanner is deterministic and shared with the orchestrator's
`privacyClass` classification. No candidate bearing user-specific or sensitive
content is ever created (orchestration §9), and this is the second, defensive
gate at approval time.

### 7.3 Tenant / user scoping

Beta has no multi-tenant/org knowledge partitioning — `scope` is the only
partition and `assistant`/`shared`/`support` knowledge is global to the
platform. If org-scoped knowledge is needed later, `scope` gains an
`orgId`-qualified variant and the `VectorRepository` filter gains one more
`AND` clause — additive, no model change.

### 7.4 No private data in globally-retrievable knowledge

Enforced by: (a) §7.2 scans at two points; (b) `privacyClass ≠ public` turns
never producing a candidate; (c) `scope = user` rows never auto-promoting;
(d) approval requiring a human admin who sees the originating conversation and
the scan result. A privacy-erasure request (a user asking for their data to
be deleted) is handled by: soft-deleting any `scope = user` rows they own,
soft-deleting/redacting any `KnowledgeCandidate` originating from their
conversations that is still open, and — if an approved `Knowledge` row is
found to contain their personal data — a `publishNewVersion` that removes it
(the old version is deprecated, not hard-deleted, unless legal requires
otherwise, in which case a hard delete + `AuditLog` is the documented
exception).

---

## 8. Data retention (LOCKED)

| Data | Retention |
|---|---|
| `Knowledge` (all statuses incl. `deprecated`/`archived`) | indefinite (soft-delete only) — the historical "what we told users" record |
| `KnowledgeChunk` | replaced on re-ingest; soft-deleted rows kept for audit |
| `KnowledgeCandidate` (incl. `rejected`) | indefinite — needed for "repeated question" / gap analytics and to show an admin "you already rejected this" |
| `KnowledgeAnswerProvenance` | 180 days rolling (beta), then aggregate-and-purge; extended if a governance investigation needs it |
| `KnowledgeRetrievalLog` | 180 days rolling |
| `AuditLog` (governance rows) | indefinite — never purged, never edited |
| `KnowledgeAnswerCache` | `ANSWER_CACHE_TTL` + a 7-day grace before the sweep deletes expired rows |
| `AnalyticsEvent` (loop events) | platform default (already indefinite, append-only) |

The 180-day purges run in the single daily cron (or a manual admin action);
they aggregate to the metrics tables first so dashboards keep working.

---

## 9. Governance surfaces (beta — minimal, per sprint §24 "no large admin UI")

| Surface | Route | Purpose |
|---|---|---|
| Candidate queue | `/dashboard/admin/knowledge-loop/candidates` | list open candidates, open one, approve/reject/defer/edit |
| Knowledge list | `/dashboard/admin/knowledge-loop/knowledge` | list `active`/`deprecated` loop knowledge, deprecate, publish new version, view provenance + audit history |
| Metrics (read-only) | `/dashboard/admin/knowledge-loop/metrics` | the beta dashboard ([`KNOWLEDGE_ANALYTICS_CONTRACT.md`](KNOWLEDGE_ANALYTICS_CONTRACT.md) §3) |

These extend the existing `/dashboard/admin/knowledge` page pattern
(`AdminKnowledgeService`), not a new admin shell.

---

## 10. Change log

| Date | Entry |
|---|---|
| 2026-09-08 | K0.5 created. Reuses `AuditLog` + `requireAdmin`; no new audit model. Approval is explicit, human-only, no-agent, no-threshold (AN1.9 pattern). Two-point privacy scan (§7.2). Retention policy (§8). Minimal 3-surface governance UI (§9). |
