# AUTOMATION_DECISION_LOCK.md — the frozen 3-decision contract

**Purpose:** the single short contract implementation runs against. Once this
is signed, the Automation architecture is **not reopened** during the build —
any change needs a new dated ADR entry here.

**Supersedes the PENDING items in `AUTOMATION_DECISION.md §4–5`.**
**Owner direction received 2026-09-10 (algogtraders24@gmail.com):** PENDING-1
APPROVED, PENDING-2 APPROVED, PENDING-3 to be locked here before coding.

---

## DECISION 1 — Canonical domain model — ✅ LOCKED

**Execution authority = the Agent Framework. Automation is the user-facing
orchestration layer above it.**

```
Automation (definition, versioned)
   └── AutomationRun            ← the orchestration record (this sprint)
         └── AutomationStepRun  ← one per definition step
               └── AgentRun     ← the ONLY execution engine (Sprint AN, unchanged)
                     └── AgentStep / AgentToolCall / AgentEvidence / AgentCreditLedgerEntry
```

Locked consequences:

| # | Action | Status |
| --- | --- | --- |
| 1.1 | New models: `Automation` (v2), `AutomationDefinitionVersion`, `AutomationRun`, `AutomationStepRun`, `AutomationArtifact` + enums — per `AUTOMATION_DATA_MODEL.md`. | build |
| 1.2 | `AutomationRun` wraps `AgentRun`; automation code reaches agents **only** through `services/agent-framework/api/agent-run-service` (never `runtime/*`, `credits/*`, `tools/*`). | build |
| 1.3 | **Retire** the Sprint 14D `model Automation` (minimal `{id,userId,name,trigger,enabled}`) + `PrismaAutomationRepository` + `AutomationRepository`. Its route path `/api/private/automations` is reused by the v2 API. | migrate + delete |
| 1.4 | **Retire** the Sprint 14E execution model: `model Workflow` / `WorkflowRun` / `WorkflowQueueItem`, enums `WorkflowTrigger` / `WorkflowStatus` / `RunStatus`, `PrismaWorkflowRepository` / `WorkflowRepository`, `GET /api/private/workflows`, `services/api/WorkflowsApi.ts`, `services/api/workflowMetrics.ts`, `types/automation.ts` (rewritten). | migrate + delete |
| 1.5 | **Delete the fabricated executor** in `app/dashboard/automation/page.tsx` — the optimistic `onRun()` that pushes a fake `status:"success"` run, the client-side metric computation, and the `components/automation/*` internals (directory kept, contents rebuilt on the real API). | delete + rebuild |
| 1.6 | Migrate existing `workflows` rows → `automations` + a v1 `AutomationDefinitionVersion` (wrap `Workflow.steps` into a `definition`). Rows that don't map cleanly (no real steps) are migrated as `DRAFT` and flagged, never dropped silently. | data migration |
| 1.7 | Preserve every Agent Framework guarantee unchanged: authorization, credit ledger (A9), evidence/integrity, cancellation, resumability, bounded execution, observability. Automation adds **zero** new execution, credit, or evidence primitives. | invariant |
| 1.8 | Update `docs/AI-Automation-Architecture.md` to a pointer at this contract + `AUTOMATION_ARCHITECTURE.md` (it currently claims "Mock/in-memory only — no DB"). | doc |
| 1.9 | Migration is **written + reviewed, applied only at the Migration Gate** with explicit owner authorization (AN / K1 / K2 precedent), via `prisma migrate deploy` — never `prisma migrate dev` (pgvector reset trap). | process |

---

## DECISION 2 — Beta scheduler architecture — ✅ LOCKED

**Fixed daily-cron "slots". No arbitrary-time picker in Beta — the
infrastructure cannot honor one, and a picker that lies is worse than a
small honest set.**

### 2.1 Mechanism

- N fixed **daily** Vercel Cron entries in `frontend/vercel.json`, each a
  **distinct pathname** → `/api/private/automations/cron/dispatch/<slot-id>`
  (distinct paths, not `?query=`, because Vercel keys crons by path and
  `proxy.ts` matches `pathname` exactly).
