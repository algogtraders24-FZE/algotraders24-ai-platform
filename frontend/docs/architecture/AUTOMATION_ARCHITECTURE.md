# AUTOMATION_ARCHITECTURE.md — AT24 Automation

**Status:** PROPOSED — LOCKED only after `AUTOMATION_DECISION.md` PENDING-1 &
PENDING-2 are signed off by the product owner.
**Depends on:** `AUTOMATION_RND.md` (reuse surface), AN1.2 (agent framework
locked decisions).

---

## 0. Core principle (mirrors AN1.2 §0)

> **AT24 Automation is an orchestration + scheduling + definition-versioning
> layer. It does NOT execute analysis, call market-data providers, score
> confidence, or write evidence. It decides *when* and *in what order* to
> invoke existing AT24 capabilities — primarily the Agent Framework — and it
> records what happened.**

```
AI Agent / Intelligence  =  WHAT the analysis is        (unchanged)
Automation               =  WHEN / HOW OFTEN / IN WHAT ORDER it runs   (this sprint)
Publishing               =  HOW the verified result is packaged & distributed (unchanged)
```

Automation is **never** a signal engine, never a generic task scheduler,
never the publishing system (sprint §1, §19, §20).

---

## 1. System context

```
                 ┌─────────────────────────────────────────────┐
                 │  /dashboard/automation  (Next.js client)     │
                 │  list · guided builder · detail · run detail │
                 └───────────────┬─────────────────────────────┘
                                 │  fetch  (owner-scoped, session userId)
                 ┌───────────────▼─────────────────────────────┐
                 │  app/api/private/automations/**             │
                 │  app/api/private/automation-runs/**         │
                 │  (withContext · ApiResponse · getUserOrNull)│
                 └───────────────┬─────────────────────────────┘
                                 │
                 ┌───────────────▼─────────────────────────────┐
                 │  services/automation/                        │
                 │  ┌────────────────┐  ┌───────────────────┐   │
                 │  │ AutomationSvc  │  │ WorkflowValidator │   │
                 │  │ (CRUD + state) │  │ (definition +     │   │
                 │  └────────────────┘  │  trigger + cond)  │   │
                 │  ┌────────────────┐  └───────────────────┘   │
                 │  │ Scheduler      │  ┌───────────────────┐   │
                 │  │ (due-set calc, │  │ ConditionEval     │   │
                 │  │  preset slots) │  │ (deterministic)   │   │
                 │  └────────────────┘  └───────────────────┘   │
                 │  ┌──────────────────────────────────────┐    │
                 │  │ AutomationDispatcher (the executor)  │    │
                 │  │  - creates 1 AutomationRun           │    │
                 │  │  - walks the versioned step list     │    │
                 │  │  - per step: delegates ↓             │    │
                 │  └────────────┬────────────┬────────────┘    │
                 └───────────────┼────────────┼────────────────┘
                                 │            │
          ┌──────────────────────▼───┐   ┌────▼─────────────────────┐
          │ services/agent-framework │   │ services/publishing      │
          │  api/agent-run-service   │   │  article.service         │
          │   startAgentRun / advance│   │  createDraft (never publish)│
          │  → AgentRuntime.tick     │   └──────────────────────────┘
          │  → CreditLedger.charge   │
          │  → AgentEvidence / trace │   ┌──────────────────────────┐
          │  → authorization-service │   │ services/automation      │
          └──────────────────────────┘   │  artifact-sink (Workspace)│
                                         └──────────────────────────┘
```

**Rule:** `services/automation/**` may import from
`services/agent-framework/api/*` and `services/publishing/*`. It may **not**
import from `services/agent-framework/runtime/*`, `.../credits/*`,
`.../tools/*` directly — only through `agent-run-service`. This keeps the
agent framework's locks (AN1.2 G14) intact.

---

## 2. The three layers

### 2.1 Definition layer — `Automation` + versioned `workflowDefinition`

An `Automation` row is the durable, user-owned config. Its
`workflowDefinition` is **content-addressed by version**: editing an
automation writes a **new** `AutomationDefinitionVersion` and bumps
`Automation.activeVersionId`. Historical `AutomationRun`s keep a hard FK to
the exact `definitionVersionId` they executed (sprint §4). A run is always
reproducible against its own version — editing never mutates history.

