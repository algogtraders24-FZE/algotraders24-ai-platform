# AUTOMATION_DATA_MODEL.md — AT24 Automation

**Status:** PROPOSED — the exact Prisma shapes below LOCK with
`AUTOMATION_DECISION.md` PENDING-1 (which decides whether we migrate the 14E
`workflows` table or add fresh tables).

**Reused verbatim (no change):** `AgentRun`, `AgentStep`, `AgentToolCall`,
`AgentEvidence`, `AgentCreditLedgerEntry`, `AgentRunTrigger` (incl. its
existing `schedule` value), `Article`, `ArticleStatus`, `User`, `Plan`,
`Subscription`, `PLAN_LIMITS`.

**Retired / superseded (pending PENDING-1):** `model Automation` (14D),
`model Workflow` / `WorkflowRun` / `WorkflowQueueItem` (14E) and enums
`WorkflowTrigger` / `WorkflowStatus` / `RunStatus`.

---

## 1. Design rules

1. Follow the agent-framework table conventions exactly: `cuid()` ids, bare
   indexed `userId` strings (no FK to `User` — matches every AN table),
   `createdAt`/`updatedAt`, `deletedAt` only where a soft-delete path is
   real.
2. Immutable history: `AutomationDefinitionVersion`, `AutomationStepRun`,
   `AutomationArtifact` have **no `updatedAt`, no `deletedAt`, no update
   path**.
3. `AutomationRun` is mutable only for its status + terminal fields, and
   never after it is terminal (same rule as `AgentRun`).
4. No JSON blob is a substitute for a queryable column: `status`,
   `scheduledFor`, `nextRunAt`, `automationId` are real columns/indexes; the
   step list and trigger config live in versioned JSON because they are
   read as a whole and versioned as a whole.
5. Credits are **never** stored here as a source of truth — `creditsUsed` is
   a denormalised copy of `Σ AgentCreditLedgerEntry`, written when a
   run/step reaches terminal, for display without a join.

---

## 2. Enums

```prisma
enum AutomationStatus {
  DRAFT
  ACTIVE
  PAUSED
  ARCHIVED
}

enum AutomationTriggerType {
  manual
  once
  daily
  weekly
}

enum AutomationRunStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  CONDITION_HALTED
  CANCELLED
  CREDIT_BLOCKED
}

enum AutomationRunTrigger {
  manual
  schedule
}

enum AutomationStepKind {
  agent_run
  condition
  publication_draft
  workspace_save
}

enum AutomationStepRunStatus {
  PENDING
  RUNNING
  OK
  FAILED
  SKIPPED
}

enum AutomationArtifactKind {
  agent_result
  research_document
  market_intelligence
  publication_draft_ref
}
```

---

## 3. Models

### 3.1 `Automation` (definition head)

```prisma
model Automation {
  id              String            @id @default(cuid())
  userId          String
  name            String
  description     String            @default("")
  status          AutomationStatus  @default(DRAFT)

  // The frozen, explicit timezone for this automation's schedule (IANA).
  // Defaulted from the user's account tz at creation, then never inferred
  // from runtime again (sprint §5).
  timezone        String            @default("Asia/Kolkata")

  // FK to the version that ACTIVE scheduling + new manual runs use.
  activeVersionId String?
  activeVersion   AutomationDefinitionVersion? @relation("ActiveVersion", fields: [activeVersionId], references: [id])

  templateId      String?           // non-null if created from a template (sprint §17/§18)

  nextRunAt       DateTime?         // computed by the scheduler; null when not ACTIVE or manual-only
  lastRunAt       DateTime?

  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  deletedAt       DateTime?         // reserved for GDPR erasure; not a Beta user action

  versions        AutomationDefinitionVersion[] @relation("AllVersions")
  runs            AutomationRun[]

  @@index([userId])
  @@index([userId, status])
  @@index([status, nextRunAt])   // the scheduler's due-set query
  @@index([deletedAt])
  @@map("automations")
}
```

### 3.2 `AutomationDefinitionVersion` (immutable)

```prisma
model AutomationDefinitionVersion {
  id            String   @id @default(cuid())
  automationId  String
  version       Int      // 1-based, strictly increasing per automation
  // The full versioned workflow definition (trigger + steps + metadata).
  // Schema: §4 below. Validated by WorkflowValidator before an automation
  // may be activated on this version.
  definition    Json
  // Denormalised trigger fields, extracted from definition.trigger, so the
  // scheduler never parses JSON in its hot path:
  triggerType   AutomationTriggerType
  slot          String?  // e.g. "0830_IST"; null for manual
  daysOfWeek    String[] @default([])  // ["MON",...]; weekly only
  runAt         DateTime?              // once only
  createdBy     String                 // userId who authored this version
  createdAt     DateTime @default(now())

  automation    Automation @relation("AllVersions", fields: [automationId], references: [id], onDelete: Cascade)
  activeFor     Automation[] @relation("ActiveVersion")
  runs          AutomationRun[]

  @@unique([automationId, version])
  @@index([automationId])
  @@map("automation_definition_versions")
}
```