- Each dispatch path is added to `CRON_SECRET_EXEMPT_PATHS` in
  `frontend/proxy.ts` (the Next 16 middleware session gate) on the existing
  terms — **valid `CRON_SECRET` bearer only**. *This step is mandatory and
  was missed twice in the Publishing series (P2.3-E, then PR #49); it is
  called out here so it is not missed a third time.*
- Handler auth = `isValidCronSecret(req)` (constant-time) **or**
  `requireAdmin(...)` — exact `admin/intelligence/ingest-news` precedent.
- `export const maxDuration = 60`. Behaviour = `AUTOMATION_ARCHITECTURE.md
  §4.3`: catch-up pass (resume stale `RUNNING`/`QUEUED` runs) → bounded batch
  of due automations (`LIMIT` default 25) → update `nextRunAt`/`lastRunAt`.
- Hobby reality (verified against `origin/main`): multiple **daily** cron
  paths are fine — `main` already ships 3 (`evaluate-outcomes`,
  `ingest-news`, `publishing/dispatch`). The hard limit is **frequency**:
  every cron path must be **≤ once per day**. A sub-daily `schedule` silently
  blocks all main deploys (prior outage, PR #34). **Every automation slot
  cron is `<minute> <hour> * * *` — never a `*/n` or multi-value field.**

### 2.2 Upgrade-safety (owner requirement: infra upgrade ≠ domain redesign)

The domain model is already upgrade-shaped. Post-Beta path
`Hobby preset slots → Vercel Pro minute-cron → arbitrary user time+tz`
touches only the scheduler edge:

| Layer | Beta | Post-Beta (Pro) | Changes? |
| --- | --- | --- | --- |
| `definition.trigger` JSON | `{ type, timezone, slot, daysOfWeek, runAt }` | add optional `timeOfDay:"HH:MM"`; `slot` becomes optional | **additive only** |
| `AutomationRun` / `AutomationStepRun` / idempotency key `(automationId, scheduledFor)` | as designed | identical | **none** |
| API contract (`AUTOMATION_API_CONTRACT.md`) | as designed | identical | **none** |
| `vercel.json` | N daily slot crons | one `* * * * *` dispatch cron | config swap |
| Scheduler service | `dueForSlot(slotId, now)` | `dueAt(now)` (compares `timeOfDay`+`timezone`) | **one function replaced** |
| `Automation.timezone` | stored, forced `Asia/Kolkata` for scheduled (see D3) | starts being honored per-automation | **behaviour flips on a stored field, no schema change** |

Blast radius of the eventual upgrade = `vercel.json` + one scheduler
function + lifting the D3 timezone constraint. Nothing in the data model,
run model, credit model, or API contract moves.

---

## DECISION 3 — Beta preset slots + timezone semantics — ✅ LOCKED (2026-09-10)

**Owner lock:** slot set **B (2 slots)**, timezone **IST for all Beta
`daily`/`weekly`/`once` automations**, `timezone` stored per automation as the
post-Beta upgrade seam, builder exposes only these two IST slots with an
approximate local-time hint for non-IST users, `weekly` day selection follows
the IST calendar day, no arbitrary-time picker in Beta.

### 3.1 Timezone semantics — LOCKED

1. Every `Automation` stores `timezone` (IANA), defaulted from the user's
   **account timezone** at creation, then **frozen on the definition
   version** (never re-inferred from runtime — sprint §5).
2. **Beta constraint:** for `daily` / `weekly` / `once` triggers,
   `timezone` is **forced to `Asia/Kolkata`** and the builder only offers
   IST slots. Rationale: India is AT24's home market; IST has no DST so a
   fixed UTC cron honors a fixed IST wall-clock time exactly; cross-timezone
   weekday-boundary math is out of Beta.
3. Non-IST accounts are **not blocked**. The builder labels every slot
   `HH:MM IST` and shows a client-computed secondary hint
   (`≈ HH:MM <your account tz>`). The automation genuinely runs on IST; the
   label never implies otherwise.
4. `weekly.daysOfWeek` are **IST days**. `once.runAt` is a **date**; the
   automation fires on the first slot pass on/after that date (IST), then
   auto-archives.
5. `manual` triggers are timezone-trivial (run on click).
6. Post-Beta, constraint (2) is lifted: `timezone` becomes authoritative and
   Pro minute-cron honors the user's real local time. No schema change.

### 3.2 Slot set — LOCKED: **B — 2 slots**

Two new daily cron paths (`main` goes 3 → 5 daily crons, all Hobby-legal —
each `<min> <hr> * * *`, once/day).

| Slot id | Label | IST wall-clock | Vercel cron (UTC = IST − 5:30) | Dispatch path |
| --- | --- | --- | --- | --- |
| `morning_ist` | Morning (pre-market) | 08:00 IST | `30 2 * * *` | `/api/private/automations/cron/dispatch/morning-ist` |
| `evening_ist` | Evening (post-close) | 18:30 IST | `0 13 * * *` | `/api/private/automations/cron/dispatch/evening-ist` |

(08:00 IST is before the 09:15 NSE open; 18:30 IST is after the 15:30 close.)

- The builder's trigger step offers exactly these two slots for
  `daily`/`weekly`/`once`, each labelled `08:00 IST` / `18:30 IST`.
- For a non-IST account the review screen adds a client-computed hint
  (e.g. `≈ 21:30 previous day, America/New_York`) — the run still executes on
  the IST instant.
- Slot ids, labels, cron expressions and dispatch paths live in one
  `config/automation-slots.ts` registry — the single source consumed by the
  builder, the scheduler, the `vercel.json` sanity check, and the `proxy.ts`
  exemption list.

### 3.3 D3 unblocks implementation

All three decisions are frozen. Implementation proceeds against
`AUTOMATION_DATA_MODEL.md` + `AUTOMATION_API_CONTRACT.md` +
`AUTOMATION_EXECUTION_CONTRACT.md` + `AUTOMATION_TEST_PLAN.md`, the D1
retirement/migration checklist, and the D2 scheduler mechanism. The Prisma
migration is written + reviewed during the build, applied only at an explicit
Migration Gate with owner authorization.

---

## Sign-off

| Decision | State | Owner | Date |
| --- | --- | --- | --- |
| D1 — canonical domain model | ✅ LOCKED | algogtraders24@gmail.com | 2026-09-10 |
| D2 — Beta scheduler architecture | ✅ LOCKED | algogtraders24@gmail.com | 2026-09-10 |
| D3 — slots + timezone semantics | ✅ LOCKED (B: 08:00 / 18:30 IST) | algogtraders24@gmail.com | 2026-09-10 |

**All three decisions LOCKED 2026-09-10. Implementation authorized against
this contract. Architecture is not reopened during the build — changes need a
new dated ADR entry here.**
