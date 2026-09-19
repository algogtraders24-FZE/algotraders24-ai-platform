# AT24 Support — Human Handoff Architecture Lock

Architecture/contract sprint only. No application code, schema migration,
API, UI, component, package, or configuration change is part of this
document. Every decision below is validated against real repository
evidence at the baseline confirmed in §2, not copied unverified from the
discovery document.

## 1. Purpose

Convert `SUPPORT_HUMAN_HANDOFF_DISCOVERY.md`'s six open questions into a
locked, implementation-ready contract: one canonical `SupportHandoff`
domain, its state machine, its human-reply model, its admin surface, its
security boundary, and the exact sequence a future implementation sprint
must follow — precise enough that that sprint cannot accidentally rebuild
Support Chat, the Conversation stack, or a second escalation engine.

**Terminology lock (owner clarification, post-discovery):**
`SupportHandoff` is not a lightweight, transient "handoff record" — it is
**AT24's first-ever internal Support Ticket / Case system**. Today, zero
such system exists anywhere in the codebase (§3, §18 re-confirm this
directly): escalation dead-ends at a static "Talk to a human" link with no
durable, admin-manageable object behind it (discovery §4, reconfirmed
unchanged at this lock's baseline, §2). This implementation, when
authorized, is not "adding a small convenience table" — it is standing up
AT24's own internal ticketing/case-management capability for the first
time, self-built, with no external provider (D15).

`SupportHandoff` is the **canonical backend entity name** for that ticket/
case record. User-facing product copy is free to say "Support Case" or
"Human Support" instead of the word "ticket" — that is a UX/naming choice,
not an architecture one, and is explicitly out of this sprint's scope
(§1's own forbidden-list: no UI implementation). The two are the same
thing at the data layer regardless of what a button says.

**The ticket/case system sits ON TOP of the existing conversation, it
does not replace or fork it:**

```
User Chat  <-- same Conversation (Phase B conversationId), unchanged -->  Human Support
                                    |
                                    v
                        SUPPORT TICKET / CASE (SupportHandoff)
                     a workflow layer referencing the conversation,
                          never a second copy of it (D6, D10)
```

This is not a new claim — it is exactly what D6 (references, not copies)
and D10 (`SupportHandoffMessage` anchored to the handoff, which is itself
anchored to `conversationId`, never a forked thread) already locked below.
This note makes that framing explicit rather than leaving a reader to
infer "ticket system" from "handoff domain" terminology.

**Explicit verification against the owner's six checklist items**
(re-confirmed at this lock's baseline, not merely asserted):
1. *Existing ticket/case system is zero* — confirmed in §3/§18: the
   repository-wide duplication check found no ticket/case/queue object
   anywhere outside Support's own `escalate` flag; the code's own comment
   (`support-agent.ts:22`) names this exact gap as unbuilt ("CS2").
2. *`SupportHandoff` is genuinely a new domain* — confirmed in D1/D8: no
   existing model (`Conversation`, `AgentRun`, `Feedback`, `AuditLog`) can
   safely represent it (§3, §5 of the discovery doc; reaffirmed in D8's
   own field-by-field justification).
3. *`Feedback` is a pattern only, never a ticket system* — confirmed in
   D8/D12: its UX/lifecycle SHAPE is copied, its table, its service, and
   its own domain (free-text user feedback) are never touched.
4. *This implementation creates a real Support Ticket MVP, not a token
   gesture* — confirmed in D12: the locked admin surface list (Queue,
   Case detail, Conversation view, Evidence/context view, Assignment,
   Status actions, Human reply, Audit history) is a complete
   ticket-management workflow, not a status flag with no interface.
5. *The same Support Chat conversation stays linked to the ticket* —
   confirmed in D6/D8/D10: `conversationId` is a required, immutable field
   on `SupportHandoff`; the conversation's own turn history
   (`agentRunRepository.listRunsForConversation`) is read live, never
   duplicated or forked into a second thread.
6. *Admin gets a complete ticket/case management workflow, not a partial
   one* — confirmed in D12/§13: creation, assignment, status lifecycle
   (D4), human reply (D10), and full audit history (D13) are all locked,
   not deferred.

## 2. Verified Baseline

```
origin/main (at lock time) = 3823bb9c... (PR #93, subscription lifecycle emails)
origin/main (discovery baseline) = ebe8c42
CS1  = 63d4eb1 — ANCESTOR, present
Phase A = ffb288d — ANCESTOR, present
Phase B = 80828cf — ANCESTOR, present
```

**DRIFT FOUND, reconciled:** `origin/main` moved one merge past the
discovery baseline (`ebe8c42` → `3823bb9`, PR #93). `git diff --name-only`
between the two shows exactly two files changed:
`app/api/webhooks/stripe/route.ts` and
`services/notifications/EmailService.ts` — both add subscription
activated/renewed/cancelled emails, unrelated to Support. This branch was
rebased cleanly onto the new tip. §16 below corrects one now-stale
discovery-doc claim (`EmailService.ts` had two exported functions at
discovery time; it now has four — still zero callers from Support). No
other file relevant to this domain (Support, Agent Framework, admin RBAC,
`AuditLog`, `Feedback`, `Conversation`/`Message`, `prisma/schema.prisma`)
changed between the two baselines — reverified directly with
`git diff --stat 3823bb9 HEAD -- <every relevant path>`, empty output.

## 3. Discovery Reconciliation

Independently re-verified, not copied, against the current tip:

| Claim | Still true? | Evidence |
|---|---|---|
| Escalation is decided in `support.specialist.ts:161`, deterministically | YES | `const escalate = !resolved \|\| mutationIntent;` unchanged |
| CS1.2 D1 forbids Support from touching `Conversation`/`Message` | YES | `services/agent-framework/agents/support-agent.ts:10-12` unchanged |
| No ticket/case/handoff model exists anywhere | YES | repository-wide grep unchanged; `support-agent.ts:22`'s own "CS2" comment still present |
| `Feedback` + `AdminFeedbackService.ts` is the queue/status precedent | YES | unchanged, `open→reviewed→resolved` |
| `AuditLog` is generic, admin-action-logged by convention | YES | `app/dashboard/admin/layout.tsx:19` unchanged |
| Admin RBAC (`requireAdmin`/`assertRole("admin")`) is the only admin gate | YES | `lib/auth/adminRoute.ts` unchanged |
| No human-reply mechanism exists anywhere | YES | reconfirmed, zero matches beyond Support's own read-only tools |
| No existing model can represent a cross-user-queryable handoff | YES | every `AgentRun`/conversation query remains userId-scoped by construction |

**Reconciliation result: DISCOVERY CONFIRMED, one citation corrected**
(§16 — `EmailService.ts` now has 4 exported functions, not 2; conclusion
unchanged).

## 4. Architecture Decision Register

### D1 — Handoff Cardinality

```
Decision: ONE ACTIVE HANDOFF PER CONVERSATION
Chosen option: at most one SupportHandoff row per conversationId with
  status in the non-terminal set {OPEN, ASSIGNED, IN_PROGRESS}. RESOLVED
  and CANCELLED are terminal and do not count against the invariant.
Repository evidence: Phase B's own conversationId is already the stable,
  userId-scoped anchor (agentRunRepository.listRunsForConversation);
  nothing about it prevents multiple AgentRuns per conversation from each
  independently escalating (confirmed in discovery §4 - "Multiple
  escalation signals per conversation? Yes, structurally possible today
  with zero deduplication").
Reason: a queue where the same conversation shows up three times because
  the user asked three unresolvable questions in a row would be confusing
  and would let an admin resolve one while two duplicates sit stale.
Rejected alternatives: (a) one handoff per escalated AgentRun, no
  dedup — rejected, creates the exact duplicate-queue-entry problem above;
  (b) one handoff per user (not per conversation) — rejected, no evidence
  a user only ever has one active issue at a time, and conversationId is
  the natural unit Phase B already established.
Impact: requires a uniqueness invariant enforced either as a partial
  unique index on (conversationId) WHERE status IN ('OPEN','ASSIGNED',
  'IN_PROGRESS') (DB-enforced, preferred) or a transactional check-then-
  create in the service layer if a partial index proves impractical with
  the Prisma version in use at implementation time — this specific
  mechanism choice is deferred to implementation (no code is written in
  this sprint), but the INVARIANT itself is locked now.

Exact uniqueness invariant:
  reopen (RESOLVED -> OPEN) transitions the SAME row back to active - it
  never creates a second row for the same issue.
  A genuinely new escalation while the conversation's most recent handoff
  is terminal (RESOLVED or CANCELLED) creates a NEW row - the invariant
  only blocks a second ACTIVE row, never a second row overall.
  The system does NOT attempt to infer "is this the same issue
  continuing" from a raw new escalation - that inference requires an
  explicit reopen action (D4), never an automatic one.
```

### D2 — Handoff Triggers

```
Decision: AUTOMATIC ESCALATION + EXPLICIT USER HUMAN REQUEST, one
  canonical domain
Chosen option: triggerSource: "AI_ESCALATION" | "USER_REQUEST" - both
  values are sufficient; validated against repository evidence.
Repository evidence: exactly two entry points exist or are being
  designed - the specialist's own deterministic escalate:true output
  (support.specialist.ts:161), and a not-yet-built "connect me to a
  human" user action that (per the user's own instruction) must still
  run through "the existing deterministic support pathway" first, i.e.
  it produces a real AgentRun too, just with a user-initiated reason
  instead of a specialist-derived one.
Reason: both funnel into the identical SupportHandoff creation function;
  triggerSource is a closed, small enum with no third value evidenced
  anywhere in the codebase (no admin-initiated-on-behalf-of-user flow, no
  automated system-health-triggered handoff).
Rejected alternatives: a third "SYSTEM" trigger value - rejected, no
  evidence of any non-AI, non-user actor that would ever create one in
  this MVP.
Impact: triggerSource is immutable once set (the circumstance that
  created the handoff never changes after the fact); reason (free text,
  copied verbatim from the run's own escalationReason, or a fixed
  "user-requested" constant for USER_REQUEST) is the detail field,
  triggerSource is the coarse category.
```

### D3 — AI Escalation Authority

```
Decision: existing deterministic Support escalation logic remains the
  SOLE authority on whether something needs a human.
Chosen option: SupportHandoff consumes support.specialist.ts's
  escalate/escalationReason output; it never reinterprets, re-scores, or
  overrides that decision.
Repository evidence: support.specialist.ts's synthesize() is
  deterministic, NO LLM (a framework-wide locked invariant shared by
  every specialist, confirmed during Phase A's own investigation of this
  exact file). Phase A's generation can only ever CLEAR a no-coverage
  escalation (never set one, never touch a mutation escalation) -
  generation is strictly downstream of, and subordinate to, the
  specialist's decision.
Reason: introducing a second place that decides "does this need a
  human" would create two escalation authorities that could disagree -
  exactly the fragmentation this lock exists to prevent.
Rejected alternatives: letting SupportHandoff itself apply any additional
  heuristic (e.g. "escalate after 2 low-confidence generations in a row")
  - rejected, no repository evidence for such a heuristic and it would
  make SupportHandoff a second escalation engine, explicitly forbidden by
  this sprint's own scope rules.
Impact: SupportHandoff's `reason` field is always a COPY of an
  already-computed value (support.specialist.ts's escalationReason, or
  the fixed USER_REQUEST marker) - never independently derived.
```

### D4 — Handoff Status Machine

```
Decision: OPEN, ASSIGNED, IN_PROGRESS, RESOLVED, CANCELLED - five
  persisted statuses, no persisted REOPENED state.
Chosen option: reopen is RESOLVED -> OPEN with a dedicated audit event
  (support_handoff.reopened), reusing the OPEN state rather than adding a
  sixth.
Repository evidence: no existing model in this codebase (AgentRunStatus,
  Feedback.status) has ever needed a "reopened-but-distinct-from-fresh"
  state - AgentRunStatus's own terminal set is flat, and Feedback's own
  status field has no reopen concept at all to draw a counter-example
  from.
Reason: a reopened case behaves identically to a freshly-opened one from
  every consumer's perspective (queue visibility, assignment eligibility)
  - the only difference worth preserving is the AUDIT TRAIL showing it
  was reopened, which AuditLog already covers without a new persisted
  status.
Rejected alternatives: a sixth REOPENED state - rejected, no distinct
  behavior evidenced for it beyond what an audit event already captures.
```

**Complete transition matrix** (the owner's proposed matrix, validated —
no additional transitions invented):

| From | To | Actor | Trigger | Audit Required |
|---|---|---|---|---|
| (none) | OPEN | System (on `escalate:true`) or User (explicit request) | AI_ESCALATION or USER_REQUEST | YES (`support_handoff.created`) |
| OPEN | ASSIGNED | Admin | Assignment | YES |
| ASSIGNED | IN_PROGRESS | Admin | Work starts | YES |
| IN_PROGRESS | RESOLVED | Admin | Resolution | YES |
| OPEN | CANCELLED | Admin | Cancellation | YES |
| ASSIGNED | CANCELLED | Admin | Cancellation | YES |
| IN_PROGRESS | CANCELLED | Admin | Cancellation | YES |
| RESOLVED | OPEN | Admin or User (own handoff only) | Reopen | YES |

**Explicit answers to the five "what happens when" questions:**

- **An OPEN case receives assignment** → transitions to `ASSIGNED`,
  `assignedAdminUserId` set to the acting admin's `User.id`.
- **An ASSIGNED case is worked** → transitions to `IN_PROGRESS` via an
  explicit admin action (not automatic on the first reply — an admin may
  claim a case before actively working it).
- **An IN_PROGRESS case is reassigned** → `status` does **not** change;
  only `assignedAdminUserId` updates. This is a distinct audit action
  (`support_handoff.reassigned`), not a status transition, since
  "in progress" remains true regardless of who owns it.
- **A RESOLVED case receives a new user message** → per D11, the normal
  Support pipeline resumes (a new `AgentRun`, unchanged). If that new run
  independently escalates, D1's invariant only blocks a second *active*
  handoff — since the existing one is terminal, a **new** `SupportHandoff`
  row is created rather than silently reopening the old one. Reopening
  the *same* case is always an explicit, separate action (D1), never an
  automatic inference from a new escalation.
- **A CANCELLED case receives a new user message** → identical to
  RESOLVED above (normal pipeline resumes, a fresh escalation creates a
  new row). Unlike RESOLVED, `CANCELLED` has **no** reopen path in the
  given transition matrix — respected as given, not invented.

### D5 — Assignment Model

```
Decision: NO NEW SUPPORT-SPECIFIC RBAC ROLE. Use existing Admin RBAC.
Chosen option: assignedAdminUserId: String? (nullable FK to User) is
  SUFFICIENT.
Repository evidence: User.role is a single-value String
  ("user"/"admin") checked by exactly one primitive (assertRole("admin"),
  lib/auth/protectedRoute.ts) everywhere in the codebase - zero evidence
  of teams, departments, shifts, SLA ownership, or availability tracking
  anywhere in 66 Prisma models or any service file.
Reason: any admin can already see and act on every row in every existing
  admin queue (Feedback, Users, Subscriptions) with no per-admin
  ownership restriction - there is no precedent anywhere to extend into a
  workforce-management concept.
Rejected alternatives: support workforce management / teams /
  departments / shifts / SLA ownership / agent availability / round-robin
  routing - all explicitly rejected per the owner's own instruction and
  confirmed absent from the repository; introducing any of them now would
  be pure speculation.
Impact: an OPEN handoff has assignedAdminUserId: null - explicitly no
  assignment is needed or expected for OPEN. Any admin (not just an
  "assigned" one) can view, reply to, or act on any handoff at any status
  - assignment is a work-tracking convenience field, not an
  authorization boundary (the authorization boundary is requireAdmin()
  alone, per D5's own decision and §18's security matrix).
```

### D6 — Human Context Model

```
Decision: LLM context stays exactly as Phase B built it (redacted
  account data); human support context is authorized, UNREDACTED,
  evidence-referenced account information; human access is gated by
  existing Admin RBAC alone; no unrestricted raw account dump.
Chosen option: the human-facing context is NOT a copy of conversation
  text. It is a small set of REFERENCES: conversationId (re-fetch the
  live turn history via the existing, unchanged
  agentRunRepository.listRunsForConversation), agentRunId (the specific
  escalating run, and via it every AgentStep/AgentToolCall/AgentEvidence
  already in its trace), evidenceIds (the specific KB/account evidence
  rows relevant to the escalation), reason, and triggerSource.
Repository evidence: agentRunRepository.listRunsForConversation and
  getRunTrace already exist and are userId-scoped for the OWNER's own
  read; an admin route reading the SAME data under requireAdmin() instead
  of userId-ownership is a new authorization path onto EXISTING data, not
  new data.
Reason: "no unrestricted raw account dump" is satisfied by referencing
  only the evidence rows the escalating run itself already retrieved
  (support.account_read's own real findings) - never a fresh, broader
  account query initiated by the handoff itself.
Rejected alternatives: a `contextSnapshot: Json` blob duplicating
  conversation text and evidence claims inline (the shape this
  discovery's own original proposal used). REJECTED on reconsideration:
  every piece of context Phase B/Phase A already produce is either a
  scalar (conversationId, agentRunId, reason, triggerSource) or a simple
  array (evidenceIds: String[], natively representable in Postgres/Prisma
  without a Json column). A Json blob would ALSO risk going stale relative
  to the live AgentEvidence rows it would have copied.
Impact: contextSnapshot is NOT part of the D8 field list (see D8) -
  every candidate piece of context is a typed column or a simple array
  instead.
```

### D7 — Provenance Model

```
Decision: reference, never duplicate.
Chosen option: SupportHandoff stores evidenceIds (String[]), agentRunId,
  reason, and triggerSource - NOT "relevant message IDs" (Support has no
  separate message table; the AgentRun itself IS Support's turn record)
  and NOT a separate "generated answer reference" (already reachable via
  agentRunId -> AgentRun.output.generatedAnswer, no redundant pointer
  needed).
Repository evidence: Phase A's own generate-answer.ts already established
  this exact reference-not-copy pattern (generatedEvidenceIds: string[]
  pointing at real AgentEvidence rows rather than duplicating their claim
  text a second time).
Reason: avoids two representations of the same fact drifting apart (an
  edited/retracted KB entry should never leave a stale copy inside a
  handoff), and keeps the new table minimal.
Rejected alternatives: copying full evidence claim text into the
  handoff row - rejected for the drift reason above.

Source-of-truth data: AgentRun (input/output/metadata), AgentStep,
  AgentToolCall, AgentEvidence - SupportHandoff never writes to or
  overrides any of these.
Snapshot data: none stored as a blob - evidenceIds is a point-in-time
  LIST of references (fixed at creation, not re-derived live as the
  conversation continues after handoff), everything else is a live
  reference re-fetchable through conversationId/agentRunId.
Audit data: AuditLog rows for every status transition, reassignment, and
  human reply (D13).
```

### D8 — SupportHandoff Data Model

Conceptual model only — no Prisma change in this sprint.

```
Field: id
Type: String (cuid)
Nullable: No
Purpose: primary key
Source: generated
Mutable?: No
Security considerations: none (standard opaque id, same non-sequential
  guarantee as every other cuid in this schema - no enumeration risk).

Field: userId
Type: String
Nullable: No (see D9 - guest handoff is out of scope; every SUPPORT run
  is already authenticated-only)
Purpose: ownership - the conversation owner, always the same as the
  originating AgentRun.userId
Source: server session (via the originating AgentRun), never a request
  body
Mutable?: No
Security considerations: THE ownership-scoping key for every user-facing
  read; must never be settable/overridable by client input, matching the
  locked convention "userId is ALWAYS supplied by the caller from the
  server session" (agent-run-service.ts's own header comment).

Field: conversationId
Type: String
Nullable: No
Purpose: anchors the handoff to Phase B's conversation identity, so the
  live turn history stays queryable without duplicating it
Source: AgentRun.metadata.conversation.id (Phase B)
Mutable?: No
Security considerations: combined with userId, this is what
  agentRunRepository.listRunsForConversation's existing ownership
  scoping already protects - reusing it introduces no new leakage path.

Field: agentRunId
Type: String (FK -> AgentRun.id, onDelete: Cascade)
Nullable: No (see D9)
Purpose: the specific escalating run - the direct evidence trail
Source: the run whose synthesize() set escalate:true, or (for
  USER_REQUEST) the run the user was viewing when they requested a human
Mutable?: No
Security considerations: cascade delete matches every other AgentRun-
  child relation in this schema (AgentStep/AgentToolCall/AgentEvidence) -
  a deleted run's subtree, including its handoff, is atomic.

Field: status
Type: (see decision below - real Postgres enum)
Nullable: No, default OPEN
Purpose: the lifecycle state (D4)
Source: server-computed via the transition matrix, never client-supplied
Mutable?: Yes (the only frequently-mutated field besides
  assignedAdminUserId/resolvedAt)
Security considerations: every transition must go through requireAdmin()
  (except User's own Reopen, D4/§18) - never a raw client PATCH of the
  field.

Field: triggerSource
Type: enum ("AI_ESCALATION" | "USER_REQUEST")
Nullable: No
Purpose: coarse categorization of what created the handoff (D2)
Source: the calling code path (specialist output vs. explicit user action)
Mutable?: No
Security considerations: none beyond standard write-once-at-creation
  discipline.

Field: assignedAdminUserId
Type: String? (nullable FK -> User.id)
Nullable: Yes (null for OPEN, per D5)
Purpose: work-tracking convenience, NOT an authorization boundary (D5)
Source: an admin's own action (requireAdmin()-gated)
Mutable?: Yes (reassignment)
Security considerations: must only ever be set to a real admin's User.id,
  verified server-side against the CURRENT acting admin (or an admin they
  explicitly assign to, if cross-admin assignment is ever built) - never
  client-supplied without a fresh requireAdmin() check.

Field: reason
Type: String
Nullable: No
Purpose: the specific escalation/request reason (D3, D7)
Source: copied verbatim from AgentRun.output.escalationReason, or a fixed
  "user-requested" constant
Mutable?: No
Security considerations: never re-derived from raw question text -
  always the specialist's own already-computed value, matching the exact
  discipline MUTATION_ESCALATION_REASON already established in Phase A.

Field: evidenceIds
Type: String[]
Nullable: No (may be an empty array if a USER_REQUEST handoff has no
  prior retrieval to reference)
Purpose: point-in-time reference set into AgentEvidence (D6, D7)
Source: the escalating run's own already-persisted evidence rows
  (support-kb: and account: prefixed sources)
Mutable?: No
Security considerations: server-computed only from the run's OWN
  evidence trail - never client-supplied, never a broader account query.

Field: createdAt
Type: DateTime (default now())
Nullable: No
Purpose: standard
Source: generated
Mutable?: No

Field: updatedAt
Type: DateTime (@updatedAt)
Nullable: No
Purpose: standard, tracks any mutable-field change
Source: generated
Mutable?: implicitly yes (automatic)

Field: resolvedAt
Type: DateTime?
Nullable: Yes
Purpose: when RESOLVED was reached; explicitly cleared back to null on a
  RESOLVED -> OPEN reopen (distinct from updatedAt, which changes on
  every transition regardless)
Source: set at the RESOLVED transition
Mutable?: Yes
```

**Fields deliberately NOT included, with justification:**
- `contextSnapshot: Json` — rejected in D6 (every candidate is already a
  typed column or array above).
- `cancelledAt: DateTime?` — not included. `CANCELLED` is a dead-end with
  no further mutations in the given transition matrix, so `updatedAt` at
  the moment of cancellation already equals what a dedicated
  `cancelledAt` would record. Revisit only if a future transition ever
  mutates a cancelled row again.
- `messageIds` / a "relevant message IDs" field — rejected in D7 (Support
  has no separate message table; `agentRunId` already reaches everything).

**Status field representation — locked decision:**
```
Decision: real Postgres enum (SupportHandoffStatus), matching
  AgentRunStatus's own convention, not Feedback.status's plain-String
  convention.
Repository evidence: both conventions exist for the same kind of field
  in this exact schema - AgentRunStatus (a real enum) and Feedback.status
  (a validated String).
Reason: SupportHandoff FKs directly into AgentRun and sits inside the
  broader Agent-Framework-adjacent domain (AN1.2's own enum discipline),
  whereas Feedback's String convention predates that discipline (Sprint
  R1.2, before AN1.2). Internal consistency with its closest
  architectural neighbor outweighs matching the older, unrelated
  Feedback pattern.
Alternatives considered: a plain validated String (Feedback's own
  pattern). Rejected for the consistency reason above, not because it is
  technically wrong - this is a close call between two equally valid
  existing precedents, resolved in favor of the more architecturally
  adjacent one.
```

### D9 — Guest Handoff

```
Decision: guest handoff is OUT OF SCOPE. userId and agentRunId are BOTH
  NOT NULL in the MVP schema - userId nullability is explicitly NOT
  loosened now.
Repository evidence: the guest Support path
  (services/support/guest-knowledge-query.ts) never creates an AgentRun
  at all (P1 D11, confirmed unchanged at the current baseline). A guest
  handoff cannot be represented in this schema regardless of userId's
  nullability, because agentRunId - the FK a handoff fundamentally
  depends on - has nothing to point at for a guest.
Reason: making userId nullable now would be a no-op change that enables
  nothing (the real blocker is the missing AgentRun, not the userId
  column) while adding real complexity to every future query that reads
  SupportHandoff.userId (every such query would need to branch on null-
  handling for a case that cannot occur in the authenticated-only MVP).
Rejected alternatives: pre-emptively making userId nullable "to be safe"
  for a future guest handoff. REJECTED - guest handoff, when/if
  authorized, will need its own schema consideration anyway (there is no
  AgentRun to FK to at all, a strictly larger design question than one
  column's nullability), so loosening it now buys nothing.
```

### D10 — Human Reply Model

```
Decision: existing Conversation/Message infrastructure CANNOT safely
  support a human-authored Support reply. A new, minimal,
  Support-Handoff-scoped model is the required minimum extension.
Repository evidence: CS1.2 D1 is a locked invariant forbidding Support
  from touching the Conversation/Message stack at all - even a schema-
  level addition (e.g. a new Message.role value) would put a human-
  support reply inside the MAIN AI ASSISTANT's own data model, mixing two
  unrelated products, a direct invariant violation, not merely an
  awkward reuse.
Reason: AgentRun is also the wrong host - a human reply has no plan, no
  tool calls, no credits, no LLM step; forcing it into AgentRun's shape
  would misuse a table designed entirely around AGENT EXECUTION.
Rejected alternatives: (a) extend Message with a new author role -
  rejected, CS1.2 D1 violation; (b) extend AgentRun/AgentStep to carry a
  human-authored step - rejected, AgentStep's own kind enum and the
  runtime's execution model have no concept of a step with no plan/tool/
  credit involved, and stretching it would blur the "durable EXECUTION
  ledger" meaning of that table for every other consumer.

Minimum required NEW extension (conceptual only, not built this sprint):
  a small model scoped ONLY to a SupportHandoff - conceptually
  SupportHandoffMessage - with:
    handoffId (FK -> SupportHandoff, cascade delete)
    authorType: "USER" | "ADMIN" | "SYSTEM"
    authorUserId (the real User.id of whoever wrote it - the end user or
      the acting admin; null/omitted for a SYSTEM-authored message, if
      that ever exists - no evidence for one yet)
    content: String
    createdAt

Author type / identity / origin / visibility:
  author type: USER | ADMIN | SYSTEM (SYSTEM reserved for a future
    automated notice, e.g. "this case was reassigned" - no evidence it is
    needed for MVP; not built now, listed only for completeness of the
    closed enum).
  human/admin identity: authorUserId, verified via requireAdmin() at
    write time for ADMIN messages.
  message origin: always tied to exactly one SupportHandoff (never a
    conversationId directly) - a message cannot exist without an active
    or historical handoff to belong to.
  visibility: every message on a handoff is visible to the handoff's
    owning user AND any admin (requireAdmin()) - no internal-only/admin-
    private note concept is proposed (no evidence requested or found for
    one; would be pure speculation to add it now).

Continuity with the existing conversation: SupportHandoffMessage rows are
  NOT stored as AgentRun rows and are NOT retroactively merged into
  Phase B's conversationId-tagged AgentRun history at the data layer -
  they are a genuinely separate, smaller table. Continuity at the
  PRODUCT level (the user perceiving one continuous thread) is a future
  UI concern (interleaving AgentRun turns and SupportHandoffMessage rows
  by createdAt when rendering) - explicitly not solved by unifying the
  underlying storage, which would require the CS1.2 D1 violation this
  decision exists to avoid.
```

### D11 — AI Behavior After Handoff

```
Decision: OPTION A - AI stops generating user-facing answers once a
  handoff exists in a non-terminal state (OPEN, ASSIGNED, IN_PROGRESS).
Chosen option: while an active handoff exists for a conversation, a new
  user message is stored as a SupportHandoffMessage(authorType: USER),
  NOT routed through a new AgentRun / Phase A generation cycle. Once the
  handoff reaches a terminal state (RESOLVED or CANCELLED), the normal,
  completely unchanged Support pipeline resumes for any subsequent
  message (a new AgentRun, as today).
Repository evidence: the owner's own earlier, adjacent instruction
  ("no AI-generated fake 'human is typing' behaviour," from the original
  Phase D scope brief) signals AI should genuinely step back once a human
  is engaged, not keep simulating helpfulness. Phase A's own architecture
  already treats generation as a bounded FALLBACK, never a persistent
  conversational partner - Option A is the natural extension of that
  design, not a new philosophy.
Reason: letting the deterministic/generative pipeline keep answering in
  parallel with an active human case risks two authorities giving
  contradictory answers to the same user (a real support-safety concern,
  directly analogous to D3's "one escalation authority" reasoning).
Rejected alternatives:
  Option B (AI remains active while human works) - REJECTED: creates
    exactly the contradictory-answer risk above, and produces confusing
    UI states (is this an AI answer or the human's?).
  Option C (AI may draft internally, never sent directly) - REJECTED for
    THIS sprint: a genuinely new capability (an internal-draft surface
    for admins) with zero repository evidence or requested scope for it;
    would be speculative. Noted as a plausible FUTURE extension, not
    ruled out permanently, just not part of this lock.

Per-state effect on a new user message:
  OPEN / ASSIGNED / IN_PROGRESS: becomes a SupportHandoffMessage
    (authorType: USER); no new AgentRun, no generation attempt.
  RESOLVED: normal Support pipeline resumes (new AgentRun). If that new
    run also escalates, D1's invariant creates a NEW handoff (RESOLVED is
    terminal, does not block a new active row) rather than silently
    reopening the old one.
  CANCELLED: identical to RESOLVED - normal pipeline resumes; CANCELLED
    itself has no reopen path (D4), consistent with the given matrix.
```

### D12 — Admin Queue

```
Decision: YES - an admin handoff queue is part of the locked MVP domain
  (though building the UI is a later step in the sequence, §20 - this
  decision locks the SURFACE LIST, not the visual design, per the
  owner's own instruction).
Reuse: admin shell (app/dashboard/admin/layout.tsx, AdminNavTabs.tsx),
  admin RBAC (requireAdmin()), the Feedback admin page's UX/lifecycle
  PATTERN (list + status transition + timestamps).
Explicitly NOT reused: the Feedback TABLE or FeedbackService/
  AdminFeedbackService domain logic - a new, parallel
  AdminSupportHandoffService is the correct analog, following the SAME
  shape (list()/updateStatus()-equivalent) without touching Feedback's
  own code or data.

Minimum admin surfaces (purpose + data source, no visual design):
  Queue: list of SupportHandoff rows across ALL users, filterable by
    status - reads the new table directly (cross-user, requireAdmin()-
    gated, the exact capability no existing AgentRun query provides).
  Case detail: one SupportHandoff row's full state (status, reason,
    triggerSource, assignedAdminUserId, timestamps).
  Conversation view: the live turn history via
    agentRunRepository.listRunsForConversation(conversationId) - re-
    fetched live, never duplicated (D6).
  Evidence/context view: the referenced AgentEvidence rows
    (evidenceIds) plus the escalating AgentRun's own trace
    (getRunTrace(agentRunId)).
  Assignment action: sets/changes assignedAdminUserId (D5).
  Status actions: the transitions in D4's matrix, each requireAdmin()-
    gated (except the User's own Reopen, §18).
  Human reply: writes a SupportHandoffMessage(authorType: ADMIN) (D10).
  Audit history: AuditLog rows filtered by targetType:"SupportHandoff",
    targetId: the handoff id (D13).
```

### D13 — Audit

```
Decision: reuse AuditLog exclusively - no second audit mechanism.
Defined audit actions:
  support_handoff.created         (AI_ESCALATION or USER_REQUEST)
  support_handoff.assigned
  support_handoff.reassigned
  support_handoff.status_changed  (covers ASSIGNED->IN_PROGRESS,
                                    IN_PROGRESS->RESOLVED, any->CANCELLED;
                                    metadata: {from, to})
  support_handoff.reopened        (RESOLVED->OPEN - given its own action
                                    name rather than folding into
                                    status_changed, since it is the
                                    semantically distinct, rarer event an
                                    admin would want to filter for)
  support_handoff.human_reply_added

Actor identity, resolved against AuditLog.actorUserId's real constraint
  (a required, non-nullable String - no schema change, so no "system"
  marker value can be invented):
  created (AI_ESCALATION): the CONVERSATION OWNER's userId (it is,
    mechanically, their own AgentRun's deterministic output that created
    it - there is no separate "system" actor identity anywhere in this
    schema to attribute it to instead).
  created (USER_REQUEST): the requesting user's own userId.
  assigned / reassigned / status_changed (admin-initiated) / human_reply_
    added (as ADMIN): the acting admin's userId, verified via
    requireAdmin() at write time.
  reopened (by the user, per §18): the user's own userId.
  reopened (by an admin): the admin's userId.

Immutability: AuditLog rows are already append-only by construction
  (no update/delete path exists anywhere in the codebase for this table) -
  no change needed to preserve immutability.
```

### D14 — Notifications

```
Decision: no external notification/email/realtime infrastructure in this
  contract.
Repository evidence: the owner's own instruction; separately,
  EmailService.ts's only real callers remain purchase confirmation,
  license-issuance-failure, and (as of the reconciled baseline,
  §2/§16) subscription active/cancelled - none Support-related.
Reason: the admin queue itself (D12), manually checked by an admin, is a
  complete MVP loop with no push notification required - exactly how
  Feedback's own admin review works today (confirmed: no notification
  fires when new feedback arrives either).
Future extension point, not proposed now: sendLicenseIssuanceFailureAlert's
  "alert the team, not the end user" pattern is a directly reusable
  template if/when "notify staff of a new OPEN handoff" is separately
  authorized - no new provider needed even then.
```

### D15 — External Ticketing

```
Decision: OUT OF SCOPE, locked. No Zendesk/Intercom/Freshdesk/etc.
Repository evidence: zero existing integration of any kind.
Future integration boundary, not proposed now: an additive, nullable
  externalTicketId: String? column on SupportHandoff would let a future
  sync job map to an external system without touching the conversation/
  evidence model underneath it - noted because it is evidenced as easy
  later (the model is already clean), not because it is needed now.
```

## 5. Canonical Handoff Domain

**`SupportHandoff` is AT24's internal Support Ticket / Case record** —
the backend canonical name; product UX may call it "Support Case" (§1's
terminology lock). One new table, `SupportHandoff` (D8), one new small
table, `SupportHandoffMessage` (D10) — nothing else. Both are entirely
owned by the Support system; neither touches `Conversation`/`Message`,
`AgentRun`'s own shape (beyond a new inbound FK), or `Feedback`. The
ticket/case record is a workflow layer that REFERENCES the existing
conversation (`conversationId`, D6) — it is never a second copy of it and
never forks a new thread (D10).

## 6. State Machine

See D4 in full, including the complete transition matrix and the five
"what happens when" answers.

## 7. Trigger Model

See D2 — `AI_ESCALATION` and `USER_REQUEST`, one canonical creation path,
no third trigger type.

## 8. Assignment Model

See D5 — existing Admin RBAC only, `assignedAdminUserId` nullable, no
new role, no workforce-management concepts.

## 9. Human Context Model

See D6 — references only (`conversationId`, `agentRunId`, `evidenceIds`,
`reason`, `triggerSource`), no `contextSnapshot` Json blob, no raw account
dump beyond what the escalating run already retrieved.

## 10. Provenance Model

See D7 — reference `AgentEvidence` by ID; source-of-truth vs. reference
vs. audit data explicitly separated.

## 11. Human Reply Model

See D10 — a new, minimal, handoff-scoped `SupportHandoffMessage` model;
`Conversation`/`Message` and `AgentRun` both confirmed unsuitable, with
evidence for each.

## 12. AI Post-Handoff Behavior

See D11 — Option A locked (AI stops generating user-facing answers while
a handoff is active); exact per-state behavior specified for all five
statuses.

## 13. Admin Queue Contract

See D12 — eight minimum surfaces, each with its data source; Feedback's
UX pattern reused, its table and domain left untouched.

## 14. Audit Contract

See D13 — six named `AuditLog` actions, actor-identity resolution for
every case (including the AI_ESCALATION creation case, where no "system"
actor concept exists in the schema).

## 15. Security Contract

**Security matrix** (`?` cells resolved against verified repository
authorization patterns — `getUserOrNull`+ownership scoping for User,
`requireAdmin()`/`assertRole("admin")` for Admin):

| Operation | User | Admin | Other User |
|---|---|---|---|
| Create own handoff | YES (AI_ESCALATION on their own run, or USER_REQUEST) | N/A — no evidence for admin-initiated-on-behalf-of-user | NO |
| View own handoff | YES | YES | NO |
| View another user's handoff | NO | YES | NO |
| Assign | NO | YES | NO |
| Reply as human | NO | YES | NO |
| Resolve | NO | YES | NO |
| Reopen | YES (own handoff only) | YES | NO |

`Resolve: User = NO` — resolution is an admin's confirmation that a human
addressed the issue, semantically distinct from the user's own
"cancel my request," which is not offered to the user either (D4's given
transition matrix lists only "Admin" as the actor for every `→CANCELLED`
transition — respected as given, not expanded). `Reopen: User = YES` for
their own handoff — D4's matrix lists the actor as "Admin/system-defined
actor," read as inclusive of a user-triggered reopen (distinct from the
`CANCELLED` rows, which name only "Admin").

**Threat-model checks, verified against existing patterns already proven
in Phase A/B:**
- **IDOR:** every user-facing read/write must be `userId`-scoped
  (matching `agentRunRepository.getRunForUser`'s own pattern) — a
  `SupportHandoff.id` alone is never sufficient for a user route.
- **Cross-user leakage:** the exact concern Phase B's own regression suite
  already tests for `AgentRun`s (`listRunsForConversation` scoped by
  `userId`); the same discipline must extend to any new
  `SupportHandoff`/`SupportHandoffMessage` read.
- **Cross-account leakage:** N/A beyond user-level (this schema has no
  multi-user "account/org" concept above `User` itself).
- **Unauthorized assignment / reply / resolution:** all gated by
  `requireAdmin()`, the same single, already-proven gate every other
  admin-mutating route in this codebase uses — no new authorization
  primitive is introduced or needed.
- **Conversation enumeration:** `SupportHandoff.id` is a `cuid` (non-
  sequential, non-guessable), the same protection class as every other id
  in this schema.

## 16. Guest Boundary

Locked in D9: guest handoff is out of scope; `userId`/`agentRunId` stay
`NOT NULL`; loosening nullability now would enable nothing, since the
guest path has no `AgentRun` to anchor a handoff to regardless.

## 17. Notification Boundary

Locked in D14: none in this contract; `EmailService.ts`'s existing
"alert the team" pattern (now three purchase/subscription/license
functions plus one team alert, per the reconciled baseline, §2) is a
ready-made future extension point, not wired to Support in this phase.

## 18. External Ticketing Boundary

Locked in D15: out of scope; a future `externalTicketId` column is the
clean, evidenced extension seam, not proposed now.

## 19. Existing / Reuse / New / Out-of-Scope Matrix

### EXISTING — PRESERVE
- CS1/A1–A15 Agent Framework runtime, Supervisor, specialist pattern,
  tool registry, credit ledger, evaluation service — unchanged.
- Phase A generative fallback and its provider chain / compliance gate —
  unchanged.
- Phase B conversation continuity (`conversationId` tagging,
  `listRunsForConversation`, bounded-window trimming) — unchanged.
- The guest Support path — unchanged, untouched.
- `lib/auth/adminRoute.ts` / `app/dashboard/admin/*` admin shell and RBAC
  — unchanged.
- `AuditLog` — unchanged, reused as-is.
- `Feedback` / `AdminFeedbackService.ts` — unchanged; its PATTERN is
  copied, its table and code are not touched.
- `Conversation`/`Message` (main AI Assistant) — unchanged, untouched,
  never referenced by anything in this domain.

### REUSE
- `agentRunRepository`-style single-repository-per-domain convention —
  a new `supportHandoffRepository` would follow the identical shape.
- `requireAdmin()` for every admin-facing handoff route.
- `AgentEvidence` row IDs, referenced never copied.
- `AuditLog` for every status/assignment/reply event (D13).
- The admin shell/nav (`AdminNavTabs.tsx`) — one new entry when a UI is
  built.
- The `Feedback` admin page's UX/lifecycle shape as a structural template
  only.

### NEW (confirmed missing by both discovery and this lock)
- `SupportHandoff` table (D8).
- `SupportHandoffMessage` table (D10).
- The trigger hook creating a handoff on `escalate:true` or on an explicit
  user request (D2), analogous in shape to Phase A's own
  `advanceAgentRun()` integration point.
- A human-facing (unredacted-for-account-data) read path over existing
  `AgentEvidence`/`AgentRun` data (D6) — no new data, a new authorized
  read.
- A user-visible "handed to support" state in the widget/page (D11) — a
  status label and, while active, a message box wired to
  `SupportHandoffMessage` instead of a new `AgentRun`.
- The admin queue/case-detail/reply/audit-history surfaces (D12).

### OUT OF SCOPE
- External ticket providers (D15).
- Email/realtime notifications for new handoffs (D14).
- Multi-human assignment / workforce management (D5).
- AI-drafts-for-human-review capability (D11, Option C rejected for now).
- Guest human handoff (D9).
- Any AI-simulated "human is typing" behavior.
- Omnichannel (WhatsApp/Telegram) handoff.
- SLA management of any kind.

## 20. Implementation Sequence

Adopted as given — evidence does not argue for a different order:

```
1. Data model         (SupportHandoff, SupportHandoffMessage - depends on
                        nothing; must exist before anything below)
2. Service/domain logic (supportHandoffRepository + trigger hook - depends
                        on 1)
3. API/authentication  (user + admin routes, requireAdmin() wiring -
                        depends on 2)
4. Human-message pathway (SupportHandoffMessage write/read paths,
                        AI-halt behavior D11 - depends on 1, 3)
5. Admin queue          (list view - depends on 3)
6. Admin case detail    (single-handoff view, conversation/evidence
                        reads - depends on 3, 4)
7. Lifecycle actions    (status transitions, assignment - depends on 3, 6)
8. Audit                (AuditLog wiring for every action in 2-7 - can be
                        built alongside 2-7, but verified as its own
                        explicit step before 9)
9. End-to-end tests     (depends on everything above existing)
10. Production migration/verification (depends on 9 passing; follows this
                        program's own established closure-verification
                        discipline - fresh worktree, full regression,
                        real build)
```

## 21. Test Contract

**Handoff creation**
- Automatic escalation (`escalate:true`, non-mutation or mutation alike)
  creates exactly one active `SupportHandoff`.
- An explicit user human-request creates exactly one active
  `SupportHandoff`.
- A second escalation in the same conversation while one handoff is
  already active does NOT create a second active row (D1's invariant).
- A second escalation after the existing handoff reached `RESOLVED`/
  `CANCELLED` DOES create a new row (D1/D4).

**Isolation**
- User A cannot read or act on User B's handoff (any route).
- An admin can read/act on any handoff regardless of owner.
- A non-admin request to any admin-only route (queue, assign, reply,
  resolve) is rejected.

**Lifecycle**
- Every transition in D4's matrix succeeds for the correct actor.
- Every transition attempted by the wrong actor (e.g. a non-owning user
  trying to Reopen) fails.
- Every transition not in D4's matrix (e.g. `OPEN → RESOLVED` directly,
  skipping `ASSIGNED`/`IN_PROGRESS`) — `UNKNOWN — REQUIRES DECISION`: the
  given matrix does not explicitly forbid or allow skipping intermediate
  states; this lock does not invent an answer either way and flags it for
  the implementation sprint to resolve with the owner before coding the
  transition guard.
- A `RESOLVED → OPEN` reopen always clears `resolvedAt` back to `null`
  and produces a `support_handoff.reopened` audit event.

**Conversation**
- A human reply (`SupportHandoffMessage`, `authorType: ADMIN`) is
  associated with the correct `handoffId` and visible to the owning user.
- While a handoff is active, a new user message never creates a new
  `AgentRun` or triggers Phase A generation (D11).
- Once `RESOLVED`/`CANCELLED`, a new user message DOES create a normal
  `AgentRun` through the completely unchanged existing pipeline.
- No `SupportHandoffMessage` row is ever written into `Conversation`/
  `Message` or `AgentRun`/`AgentStep` — confirmed structurally (a
  regression test analogous to Phase A's own "never imports
  services/knowledge-loop" structural check).

**Evidence**
- `SupportHandoff.evidenceIds` references only real `AgentEvidence` rows
  belonging to the same `agentRunId`.
- No fabricated evidence — every referenced id must resolve to a real row.
- No unauthorized account-context leakage: `evidenceIds` never includes
  an `account:`-sourced row unless that evidence genuinely belongs to the
  handoff's own owning user's own escalating run (i.e. never cross-user,
  and never invented).

**Guest**
- Guest generative fallback remains disabled (Phase A's `GA-D10`,
  unaffected by this domain).
- No guest can create a `SupportHandoff` (no `AgentRun` to anchor to,
  D9) — attempting the flow through the guest route must fail closed,
  not silently succeed with a null-owner row.

## 22. Final Acceptance Criteria

- All six of the discovery document's open questions are resolved: D1
  (cardinality), D2 (trigger), D5 (assignment), D6/D8 (context/field
  representation), D8 (status enum-vs-string), D9 (guest nullability) —
  every one locked above with evidence, reason, and rejected alternatives.
- No duplicate support system introduced — `Conversation`/`Message`,
  `AgentRun`, `Feedback`, `AuditLog` all remain exactly what they are
  today; `SupportHandoff`/`SupportHandoffMessage` are additive and
  narrowly scoped.
- Existing Support Chat, Phase A, Phase B, CS1, `AgentRun`, the
  Conversation stack, Admin RBAC, and `AuditLog` all remain canonical and
  untouched by this document (verified: zero code/schema diff, §23).
- Lifecycle, human-reply model, post-handoff AI behavior, guest boundary,
  and external-ticketing boundary are all explicit, not deferred.
- Implementation sequence and test contract are both explicit.
- One item is honestly left `UNKNOWN — REQUIRES DECISION` (§21's
  skip-intermediate-state question) rather than invented, per this
  sprint's own decision-quality bar.
- **Terminology locked (§1):** `SupportHandoff` is explicitly AT24's
  first internal Support Ticket/Case system, not a lightweight handoff
  record — confirmed against all six of the owner's post-discovery
  verification points (zero existing ticket/case system, genuinely new
  domain, `Feedback` as pattern-only, a real ticket-management MVP
  workflow for admins, the same conversation staying linked rather than
  forked, and a complete — not partial — admin workflow).

---

Related: [[project_cs_series_support_agent]] (CS1, the "CS2" reference
this domain finally answers), [[project_autonomous_support_system_rnd]]
(P1/Phase A/Phase B, the foundation this builds on),
`SUPPORT_HUMAN_HANDOFF_DISCOVERY.md` (the source discovery this lock
formalizes and, in one place — D6's `contextSnapshot` — knowingly
revises).