```jsonc
// workflowDefinition (JSON, versioned) — see AUTOMATION_DATA_MODEL.md for the schema
{
  "schemaVersion": 1,
  "trigger": { "type": "weekly", "timezone": "Asia/Kolkata",
               "daysOfWeek": ["MON","TUE","WED","THU","FRI"], "slot": "0830_IST" },
  "steps": [
    { "id": "s1", "kind": "agent_run",
      "action": { "agentType": "MARKET_INTELLIGENCE", "input": { "symbol": "XAUUSD", "timeframe": "1h" } },
      "outputBindings": { "confidence": "$.result.confidence" } },
    { "id": "s2", "kind": "condition",
      "condition": { "left": "$.steps.s1.confidence", "op": "gte", "right": 0.75 } },
    { "id": "s3", "kind": "agent_run",
      "action": { "agentType": "RESEARCH", "input": { "question": "Gold morning brief", "symbol": "XAUUSD" } } },
    { "id": "s4", "kind": "publication_draft",
      "action": { "category": "market-analysis", "keywordsFrom": "$.steps.s3.result.keywords" } },
    { "id": "s5", "kind": "workspace_save",
      "action": { "title": "Gold Morning Intelligence", "from": "$.steps.s3.result" } }
  ],
  "metadata": { "templateId": "gold-morning-intelligence" }
}
```

### 2.2 Execution layer — `AutomationRun` wraps `AgentRun`

```
AutomationRun  (1)───(N)  AutomationStepRun
                               │
                 ┌─────────────┼──────────────────────────┐
   kind=agent_run│             │kind=condition            │kind=publication_draft / workspace_save
        │        │             │(no external call)        │
        ▼        │             ▼                          ▼
   AgentRun ─────┘      recorded inline               articleService.createDraft
   (trigger=schedule|manual,                          / AutomationArtifact insert
    userId = automation.userId)
```

- `AutomationStepRun.agentRunId` is the FK to the child `AgentRun` for
  `agent_run` steps (null otherwise).
- `AutomationRun.creditsUsed` = Σ `CreditLedger.historyForRun(childRunId)`
  across all child runs. Automation itself **never charges credits** — only
  its child `AgentRun`s do, through the existing ledger.
- The child `AgentRun` is driven with `runToCompletion(runId,{maxTicks})`
  inside the dispatch invocation when time allows, else across dispatch
  invocations via `tick()` (the runtime is already resumable — §4.4).

### 2.3 Scheduling layer — preset-slot dispatcher

See §4.

---

## 3. Execution lifecycle (canonical — full contract in `AUTOMATION_EXECUTION_CONTRACT.md`)

### 3.1 Automation status

```
DRAFT ──activate──▶ ACTIVE ──pause──▶ PAUSED ──resume──▶ ACTIVE
  │                   │                                    │
  │                   └──────────archive───────────────────┤
  └──────────archive──────────────────────────────────────▶ ARCHIVED  (terminal)
```

- A `DRAFT` automation never schedules and cannot be run.
- Only `ACTIVE` automations are picked up by the scheduler.
- `PAUSED` keeps `nextRunAt` computed but the dispatcher skips it.
- `ARCHIVED` is terminal, hidden by default, runs retained for audit.
  **There is no hard delete** (sprint §13, §20) — `deletedAt` exists only for
  a future GDPR erasure path, not a user action in Beta.
- Invalid transitions (e.g. `ARCHIVED → ACTIVE`, `DRAFT → PAUSED`) are
  rejected by `AutomationService` with a 409.

### 3.2 Run status

```
QUEUED ──▶ RUNNING ──▶ SUCCEEDED
                │
                ├──▶ FAILED            (a step errored / a child AgentRun failed)
                ├──▶ CONDITION_HALTED  (a condition evaluated false — a normal, non-error stop)
                ├──▶ CANCELLED         (user cancelled; cooperative, at a step boundary)
                └──▶ CREDIT_BLOCKED    (child AgentRun hit credit_limit or pre-check failed)
```

`CONDITION_HALTED` is deliberately distinct from `FAILED`: "confidence was
0.71, threshold 0.75, so we correctly did nothing" is a **successful
evaluation with a negative outcome**, not a failure. The Run Detail UI shows
it as a neutral stop, not a red error (sprint §16, §20).

### 3.3 Step execution rules

1. Steps run **in listed order**, no branching/loops (sprint §24).
2. A `condition` step that is false → run stops, status `CONDITION_HALTED`,
   remaining steps `SKIPPED`.
3. A step error → step `FAILED` with `error`, run `FAILED`, remaining steps
   `SKIPPED`. **Never hidden.**