### 3.3 `AutomationRun`

```prisma
model AutomationRun {
  id                 String               @id @default(cuid())
  automationId       String
  definitionVersionId String              // HARD link — the version that executed (sprint §4)
  userId             String               // = automation.userId, denormalised for owner-scoped queries
  requesterId        String               // who triggered it: the owner (manual) or "system:scheduler"
  status             AutomationRunStatus   @default(QUEUED)
  trigger            AutomationRunTrigger

  // The scheduled slot instant this run fills. NULL for manual runs.
  // (automationId, scheduledFor) is unique → scheduled-dedup (contract §7).
  scheduledFor       DateTime?

  startedAt          DateTime?
  completedAt        DateTime?
  durationMs         Int?
  creditsUsed        Float                @default(0)   // Σ child AgentCreditLedgerEntry, written at terminal
  error              Json?                // { code, message, failedStepId } — null unless FAILED
  outputRef          Json?                // { kind, ids: {...} } pointer to the run's principal output
  contextSnapshot    Json?                // the final run context (contract §4.3), written at terminal
  cancelRequestedAt  DateTime?

  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  automation         Automation                   @relation(fields: [automationId], references: [id], onDelete: Cascade)
  definitionVersion  AutomationDefinitionVersion  @relation(fields: [definitionVersionId], references: [id])
  steps              AutomationStepRun[]

  @@unique([automationId, scheduledFor])   // at-least-once cron dedup (null scheduledFor = manual, never collides)
  @@index([userId, createdAt])
  @@index([automationId, createdAt])
  @@index([status, updatedAt])             // catch-up pass: find stale RUNNING/QUEUED
  @@map("automation_runs")
}
```

> **Note on the unique index with NULL:** PostgreSQL treats `NULL` as
> distinct in a unique index, so many manual runs (all `scheduledFor = NULL`)
> coexist fine; only scheduled runs (non-null slot instant) are deduped.
> This is the intended behaviour and is asserted by
> `validate-automation-idempotency.ts`.

### 3.4 `AutomationStepRun` (append-only)

```prisma
model AutomationStepRun {
  id              String                  @id @default(cuid())
  automationRunId String
  stepId          String                  // the definition step's stable id (e.g. "s1")
  index           Int                     // 0-based, gapless
  kind            AutomationStepKind
  status          AutomationStepRunStatus  @default(PENDING)

  agentRunId      String?                 // FK-by-id to the child AgentRun (kind=agent_run only)
  articleId       String?                 // created draft (kind=publication_draft only)
  artifactId      String?                 // (kind=workspace_save only)

  input           Json?                   // resolved step input (post output-binding)
  output          Json?                   // step result / { left, op, right, result } for condition
  error           Json?                   // { code, message } — null unless FAILED
  reason          String?                 // SKIPPED / halt explanation, shown verbatim in Run Detail
  startedAt       DateTime?
  completedAt     DateTime?
  durationMs      Int?
  creditsUsed     Float                   @default(0)

  createdAt       DateTime                @default(now())

  run             AutomationRun @relation(fields: [automationRunId], references: [id], onDelete: Cascade)

  @@unique([automationRunId, index])
  @@index([automationRunId])
  @@index([agentRunId])
  @@map("automation_step_runs")
}
```

### 3.5 `AutomationArtifact` (append-only — the Workspace sink, gap §4.2)

```prisma
model AutomationArtifact {
  id              String                  @id @default(cuid())
  userId          String
  automationRunId String
  stepRunId       String
  kind            AutomationArtifactKind
  title           String
  // The payload is the child AgentRun's already-safe observability output
  // (or a { articleId } pointer). Never a raw provider response.
  payload         Json
  createdAt       DateTime                @default(now())

  @@index([userId, createdAt])
  @@index([automationRunId])
  @@map("automation_artifacts")
}
```

---

## 4. Versioned workflow definition — JSON schema (`definition` column)

```jsonc
{
  "schemaVersion": 1,

  "trigger": {
    "type": "manual" | "once" | "daily" | "weekly",
    "timezone": "Asia/Kolkata",            // IANA, required, frozen
    "slot": "0830_IST",                    // required for once|daily|weekly; from the slot registry
    "daysOfWeek": ["MON","TUE","WED","THU","FRI"],  // weekly only
    "runAt": "2026-09-15T00:00:00.000Z"    // once only; the slot on/after this date fires it
  },

  "steps": [
    {
      "id": "s1",                          // stable, unique within the definition, /^[a-z][a-z0-9]{0,15}$/
      "kind": "agent_run",
      "action": {
        "agentType": "MARKET_INTELLIGENCE",// RESEARCH | MARKET_INTELLIGENCE | STRATEGY_RESEARCH
        "input": { "symbol": "XAUUSD", "timeframe": "1h" }
      },
      "outputBindings": { "confidence": "$.result.confidence" }   // optional; JSONPath into raw step output
    },
    {
      "id": "s2",
      "kind": "condition",
      "condition": { "left": "$.steps.s1.confidence", "op": "gte", "right": 0.75 }
    },
    {
      "id": "s3",
      "kind": "agent_run",
      "action": { "agentType": "RESEARCH", "input": { "question": "Gold morning brief", "symbol": "XAUUSD" } }
    },
    {
      "id": "s4",
      "kind": "publication_draft",
      "action": {
        "category": "market-analysis",      // must be a CONTENT_CATEGORIES value
        "keywords": ["gold","xauusd"],      // literal, or:
        "keywordsFrom": "$.steps.s3.result.keywords",
        "aiOverviewFrom": "$.steps.s3.result.summary"
      }
    },
    {
      "id": "s5",
      "kind": "workspace_save",
      "action": { "title": "Gold Morning Intelligence", "from": "$.steps.s3.result" }
    }
  ],

  "metadata": { "templateId": "gold-morning-intelligence" }   // optional
}
```

