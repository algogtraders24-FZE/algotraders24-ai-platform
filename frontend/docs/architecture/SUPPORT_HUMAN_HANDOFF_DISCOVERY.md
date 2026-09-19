# AT24 Support — Human Handoff Discovery

Discovery + architecture sprint only. No application code, schema, migration,
UI, or dependency changes are part of this document. Every claim below is
sourced to a real file/line in the repository at the verified baseline
below, not inferred from naming conventions or assumed from general SaaS
patterns.

## 1. Executive Summary

AT24 Support today can *detect* that a question needs a human
(`escalate: true` on the answering `AgentRun`) but cannot *do* anything
about it beyond showing a static "Talk to a human" link to the platform's
public contact page. This is not an oversight — it is explicitly documented
in the Support Agent's own locked design comment as deferred to a future
sprint named "CS2" (`services/agent-framework/agents/support-agent.ts:22`:
*"D5 Unresolved -> a structured escalate:true hand-off. No ticket is
created in this slice (CS2)."*). An independent, unrelated discovery sprint
(`docs/architecture/AT24_EMAIL_COMMUNICATION_RECONCILIATION.md`, merged
2026-09-18) reached the identical conclusion from the email/notification
angle: *"there is no ticket object... not assigned to a human agent, not
queryable as 'open tickets'"* (§11, SP01–SP05). Two independent passes over
the same code agree: this gap is real, narrow, and exactly where the owner's
brief says it is.

The repository already has everything a handoff needs *except* the handoff
record itself: a real multi-turn conversation identity (Phase B), a
bounded, privacy-safe context-summarization primitive (Phase B's
`conversation-context.ts`), a real admin RBAC gate and admin console shell
(`lib/auth/adminRoute.ts`, `app/dashboard/admin/*`), a proven "queue with a
status an admin can transition" pattern (`Feedback` model +
`AdminFeedbackService.ts` + `/dashboard/admin/feedback`), and a real
(if narrow) outbound-email capability (`services/notifications/EmailService.ts`)
that could later notify staff — none of which need to be rebuilt.

What's missing is small and specific: one new table to represent a handoff
as a durable, cross-user-queryable, human-status-tracked object, linked to
the `AgentRun`/conversation that produced it, without duplicating
`Conversation`/`Message` (off-limits — CS1.2 D1), without duplicating
`Feedback` (wrong shape — free text, no conversation linkage), and without
touching `AuditLog` (right for admin-action logging, wrong for the handoff's
own primary state).

## 2. Verified Repository Baseline

```
origin/main HEAD = ebe8c42e64231c9a6fa5ffbb093d6d04375cd56e
```

Verified from a fresh worktree (`E:/handoff-discovery`) checked out directly
at `origin/main`, branch `docs/support-human-handoff-discovery` created
from that tip. No checkout/reset/rebase/merge/branch-delete was performed
on any other branch or worktree.