4. Every step records `startedAt`, `completedAt`, `durationMs`,
   `creditsUsed`, `input` ref, `output` ref.
5. Each executable step has a bounded timeout: `agent_run` inherits the
   child `AgentRun.limits.maxWallClockMs`; `publication_draft` /
   `workspace_save` get a fixed 30 s.

---

## 4. Scheduler architecture

### 4.1 The constraint (from `AUTOMATION_RND.md §2.4`)

Vercel **Hobby** plan: crons run **once per day per path**; a sub-daily
schedule in `vercel.json` breaks all deploys. **Minute-resolution cron is not
available.** This is a hard platform fact, not a design preference.

### 4.2 Beta design — preset slots (recommended; PENDING-2)

- Beta offers a **fixed set of schedule slots**, each mapped to a daily
  Vercel cron entry at a fixed UTC time:

  | Slot id | Local (IST) | Cron (UTC) | `vercel.json` path |
  | --- | --- | --- | --- |
  | `0800_IST` | 08:00 | `30 2 * * *` | `/api/private/automations/cron/dispatch?slot=0800_IST` |
  | `0830_IST` | 08:30 | `0 3 * * *`  | `…?slot=0830_IST` |
  | `0900_IST` | 09:00 | `30 3 * * *` | `…?slot=0900_IST` |
  | `1800_IST` | 18:00 | `30 12 * * *`| `…?slot=1800_IST` |

  (4 slots = 4 daily cron entries, all Hobby-legal. Exact slot list is a
  product choice; keep it ≤ 6.)

- "Daily" automation = fires every day at its chosen slot. "Weekly" = fires
  on its chosen `daysOfWeek` at its chosen slot. "One-time" = fires at the
  first slot pass on/after its `runAt` date, then auto-archives.
- **Timezone is explicit and stored** on the definition
  (`trigger.timezone`, default = the user's account timezone at creation,
  then frozen on the definition — sprint §5). Slots are labelled in IST
  because that is the product's home market; the stored value is a real IANA
  zone so a future free-time scheduler is non-breaking.

### 4.3 The dispatch cron handler

`GET /api/private/automations/cron/dispatch?slot=<id>` — auth: `CRON_SECRET`
bearer **or** authenticated admin (exact `ingest-news` precedent).

```
1. Authn (cron secret | admin) — else 401.
2. now = new Date(); slot = query.slot (validated against the slot registry).
3. due = AutomationService.dueForSlot(slot, now):
      Automation.status = ACTIVE
      AND activeVersion.trigger matches (daily | weekly+today | one-time+due)
      AND NOT EXISTS AutomationRun WHERE (automationId, scheduledFor = slotInstant)   ← idempotency
      AND NOT EXISTS AutomationRun WHERE automationId = ? AND status IN (QUEUED,RUNNING) ← concurrency
   ORDER BY nextRunAt ASC
   LIMIT BATCH (config, default 25)
4. For each due automation:
      create AutomationRun { status: QUEUED, trigger: "schedule", scheduledFor: slotInstant }
      AutomationDispatcher.drive(runId)   // bounded; see 4.4
5. Update each automation's lastRunAt / nextRunAt.
6. Return { slot, dispatched: n, skipped: [...], durationMs }.
```

`maxDuration = 60`. If the batch cannot finish in the invocation, unfinished
runs stay `QUEUED`/`RUNNING` and are resumed by:
- `POST /api/private/automation-runs/:id/advance` (client, for a run the user
  is watching), and/or
- a **catch-up pass**: each slot cron first resumes any `QUEUED`/`RUNNING`
  runs older than N minutes before starting new ones.

### 4.4 Missed / duplicate / paused / deleted executions

| Case | Behaviour |
| --- | --- |
| Cron didn't fire (platform outage) | Next slot pass runs it; `scheduledFor` is the **missed** slot instant so the idempotency key is still unique. No back-fill of multiple missed days in Beta (at most one catch-up run per automation per slot). |
| Cron fires twice (at-least-once delivery) | Second create violates the `(automationId, scheduledFor)` unique index → skipped, logged, not an error. |
| Automation paused between due-calc and dispatch | Dispatcher re-checks `status = ACTIVE` immediately before creating the run. |
| Automation archived mid-run | Run continues to a terminal state (audit integrity); no new runs. |
| Manual "Run now" during a scheduled window | Manual run has `scheduledFor = null`, `trigger = "manual"` — does not collide with the scheduled idempotency key; the one-active-run concurrency guard still applies (a manual run blocks a scheduled one for that pass, which is then treated as "missed" → next slot). |