### 4.1 Validation rules (`WorkflowValidator`)

- `schemaVersion` must be `1`.
- `trigger.type` ∈ enum; `timezone` a valid IANA zone; `slot` ∈ slot
  registry when type ≠ `manual`; `daysOfWeek` non-empty subset of the 7
  codes when `weekly`; `runAt` a future ISO date when `once`.
- 1–8 steps. Step `id`s unique, match the id regex.
- First step may not be a `condition`. Two `condition`s may not be adjacent
  with nothing between (a no-op). Last step may be any kind.
- `agent_run.action.agentType` ∈ `RUNNABLE_AGENT_TYPES`. `action.input` is a
  JSON object (the agent validates its own shape at run time).
- `publication_draft.action.category` ∈ `CONTENT_CATEGORIES`.
- Every JSONPath (`outputBindings` values, `condition.left`, `*From`)
  matches `^\$\.(steps\.[a-z][a-z0-9]{0,15}|trigger)\.[A-Za-z0-9_.]+$` and
  every `$.steps.<id>` refers to an **earlier** step.
- `condition.op` ∈ `[gte,gt,lte,lt,eq,neq]`; `condition.right` is a JSON
  primitive (number | string | boolean).
- Total serialized `definition` ≤ 16 KB.

---

## 5. Mapping to sprint §3's suggested fields

| Sprint field | AT24 model field | Note |
| --- | --- | --- |
| Automation.trigger configuration | `AutomationDefinitionVersion.definition.trigger` (+ denormalised `triggerType`/`slot`/`daysOfWeek`/`runAt`) | versioned |
| Automation.workflow definition | `AutomationDefinitionVersion.definition.steps` | versioned |
| Automation.timezone | `Automation.timezone` + `definition.trigger.timezone` | stored, explicit |
| Automation.nextRunAt / lastRunAt | same names on `Automation` | |
| AutomationRun.requesterId | `AutomationRun.requesterId` | owner or `system:scheduler` |
| AutomationRun.creditsUsed | `AutomationRun.creditsUsed` | Σ child ledger, denormalised |
| AutomationRun.output/reference | `AutomationRun.outputRef` | pointer, not payload |
| AutomationStepRun.input/output reference | `AutomationStepRun.input` / `output` | resolved values + refs |
| AutomationStepRun.stepId | `AutomationStepRun.stepId` | definition step id |
| AutomationStepRun.creditsUsed | `AutomationStepRun.creditsUsed` | Σ this step's child-run ledger slice |

Sprint §3 also says *"do not blindly implement these exact fields if existing
AT24 schemas already provide equivalent canonical structures."* — hence
`AgentStep`/`AgentToolCall`/`AgentEvidence` are **not** duplicated;
`AutomationStepRun` is a thin parent frame that points at them.

---

## 6. Migrations

One additive migration dir, e.g.
`prisma/migrations/2026NNNN_add_automation_orchestration/`:

1. `CREATE TYPE` for the 8 enums in §2.
2. `CREATE TABLE` for the 5 models in §3.
3. **PENDING-1 dependent:**
   - *If "migrate 14E":* `INSERT INTO automations (...) SELECT ... FROM workflows`
     with each `workflows.steps` JSON wrapped into a v1 `definition`; then
     `DROP TABLE workflow_queue_items, workflow_runs, workflows;`
     `DROP TYPE "WorkflowTrigger","WorkflowStatus","RunStatus";`
     `DROP TABLE` the 14D `Automation` (rename first if a name clash with the
     new `automations` table — the new one is `@@map("automations")`, the old
     one maps to `Automation` default → they differ, but confirm before
     applying).
   - *If "keep 14E, add alongside":* skip the drops; document the dead tables
     in this file and stop the 14E UI from writing.
4. Applied with `prisma migrate deploy` (never `migrate dev` — pgvector reset
   trap).

The migration is **reviewed but NOT applied** until PENDING-1/-2 sign-off,
following the AN-series precedent (A3/A7/A9 migrations shipped
"GENERATED + REVIEWED, NOT APPLIED").