| Checkpoint | Commit | `git merge-base --is-ancestor <sha> HEAD` |
|---|---|---|
| CS1 Support foundation (PR #51) | `63d4eb1` | **ANCESTOR — present** |
| Phase A Generative Support (PR #77) | `ffb288d` | **ANCESTOR — present** |
| Phase B Conversation Continuity (PR #79) | `80828cf` | **ANCESTOR — present** |

`origin/main` has moved 13 commits past the Phase B merge (`80828cf` →
`ebe8c42`), none of them touching Support: three licensing PEM-parsing
fixes (PRs #81/#82/#83), a navbar/checkout fix (#88), a Stripe
customer-id/mode-mismatch fix (#87), legal-pages email fixes (#86), a legal
pages feature (#85), the email/communication reconciliation doc (#91), a
purchase-confirmation-email feature (#89/#90), and a license-issuance-
failure alert (#92). Confirmed via `git log --oneline origin/main -15` —
no discrepancy with the three checkpoints above.

## 3. Current Support Chat Flow

Traced end to end, authenticated path (`hooks/useSupportRun.ts` is the
single shared client for both `/dashboard/support` and the root-mounted
`SupportWidget`):

```
User types a question
  -> useSupportRun.ask() [hooks/useSupportRun.ts]
  -> POST /api/private/agents/framework/runs
       { agentType: "SUPPORT", goal: { question }, conversationId? }
       [app/api/private/agents/framework/runs/route.ts]
  -> getUserOrNull() session check (route.ts:28/38) - never a body userId
  -> startAgentRun() [services/agent-framework/api/agent-run-service.ts:124]
       -> agentRuntime.startRun() creates a queued AgentRun row
          (metadata: {definition, contract:"AF-v1"})
       -> SUPPORT only: normalizeConversationId() + patchRun additive
          {conversation:{id}} (Phase B, agent-run-service.ts:133-141)
  -> client polls POST .../runs/:id/advance up to MAX_ADVANCES times
  -> agentRuntime.tick(runId) [runtime/agent-runtime.ts]
       -> Supervisor selects supportSpecialist
            [supervisor/specialists/support.specialist.ts]
       -> planTools(): support.knowledge_search always;
          support.account_read only if ACCOUNT_MARKERS regex matches
          the question (support.specialist.ts:87-93)
       -> KB retrieval: support.knowledge_search tool
            [services/agent-framework/tools/impl/support-knowledge-search.core.ts]
          -> shared retrieval core also used by the guest path
             (services/support/guest-knowledge-query.ts)
       -> account-context: support.account_read tool (read-only plan/
          subscription/purchase/license status, only when planned)
       -> synthesize() [support.specialist.ts:116-204] - DETERMINISTIC,
          NO LLM (locked, framework-wide invariant): coverage =
          kb-answered | account-context | no-coverage; escalate = true
          when unresolved OR MUTATION_MARKERS matches (line 161)
  -> advanceAgentRun() [agent-run-service.ts:142] - once terminal AND
     eligible (coverage:"no-coverage", non-mutation), calls
     generateSupportAnswerForRun() [services/support/generate-answer.ts]
       -> loadConversationHistory() reads metadata.conversation.id (Phase
          B), fetches bounded prior turns via
          agentRunRepository.listRunsForConversation (userId-scoped)
       -> attemptGeneration(): claude -> gemini -> openai chain,
          scanForForbiddenLanguage compliance gate
       -> on success: patches output.coverage -> "kb-generated", clears
          escalate, appends AgentStep(kind:"model_call") +
          AgentEvidence(source:"support-generated:answer"), charges
          credits (createCreditLedger, kind:"model_inference")
  -> response persistence: the SAME AgentRun row (id/status/output/
     metadata/evidence), read back via getRunObservability - no separate
     response table
```

Guest path (unauthenticated, `services/support/guest-knowledge-query.ts` +
`POST /api/support/guest`) never creates an `AgentRun` at all (P1 D11) —
structurally cannot participate in a `AgentRun`-anchored handoff without a
separate design decision (see §12, §19).

## 4. Existing Escalation Flow

**Where escalation is decided:** `support.specialist.ts:161`, entirely
inside the deterministic `synthesize()` step —
`const escalate = !resolved || mutationIntent;`. `resolved` is
`coverage !== "no-coverage"`; `mutationIntent` is `MUTATION_MARKERS.test(goal.question)`
(line 44, a regex over words like `cancel|refund|upgrade|downgrade|change...`).

**Deterministic or generative?** Deterministic only. Phase A's generative
fallback (`generate-answer.ts`) can *clear* an escalation (turn
`no-coverage` → `kb-generated`) but never *sets* one — `isEligibleForGeneration`
explicitly excludes the mutation case (constraint carried from Phase A) so
generation can never touch a mutation escalation, and a failed/declined
generation leaves the deterministic escalation exactly as the specialist
set it.

**What data survives after escalation:** the full `AgentRun` row — `input`
(the question), `output` (`{coverage, escalate, escalationReason,
citations, accountFindings, disclaimer, ...}`), every `AgentStep`/
`AgentToolCall`/`AgentEvidence` in its trace, and (Phase B)
`metadata.conversation.id` linking it to prior turns. Nothing is deleted or
summarized away — this is the full, real evidence trail a handoff could
reference.

**Durable database record on escalation?** No dedicated one. The
`AgentRun` itself is durable (it exists regardless of `escalate`'s value),
but there is no row that means "this needs a human," queryable across
users, with its own lifecycle. Confirmed independently by the email
reconciliation doc's SP01 finding (§11 there).

**Stable identifier?** Yes — `AgentRun.id` (cuid) is stable, and (Phase B)
`metadata.conversation.id` is stable across the whole conversation. Either
is a safe, real foreign key for a future handoff row.

**Can the user explicitly request a human?** No dedicated action exists.
The only affordance is the static "Talk to a human" link
(`components/support/SupportWidget.tsx:75-76,388-389`,
`app/dashboard/support/page.tsx:140-141`) pointing at `/company/contact` —
plain client-side navigation, no API call, no state change, no record of
the request.

**Does "Talk to a human" do anything beyond displaying contact info?**
Confirmed: no. It is a `<Link href="/company/contact">` — a route to a
public page. Zero backend interaction.

**Multiple escalation signals per conversation?** Yes, structurally
possible today with zero deduplication: each question is its own
`AgentRun`; a user can ask three different unresolvable questions in one
Phase-B conversation and get three independently `escalate:true` runs. No
existing mechanism merges or dedupes these (§9, §19 — an open decision for
handoff cardinality).

**Existing support case/ticket model under another name?** No. The
duplication check (§18) found zero repository-wide matches for a genuine
ticket/case/queue/handoff concept outside Support's own `escalate` flag and
unrelated vendor/infra uses of the word "handoff" (a Vercel function-region
comment) and "operator" (math/trading operators in the strategy compiler).

## 5. Existing Data Models

```
Model: Conversation / Message
Purpose: Main AI Assistant's multi-turn chat (Sprint 15C.3 / D2.6.7);
         Conversation.intelligenceContext carries market-intelligence
         context pointers.
Current owner: The main AI Assistant (services/ai/*, the knowledge chat
         route) - NOT Support.
Relationships: Message.conversationId -> Conversation.id (cascade).
Relevant fields: userId, title, messageCount, intelligenceContext (Json).
Relevant enums: none.
Can reuse?: NO.
Why / why not: CS1.2 D1 is a locked invariant - Support "shares nothing
         with the main AI Assistant: not services/ai/*, not the knowledge
         chat route, not the Conversation stack"
         (services/agent-framework/agents/support-agent.ts:10-12). Reusing
         this model for Support handoffs would be a direct violation, not
         a style choice.

Model: AgentRun / AgentStep / AgentToolCall / AgentEvidence
Purpose: The durable execution ledger for every Agent-Framework run,
         including every Support question (prisma/schema.prisma:1725-1886).
Current owner: services/agent-framework/runtime (A1-A15).
Relationships: AgentStep/AgentToolCall/AgentEvidence all FK to AgentRun,
         cascade delete.
Relevant fields: AgentRun.userId, .metadata (Json, additive - already
         carries `definition`, `contract`, `resolutionConfirmation`,
         Phase B's `conversation.id`), .output (Json).
Relevant enums: AgentRunStatus, AgentStepKind, AgentEvidenceType.
Can reuse?: PARTIALLY - as the thing a handoff POINTS TO, not as the
         handoff itself.
Why / why not: every existing read of these tables is userId-scoped by
         design (agentRunRepository.getRunForUser / listRunsForUser /
         listRunsForConversation all take userId as a required, first
         condition). A human-support queue needs the opposite - list
         across ALL users by status - which none of these query shapes
         support, and adding one would mean an unindexed full-table JSON
         scan (metadata has no @@index on its contents). A dedicated
         table with a real @@index([status]) is the correct shape, the
         same conclusion `Feedback` already reached for an unrelated
         admin-queue need.

Model: Feedback
Purpose: User-submitted bug/feature/general feedback, admin-reviewable
         (prisma/schema.prisma:592-607, Sprint R1.2 Phase 1).
Current owner: services/feedback/FeedbackService.ts (write),
         services/admin/AdminFeedbackService.ts (admin read+status).
Relationships: none (flat, userId only - no FK to any other model).
Relevant fields: userId, type, message, page, status (open|reviewed|
         resolved, plain String with a validated allow-list, not a
         Prisma enum), createdAt/updatedAt.
Relevant enums: none (FeedbackStatus is a TS-level union + isFeedbackStatus()
         guard, not a DB enum).
Can reuse?: NO, but its SHAPE is the direct precedent to follow.
Why / why not: purpose-built for free-text, unstructured reports with no
         conversation/evidence linkage and no escalation reason. Extending
         it to also carry conversationId/agentRunId/context-snapshot/
         escalation-reason would overload one table with two unrelated
         concerns (user complaints vs. AI escalations) and would mean
         Support's own escalation flow writing into a table
         services/feedback owns - worse coupling than a new table.

Model: AuditLog
Purpose: Generic actor/action/target event log (prisma/schema.prisma:555-568).
         "Every action here is audit-logged" is the Admin Control Center's
         own stated convention (app/dashboard/admin/layout.tsx:19).
Current owner: no single service - written ad hoc by whichever admin
         action needs it.
Relationships: none (targetType/targetId is a loose, untyped pointer).
Relevant fields: actorUserId, action, targetType, targetId, metadata (Json).
Relevant enums: none.
Can reuse?: YES, but only as the AUDIT TRAIL for actions taken ON a
         handoff (e.g. "admin X moved handoff Y from OPEN to ASSIGNED"),
         never as the handoff's own primary state.
Why / why not: it is a write-only event stream with no per-target current-
         state field and no uniqueness/lifecycle guarantee - exactly
         right for "what happened," exactly wrong for "what is the
         current status," which a queue needs to query directly and
         cheaply.

Model: User / Subscription / Purchase / Entitlement / License / Activation
Purpose: Account/billing/licensing state (prisma/schema.prisma:14-33,
         50-73, 1218-1352).
Current owner: services/billing/*, services/marketplace/*.
Relationships: standard FK chains off User.id.
Relevant fields: User.role (String, default "user" - the RBAC value
         lib/auth/adminRoute.ts checks via assertRole("admin")).
Relevant enums: none (role is a plain String).
Can reuse?: N/A for the handoff record itself - relevant only as read-only
         REFERENCE data a handoff's context package may cite (e.g. "this
         escalation happened on a Pro-plan account"), never copied/
         duplicated into the handoff row.
Why / why not: these are the account-context tool's own data sources
         already (support.account_read) - a handoff should reference the
         same AgentEvidence rows the run already produced, not re-query
         or re-store account facts itself (see §14).
```

## 6. Existing Admin / Support Surfaces

A full, real admin console already exists — not a stub:

- **RBAC gate:** `lib/auth/adminRoute.ts` → `requireAdmin()`, built on
  `assertRole("admin")` (`lib/auth/protectedRoute.ts`). Every
  `/api/private/admin/*` route calls this first (confirmed: 13 admin API
  route files all match the `assertRole`/`requireAdmin` grep in §7 of the
  investigation). Server-side page gate: `requireRole("admin", "/dashboard")`
  in `app/dashboard/admin/layout.tsx:12`.
- **Admin shell + nav:** `app/dashboard/admin/layout.tsx` (header + gate)
  wraps `components/admin/AdminNavTabs.tsx`, a plain `<Link>`-based tab bar
  (works without JS) currently listing: Overview, Users, Subscriptions,
  Knowledge, AI Usage Analytics, System Health, Audit Logs, Beta Overview,
  Feedback.
- **Direct precedent for a queue UI:** `app/dashboard/admin/feedback/page.tsx`
  + `services/admin/AdminFeedbackService.ts` (`list()` / `updateStatus()`,
  `open → reviewed → resolved`) is the closest existing "admin reviews a
  queue with a status transition" pattern in the entire codebase.
- **`/dashboard/support` is user-facing only** — no admin variant exists,
  no admin route currently reads Support's `AgentRun` rows.
- **Notification precedent (not wired to Support):**
  `services/notifications/EmailService.ts` exports
  `sendPurchaseConfirmationEmail` and (as of PR #92)
  `sendLicenseIssuanceFailureAlert` — the latter is explicitly an
  *internal ops alert* pattern ("Sent to the team, never the buyer") that a
  future "notify staff of a new handoff" feature could follow, but nothing
  wires Support to it today.

## 7. Reuse vs New Infrastructure Matrix

| Capability needed | Existing infrastructure | Verdict |
|---|---|---|
| Auth / session | `getUserOrNull`, `assertRole` | REUSE as-is |
| Admin RBAC | `lib/auth/adminRoute.ts` | REUSE as-is |
| Admin shell/nav | `app/dashboard/admin/layout.tsx`, `AdminNavTabs.tsx` | REUSE, add one nav entry |
| Queue-with-status UI pattern | `AdminFeedbackService.ts` / feedback admin page | REUSE the PATTERN, not the table |
| Conversation identity | Phase B `metadata.conversation.id` | REUSE as-is |
| Bounded, privacy-safe context summarization | `services/support/conversation-context.ts` | REUSE, extend with an unredacted-for-humans mode (see §13) |
| Evidence/citations | `AgentEvidence` rows already on the run | REUSE by reference (evidence IDs), never copy |
| Credit ledger | `createCreditLedger()` | REUSE if any billable action is ever added (none proposed now) |
| Admin action audit trail | `AuditLog` | REUSE for handoff status-change events |
| Durable, cross-user-queryable handoff state | **none** | **NEW** — see §8 |
| Human-reply-in-conversation capability | **none anywhere in the codebase** | **NEW**, explicitly out of scope this phase per the owner's brief (§10) |
| Outbound email/notification | `EmailService.ts` (narrow: purchase + one ops alert) | Present but NOT required for MVP (owner's own instruction, §15) |
| External ticket provider | **none** | Explicitly out of scope (§16) |

## 8. Candidate Human Handoff Domain

**Decision:** one new model, `SupportHandoff`, is required — not the three
speculatively named in the brief (`SupportHandoffAssignment`,
`SupportHandoffEvent`).

**Evidence:** §5 and §7 above — no existing model can be a cross-user-
queryable, status-tracked record without either a locked-invariant
violation (`Conversation`) or an unindexed full-table JSON scan
(`AgentRun.metadata`).

**Reason:** the MVP scope explicitly excludes multi-human assignment
routing complexity and a separate immutable event-sourcing log (§9's
lifecycle is small enough — 4-5 states) — a single row per handoff with a
`status` field plus reuse of `AuditLog` for the "what changed and when"
trail covers the required "reason/status/timestamps" and "audit
information" without a second or third new table.

**Alternatives considered:**
- *Three separate tables now* (`SupportHandoff` + `...Assignment` +
  `...Event`), matching the brief's speculative names. **Rejected**: no
  evidence in this MVP's own scope (no multi-human assignment, no
  requirement for immutable event replay beyond what `AuditLog` already
  gives generically) justifies the extra tables now; they can be added
  later without migrating the core handoff row if genuinely needed
  (`AuditLog.targetId` already accepts any target type as a loose pointer).
- *Extend `Feedback`* — rejected in §5 (wrong shape, wrong owner service).
- *Extend `AgentRun.metadata`* — rejected in §5/§7 (no cross-user query
  path).

**Minimum required state:** `id`, `userId` (owner, always the same as the
originating `AgentRun.userId`), `agentRunId` (FK, the run whose
`escalate:true` produced this handoff), `conversationId` (Phase B's tag,
denormalized as a plain string — same pattern `Message.userId` already
uses to avoid an extra join), `reason` (copy of the run's own
`escalationReason` string — never re-derived), `status`, `contextSnapshot`
(Json — see §13), `createdAt`, `resolvedAt` (nullable), `updatedAt`.

**Relationships required:** `AgentRun` (`onDelete: Cascade`, matching
every other AgentRun-child relation in the schema) — nothing else. No FK
to `Conversation`/`Message` (off-limits), no FK to an "assigned admin"
column in the MVP (see §10 — `UNKNOWN — REQUIRES DECISION`).

**Audit information required:** every status transition should produce an
`AuditLog` row (`actorUserId` = the admin who acted, or a system marker for
an AI/user-triggered transition, `action` = e.g. `"support_handoff.status_changed"`,
`targetType` = `"SupportHandoff"`, `targetId` = the handoff id, `metadata`
= `{from, to}`) — reusing the exact convention the Admin Control Center
already documents as its own rule (`app/dashboard/admin/layout.tsx:19`).

**Immutable vs mutable:** `id`, `userId`, `agentRunId`, `conversationId`,
`reason`, `contextSnapshot`, `createdAt` are immutable once written
(mirrors `AgentEvidence`'s own append-only discipline for the same reason —
a support case's original context must never silently change). `status`,
`resolvedAt`, `updatedAt` are the only mutable fields.

## 9. Candidate State Machine

**Decision:** a 4-state lifecycle — `OPEN → ASSIGNED → IN_PROGRESS → RESOLVED`,
plus `OPEN → CANCELLED` and `RESOLVED → REOPENED` — is directionally right,
but `ASSIGNED` should be `UNKNOWN — REQUIRES DECISION` pending §10, and
`REOPENED` should collapse back to `OPEN` rather than being its own state
(no evidence anywhere in this codebase for a fifth persisted state
producing distinct behavior from `OPEN`).

**State-transition matrix:**

| From | To | Who can trigger | Event | Reversible? | Audit event | User-facing effect |
|---|---|---|---|---|---|---|
| (none) | `OPEN` | System (server-side, on `escalate:true`) or the user (explicit "connect me to a human" action, §12) | A SUPPORT `AgentRun` reaches terminal `escalate:true`, OR the user explicitly requests one | N/A | `support_handoff.created` | Widget/page shows "Handed to human support" state |
| `OPEN` | `ASSIGNED` | Admin/support staff — **UNKNOWN — REQUIRES DECISION, see §10** | An admin claims the case | Yes (`ASSIGNED` → `OPEN` if unclaimed again) | `support_handoff.status_changed` | None visible to the user beyond status label, if surfaced at all |
| `ASSIGNED` | `IN_PROGRESS` | The assigned admin | Admin begins working the case | Yes | `support_handoff.status_changed` | Same as above |
| `IN_PROGRESS` / `ASSIGNED` / `OPEN` | `RESOLVED` | Admin (marks resolved) | Admin action | Yes (via `REOPENED`→`OPEN`) | `support_handoff.status_changed` | Widget/page shows "Resolved by support" |
| `OPEN` | `CANCELLED` | The user (explicit) or admin | User no longer needs help / admin determines it's a duplicate/invalid | No | `support_handoff.status_changed` | Handoff no longer shown as pending |
| `RESOLVED` | `OPEN` (a "reopen", not a literal `REOPENED` state) | The user (e.g. via a "this isn't resolved" action) | User signals the resolution didn't hold | Yes | `support_handoff.status_changed` | Back to "Handed to human support" |

## 10. Assignment Model

**Can an admin/support operator be assigned?** Structurally yes (a nullable
`assignedAdminId: String?` FK to `User` would be a trivial additive
column), but there is **no existing support-role/RBAC concept finer than
`role: "admin"`** — `User.role` is a plain String with exactly one
privileged value checked anywhere in the codebase (`assertRole("admin")`).
There is no `"support"` or `"support_agent"` role, no team/group model, no
existing "admin can be assigned work" pattern anywhere (`Feedback` has a
status but no assignee field either).

**Recommendation (queue-based, not assignment-based, for MVP):**
`Decision:` do not add an assignee field or an `ASSIGNED` state distinct
from `OPEN` in the MVP. `Evidence:` zero existing role granularity beyond
"admin," zero existing multi-admin-workforce pattern anywhere in the repo.
`Reason:` any admin with the existing `role: "admin"` can already see and
act on any row in every other admin queue (`Feedback`, `Users`,
`Subscriptions`) — there's no precedent for per-admin ownership anywhere to
extend. `Alternatives considered:` adding `assignedAdminId` now.
`Why rejected:` it would introduce a new authorization axis
(is this admin the *assigned* one, or any admin?) with zero existing
answer in this codebase — a real, undecided product question, not an
architecture one this discovery can resolve from evidence alone.

**Can multiple humans own one case / one human own multiple cases?**
`UNKNOWN — REQUIRES DECISION` (a queue-based MVP with no per-row assignee
makes this moot until assignment itself is decided).

**What happens if the assigned operator becomes unavailable?**
`UNKNOWN — REQUIRES DECISION`, moot under the queue-based recommendation
above.

## 11. AI → Human Ownership Model

**Can AI continue answering after a handoff is created?** Recommendation:
no — the moment a handoff exists for a run/conversation, the widget should
treat that turn as "handed off," not attempt further generation on it.
`Evidence:` Phase A's `isEligibleForGeneration` already only fires on
`no-coverage` + non-mutation; a handoff is created for exactly that same
`escalate:true` case, so there's no scenario where generation would have
succeeded anyway. `Reason:` avoids the confusing "handed off AND still
getting an AI-generated answer" UI state.

**Does AI become read-only? Can AI draft an answer for a human?** Not
proposed in this MVP — no evidence of any "draft for human review" concept
anywhere in this codebase, and the owner's explicit non-goal list excludes
"AI-generated fake 'human is typing' behaviour," which is adjacent enough
to flag as the same category of over-scoping.

**Can a human respond inside the same conversation? Does the user remain
in the same thread?** `UNKNOWN — REQUIRES DECISION` at the product level —
but architecturally: **no human-reply mechanism exists anywhere in the
codebase** (confirmed independently by the email reconciliation doc's SP02:
*"There is no human-reply mechanism anywhere in the codebase"*). Building
one is explicitly a larger, separate capability than "create a structured
handoff record" — this discovery recommends the MVP handoff record exist
without a reply capability, and the user's existing conversation thread
(Phase B) is simply marked as handed-off, with the real human response
happening entirely out-of-band (email/contact-page, unchanged from today)
until a reply capability is separately authorized.

**Does handoff create a new thread?** No — recommend reusing the existing
Phase B `conversationId`, never forking a second thread identity.

**What happens to new user messages while `OPEN`/`IN_PROGRESS`?**
Recommendation: the user can still ask new questions (a new `AgentRun` in
the same conversation) — Support's deterministic/generative pipeline stays
completely unchanged and unaware of any handoff row's existence. A new
`escalate:true` run in a conversation that already has an `OPEN` handoff
should not create a second, duplicate handoff (see §9's cardinality note —
`UNKNOWN — REQUIRES DECISION`, flagged again in §19).

**After `RESOLVED`?** No special behavior needed — a later new question is
just a new `AgentRun`, same as today.

**Can AI automatically re-escalate?** Not proposed — no evidence of any
"re-escalation" concept anywhere in this codebase (confirmed SP04:
"reopened... MISSING EVENT SOURCE").

## 12. User-Requested Handoff

**Decision:** route both AI-triggered and user-requested handoffs through
the *same* `SupportHandoff` creation path — one canonical domain, not two
parallel systems.

**Evidence:** the only current difference between "AI decided this needs a
human" and "user asked for a human" is the *trigger*, not the *shape* of
what should be recorded — both need the same conversation/evidence context
package, the same queue visibility, the same lifecycle. Building a second
system for user-initiated requests would immediately duplicate the exact
problem this discovery exists to solve.

**Reason:** a single `reason` field on `SupportHandoff` can distinguish
the two (e.g. the specialist's own `escalationReason` strings for
AI-triggered, vs. a fixed `"user-requested"` marker for explicit requests)
without needing two tables.

**Open question this raises (see §19):** the guest path
(`services/support/guest-knowledge-query.ts`) has no `AgentRun` to anchor
a handoff to (P1 D11 — guests never create one). The owner's brief already
excludes "guest human handoff" from this phase's scope, so this is
consistent, not a gap — but it means `agentRunId` cannot be a required,
non-nullable field if a guest-handoff path is ever added later without a
second migration. Recommend keeping `agentRunId` required for the
authenticated-only MVP and revisiting nullability explicitly if/when guest
handoff is ever authorized.

## 13. Human Operator Context

**Decision:** three distinct categories, matching the brief's own framing,
with one important asymmetry to Phase B's own privacy rule made explicit:

```
User-visible conversation:
  - Exactly what the widget/page already renders: the question, the
    citations (kb-answered), the generated answer (kb-generated), the
    escalation notice. Nothing new here.

Human-operator support context (the SupportHandoff.contextSnapshot):
  - The bounded conversation history (Phase B's buildBoundedContext),
    BUT WITHOUT Phase B's account-context redaction. Real, retrieved
    account findings (from support.account_read's own AgentEvidence rows -
    never fabricated, never re-derived) SHOULD be visible to a human
    support agent, because that is the entire point of a human handoff for
    a billing/account question. This is a deliberate, explicit reversal of
    Phase B's `summarizeTurnForContext` redaction rule for the LLM prompt -
    that rule exists to keep account data out of a third-party LLM call,
    not to hide it from AT24's own staff.
  - KB evidence actually retrieved for the escalating question (citations
    + weak hits, by evidence ID reference - never copied text, to avoid
    a stale duplicate if the KB entry is later edited).
  - The escalation reason (verbatim from the run's own `escalationReason`).
  - Timestamps (createdAt of the run, of each prior turn, of the handoff).

Restricted/internal AI context (must NEVER appear in the handoff, for
either the user or a human operator):
  - Internal step timing/duration, resumeState, credit
    ledger entries/amounts, the raw system prompt/instruction text sent to
    the LLM, provider name/internal routing decisions, anything from
    `AgentRun.limits`/`creditsEstimated` - none of this helps a human
    resolve a support issue and all of it is AT24-internal operational
    detail ("no exposure of internal/system-only data" from the owner's
    own scope list maps directly to this category).
```

**Reason for the account-data asymmetry being explicit, not assumed:** the
owner's brief for this exact discovery states Phase B's privacy boundary
must be "explicitly preserved" and that "the human operator must not
automatically receive information merely because the AI internally had
access to it" — read literally alongside "no fabricated account
information," the intent is: never *invent* account facts for a human, and
never leak *AI-internal* data, but real, actually-retrieved account
evidence is exactly what a human agent needs to do their job. This
discovery surfaces the reasoning rather than silently picking a side, per
§19.

**Implementation note (non-binding, since no code is being written this
sprint):** `conversation-context.ts`'s `summarizeTurnForContext` would need
a second, human-facing variant (or a parameter) that does NOT redact
`account-context` turns — reusing `buildBoundedContext`'s trimming logic
unchanged, since the bounding/ordering concern is identical for both
audiences.

## 14. Evidence / Provenance Model

**Decision:** reference existing `AgentEvidence` rows by ID inside
`contextSnapshot`; never copy full evidence text into the new table.

**Evidence:** Phase A's own generated-answer evidence
(`services/support/generate-answer.ts`) already establishes this exact
pattern — `generatedEvidenceIds: string[]` stored on the run's `output`,
pointing back at the real `AgentEvidence` rows, rather than duplicating
their `claim` text a second time.

**Reason:** avoids two representations of the same fact drifting apart (an
edited/retracted KB entry should not leave a stale copy sitting inside a
handoff snapshot forever), and keeps the new table small.

```
Immutable evidence: the referenced AgentEvidence rows themselves (already
  append-only per the schema's own discipline) - the handoff never writes
  to them.
Mutable case metadata: SupportHandoff.status, .resolvedAt, .updatedAt only.
Audit events: every status transition as an AuditLog row (§8).
```

**Do not duplicate large blobs unnecessarily:** the `contextSnapshot` Json
itself should be a small structured object — question text, evidence ID
references, the escalation reason string, timestamps — not a full copy of
every `AgentStep`/`AgentToolCall` in the run's trace (that full trace
remains queryable via the existing `agentRunId` FK for anyone who needs the
complete forensic record).

## 15. Security / Privacy Analysis

- **User isolation:** the new `SupportHandoff.userId` must be populated
  from the server session only (never a request body), matching every
  existing Support/Agent-Framework write path
  (`agent-run-service.ts`'s own locked comment: *"userId is ALWAYS supplied
  by the caller from the server session"*). A future read API for a user's
  *own* handoffs must scope by `userId`, exactly like
  `agentRunRepository.getRunForUser`.
- **Admin authorization:** any future admin read/write of `SupportHandoff`
  rows must go through `requireAdmin()` (`lib/auth/adminRoute.ts`), the
  same gate every other admin route already uses — no new auth mechanism
  needed or justified.
- **Cross-user conversation access:** Phase B's isolation guarantee
  (`agentRunRepository.listRunsForConversation` always scopes by the
  caller's own `userId` first) must not be weakened by anything the
  handoff introduces. Since `contextSnapshot` is built server-side from
  data the SAME run/conversation owner already produced, and admin access
  goes through a completely separate authorization gate (`requireAdmin`,
  not conversation ownership), there is no new cross-user leakage vector
  introduced by this design — but this must be verified again at
  implementation time with a real regression test, the same discipline
  Phase B itself used.
- **Direct-ID access / conversation enumeration:** a `SupportHandoff.id`
  must never be guessable-and-sufficient for either a user or an admin
  route — user routes need `userId` scoping, admin routes need the admin
  gate; neither should trust the ID alone (matches the existing
  `getRunForUser` / `requireAdmin` conventions exactly, so no new risk
  class is introduced if those conventions are followed).
- **Assignment / resolution authorization:** `UNKNOWN — REQUIRES DECISION`
  pending §10 (no assignment model is proposed for MVP); resolution should
  require `requireAdmin()` at minimum, same as every other admin
  state-changing action in this codebase.
- **Auditability:** covered by §8/§14's `AuditLog` reuse.

## 16. Notification Boundary

**Decision:** no notification/email/realtime infrastructure is required
for the first handoff MVP.

**Evidence:** the owner's own brief for this discovery explicitly instructs
not to assume email/realtime is required for MVP. Separately,
`services/notifications/EmailService.ts` exists but its only two callers
are purchase confirmation and a license-issuance-failure ops alert — wiring
it to Support would be new scope, not a reuse of something already
Support-adjacent.

**Reason:** an admin queue page (§6's reuse target) that an admin manually
checks is a complete, real MVP loop without any push notification —
exactly how `Feedback`'s own admin review works today (no notification
fires when new feedback arrives either).

**Future option, not proposed now:** `sendLicenseIssuanceFailureAlert`'s
"alert the team, not the end user" pattern is a directly reusable template
if/when "notify staff of a new OPEN handoff" is separately authorized.

## 17. External Ticketing Boundary

Confirmed explicitly out of scope, per the owner's own instruction. No
external provider (Zendesk/Intercom/Freshdesk/etc.) integration exists
anywhere in this codebase today, and none is recommended.

**Future integration boundary:** if an external provider is ever
introduced, the clean seam is at the `SupportHandoff` row itself — a
future `externalTicketId: String?` column (additive, no migration to
existing data) would let a sync job map an AT24 handoff to an external
ticket without touching the conversation/evidence model underneath it.
This is noted only because repository evidence (the clean separation
already achieved between `AgentRun`'s internal shape and any external
system) makes it technically easy later, not because it is needed now.

## 18. Duplication / Drift Analysis

Repository-wide search performed for: `support`, `ticket`, `case`,
`handoff`, `escalation`, `conversation`, `thread`, `assignment`, `agent`,
`operator`, `admin`, `resolution`, `audit`, `notification` (case-
insensitive, `.ts`/`.tsx`/`.prisma`).

```
Existing system: services/support/**, services/agent-framework/**
Purpose: CS1/Phase A/Phase B Support Chat (the system this discovery is
  building ON TOP OF).
Why it is / is not the canonical system: IS canonical - this is the
  system being extended, not a duplicate.
Reuse / extend / leave untouched: extend (new SupportHandoff table +
  minimal hook), core Support logic untouched.

Existing system: Conversation / Message (main AI Assistant)
Purpose: unrelated product's own multi-turn chat.
Why it is / is not the canonical system: NOT canonical for Support -
  CS1.2 D1 locked separation.
Reuse / extend / leave untouched: leave untouched.

Existing system: Feedback + AdminFeedbackService
Purpose: free-text user feedback, admin-reviewable queue.
Why it is / is not the canonical system: NOT canonical for handoffs
  (wrong shape - no conversation/evidence linkage) but IS the canonical
  UI/status-lifecycle PATTERN to copy.
Reuse / extend / leave untouched: leave the table untouched; reuse its
  UI/service PATTERN for the new SupportHandoff admin surface.

Existing system: AuditLog
Purpose: generic actor/action/target/metadata event log, already the
  Admin Control Center's own stated convention for "every action is
  audit-logged."
Why it is / is not the canonical system: NOT canonical for the handoff's
  own primary state (no per-target current-state query), IS canonical for
  the handoff's own action history.
Reuse / extend / leave untouched: reuse as-is for status-change audit
  events.

Existing system: "handoff" (Vercel function-region comment,
  app/api/private/marketplace/listings/[id]/checkout/route.ts:21) and
  "operator"/"assignment" hits (all in the strategy compiler / quant
  vendor code, meaning math/trading operators and variable assignment,
  not human-support concepts)
Purpose: unrelated - false-positive keyword matches.
Why it is / is not the canonical system: NOT related to Support at all.
Reuse / extend / leave untouched: leave untouched, no action needed.

Existing system: lib/auth/adminRoute.ts + app/dashboard/admin/*
Purpose: the platform's one and only admin RBAC + console shell.
Why it is / is not the canonical system: IS the canonical admin surface -
  no second admin system exists anywhere.
Reuse / extend / leave untouched: reuse as-is; add one new nav tab +
  route subtree when implementation is authorized.

Existing system: services/notifications/EmailService.ts
Purpose: the platform's one and only outbound-email capability (purchase
  confirmation + one ops alert).
Why it is / is not the canonical system: IS the canonical email seam, IF
  notification is ever added to Support handoffs - not needed for MVP (§16).
Reuse / extend / leave untouched: leave untouched for this phase.
```

**No hidden or duplicate ticket/case/queue/escalation system was found
anywhere in the repository outside Support's own `escalate` flag.**

## 19. Open Architecture Decisions

1. **Handoff cardinality:** one `SupportHandoff` per escalated `AgentRun`,
   or de-duplicated to at most one active (`OPEN`/`ASSIGNED`/`IN_PROGRESS`)
   handoff per `conversationId`? `UNKNOWN — REQUIRES DECISION` — repository
   evidence shows multiple escalated runs per conversation are already
   possible (§4) but nothing today needs to reconcile them into one record.
2. **Trigger:** automatic `SupportHandoff` creation the instant a run
   reaches `escalate:true` (mirrors Phase A's own "post-hoc hook in
   `advanceAgentRun`" pattern), vs. only on an explicit user action (a
   button, per §12's "user-requested" path)? Both are architecturally
   identical to build (same creation function, different caller) — this is
   a product decision, not an evidence gap, so it is listed here rather
   than defaulted.
3. **Assignment model:** none in MVP (§10's recommendation) is the
   evidence-backed default; needs explicit owner sign-off since it forecloses
   `ASSIGNED` as a real, distinct state until a support-role/RBAC concept
   is separately built.
4. **Admin queue UI:** is a minimal `/dashboard/admin/support-handoffs`
   list page in scope for the same implementation sprint as the schema, or
   deferred to a follow-up (data model + hook only this sprint)? The
   owner's scope list includes "human-support queue/inbox **data model**"
   but does not explicitly confirm a UI deliverable.
5. **`Status` representation:** a real Postgres enum (matching
   `AgentRunStatus`'s own convention, `AN1.2`-consistent) vs. a plain
   validated `String` (matching `Feedback.status`'s simpler convention)?
   Both exist as real precedents in this same schema for the same kind of
   field — evidence does not favor one over the other; needs a decision.
6. **Guest handoff readiness:** `agentRunId` required-vs-nullable (§12) —
   affects whether a future guest-handoff phase needs its own migration or
   not. Not urgent (guest handoff is explicitly out of scope now) but worth
   deciding now to avoid a later migration if cheap to keep open.

## 20. Recommended Implementation Contract

### EXISTING — DO NOT REBUILD
- CS1/A1–A15 Agent Framework runtime, Supervisor, specialist pattern, tool
  registry, credit ledger, evaluation service.
- Phase A generative fallback (`services/support/generate-answer.ts`) and
  its provider chain / compliance gate.
- Phase B conversation continuity (`conversationId` tagging,
  `listRunsForConversation`, `conversation-context.ts`'s bounded-window
  trimming).
- The guest Support path (`services/support/guest-knowledge-query.ts`) —
  untouched, out of scope.
- `lib/auth/adminRoute.ts` / `app/dashboard/admin/*` admin shell and RBAC.
- `AuditLog` as the admin-action audit mechanism.
- `services/notifications/EmailService.ts` — present, not wired to Support
  in this phase.

### REUSE
- `agentRunRepository` pattern (a single, locked-boundary repository module
  per domain) — a new `SupportHandoff` would get its own analogous
  repository, not ad hoc `prisma.supportHandoff.*` calls scattered across
  routes/services.
- `AdminFeedbackService.ts` / `/dashboard/admin/feedback` as the direct
  structural template for a future `AdminSupportHandoffService` +
  `/dashboard/admin/support-handoffs` page, IF a UI is authorized (§19.4).
- `requireAdmin()` for any admin-facing handoff route.
- `conversation-context.ts`'s `buildBoundedContext` trimming logic, reused
  (not duplicated) for the human-facing, unredacted context variant (§13).
- `AgentEvidence` row IDs referenced from the handoff snapshot, never
  copied as text (§14).
- `AuditLog` rows for every handoff status transition (§8).

### NEW (genuinely missing, confirmed by this discovery — not yet built)
- One new Prisma model: `SupportHandoff` (fields per §8; migration
  required — no existing model safely represents this, confirmed by
  evidence, not assumed).
- A hook analogous to Phase A's `advanceAgentRun()` integration point, to
  create a handoff on `escalate:true` (exact trigger per §19.2).
- A human-facing (unredacted-for-account-data) variant of the context
  summarizer (§13).
- A user-visible "handed to support" state in the widget/page (minimal UI
  addition — a status label, not a redesign).
- (Only if §19.4 confirms UI-in-scope) a minimal admin list page + one
  `AdminNavTabs` entry.

### FUTURE / OUT OF SCOPE
- External ticket providers (Zendesk/Intercom/Freshdesk/etc.) — §17.
- Email/realtime notifications for new handoffs — §16 (the
  `sendLicenseIssuanceFailureAlert` pattern is ready to reuse whenever
  authorized).
- Multi-human assignment / workforce management (§10).
- Human-reply-inside-conversation capability (§11) — a materially larger
  feature than a handoff record.
- Guest human handoff (§12) — explicitly excluded by the owner's brief.
- Any AI-simulated "human is typing" behavior — explicitly excluded.
- Omnichannel (WhatsApp/Telegram) handoff — explicitly excluded.

---

Related: [[project_cs_series_support_agent]] (CS1, the "CS2" reference this
discovery resolves), [[project_autonomous_support_system_rnd]] (P1/Phase A/
Phase B, the foundation this builds on), the email/communication
reconciliation doc (`AT24_EMAIL_COMMUNICATION_RECONCILIATION.md`, an
independent confirmation of §11's core finding).