### 4.5 Manual & one-time triggers

- **Manual:** `POST /api/private/automations/:id/run` → creates
  `AutomationRun { trigger: "manual", scheduledFor: null }`, drives it
  inline (bounded), returns the run id. Allowed for `ACTIVE` and `PAUSED`
  (a paused automation can still be test-run by its owner), never `DRAFT`
  or `ARCHIVED`.
- **One-time:** stored as `trigger.type = "once"` + `runAt`. First slot pass
  ≥ `runAt` runs it, then `AutomationService` transitions the automation to
  `ARCHIVED` (its job is done). If never activated before `runAt`, it is
  marked `expired` in the UI and never runs.

---

## 5. Security architecture (full checklist in `AUTOMATION_API_CONTRACT.md §7`)

- Every `automations/**` and `automation-runs/**` route: `getUserOrNull()` →
  401 if absent; every read/mutation filtered by `userId = session.profile.id`.
- **`userId` is never accepted from a request body or query** (platform lock).
- Ownership check on every `:id` route **before** any work: a run/automation
  that is not the caller's returns **404** (not 403 — no existence leak),
  matching `getRunObservability`'s existing behaviour.
- The dispatcher sets the child `AgentRun.userId = automation.userId`. The
  agent framework's `authorization-service` then applies the **owner's**
  tool permissions and autonomy ceiling to every tool call. **Automation
  cannot grant a capability the owner does not have** and cannot enable
  `live_execution` (denied by default in the framework).
- Credit charges hit the **owner's** ledger/allowance. Insufficient credits →
  `CREDIT_BLOCKED`, no partial side effects beyond steps already completed
  (each of which is individually recorded).
- Publication steps call `articleService.createDraft` **only**. Automation
  has no code path to `publish`, `schedule`, or approve an article —
  publishing permissions and workflow stay entirely in Publishing (sprint
  §19).
- Cron dispatch route: constant-time `CRON_SECRET` check; never "accept
  anyone" when the secret is unset (`isValidCronSecret` already guarantees
  this).
- `maxAutomations` per `PLAN_LIMITS[plan]` enforced on create (free 2 / pro
  25 / elite 100).

---

## 6. What Automation explicitly does NOT do

- No arbitrary code / expression language — conditions are a fixed
  `{ left (JSONPath into run context), op ∈ [gte,gt,lte,lt,eq,neq], right (literal) }`.
- No branching, loops, fan-out, parallel steps, sub-automations.
- No price/indicator/news/event triggers; no event bus consumption (the
  `AgentRunTrigger.event` slot stays reserved & unused).
- No autonomous/continuous agents — every run is a bounded, terminating
  sequence.
- No new intelligence, market-data, backtest, or evidence code.
- No email/SMS/push/social. Beta notification = in-app run record + badge.
- No hard delete, no in-place edit of historical run data.
- Does **not** mark any AI output "verified" — it records "execution
  succeeded", a strictly weaker claim (sprint §20).

---

## 7. Failure isolation & observability summary

- One `AutomationRun` failing never affects another automation or another
  user.
- One step failing produces exactly one clear `FAILED` step + a `FAILED`
  run; downstream steps are `SKIPPED` with a reason.
- Every run exposes (sprint §10, §16): status, `startedAt`, `durationMs`,
  ordered steps, per-step errors, per-step & total `creditsUsed`, and an
  `output` reference (child `AgentRun` observability, draft article id,
  or artifact id).
- The child `AgentRun`'s full immutable trace (`AgentStep` / `AgentToolCall`
  / `AgentEvidence`) is reachable from the Run Detail page — Automation adds
  a parent frame, it does not summarise away the evidence.

---

## 8. Open items before LOCK

| Id | Question | Owner decision in |
| --- | --- | --- |
| PENDING-1 | Reconcile `Automation` (14D) vs `Workflow` (14E) vs new model. Recommended: supersede both; migrate the 14E `workflows` table into `automations` (+ versions), delete the fake client executor, keep `/dashboard/automation` route. | `AUTOMATION_DECISION.md` |
| PENDING-2 | Scheduler: preset slots on Hobby crons (recommended) vs Vercel Pro upgrade vs external scheduler. | `AUTOMATION_DECISION.md` |
| PENDING-3 | Beta slot list & labels (how many, which times). Product choice; ≤ 6. | `AUTOMATION_DECISION.md` |
