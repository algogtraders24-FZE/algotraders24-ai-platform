# AUTOMATION_EXECUTION_CONTRACT.md — AT24 Automation

**Status:** PROPOSED (LOCK with `AUTOMATION_DECISION.md`).
Canonical rules for how an automation executes. Where this doc and any code
disagree, this doc wins until amended.

---

## 1. Entities & ownership

| Entity | Owner of truth | Mutability |
| --- | --- | --- |
| `Automation` | `AutomationService` | `name`, `description`, `status`, `activeVersionId`, `timezone`, `nextRunAt`, `lastRunAt` mutable; `userId`, `createdAt` immutable |
| `AutomationDefinitionVersion` | `AutomationService` | **immutable once created** (append-only version chain) |
| `AutomationRun` | `AutomationDispatcher` | status + terminal fields (`completedAt`, `durationMs`, `creditsUsed`, `error`, `outputRef`) mutable until terminal; **never rewritten after terminal** |
| `AutomationStepRun` | `AutomationDispatcher` | append-only; status + terminal fields set once |
| `AutomationArtifact` | `artifact-sink` | append-only, immutable |
| child `AgentRun` / `AgentStep` / `AgentEvidence` / `AgentCreditLedgerEntry` | **the Agent Framework** (unchanged) | per AN1.2 |

Automation **reads** agent-framework rows through `agent-run-service`; it
never writes them.

---

## 2. Automation state machine

States: `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`.

| From | Event | To | Guard |
| --- | --- | --- | --- |
| `DRAFT` | `activate` | `ACTIVE` | definition passes `WorkflowValidator`; owner under `maxAutomations` |
| `DRAFT` | `archive` | `ARCHIVED` | — |
| `ACTIVE` | `pause` | `PAUSED` | — |
| `ACTIVE` | `archive` | `ARCHIVED` | — |
| `ACTIVE` | `edit` | `ACTIVE` | writes a new version, bumps `activeVersionId`; **does not** change status |
| `PAUSED` | `resume` | `ACTIVE` | definition still valid |
| `PAUSED` | `archive` | `ARCHIVED` | — |
| `PAUSED` | `edit` | `PAUSED` | new version; status unchanged |
| `ARCHIVED` | * | — | terminal; all transitions rejected (409) |

Any transition not in this table → `409 INVALID_STATE_TRANSITION` with the
current and requested state in the error payload. No transition is inferred;
each is an explicit API call.

**Editing while runs exist:** always allowed. A new version never touches an
in-flight or historical run — those keep their `definitionVersionId`. A
`RUNNING` automation being edited: the current run finishes on its old
version; the next scheduled run uses the new one.

---

## 3. Run state machine

States: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CONDITION_HALTED`,
`CANCELLED`, `CREDIT_BLOCKED`.

| From | Event | To |
| --- | --- | --- |
| — | dispatcher creates run | `QUEUED` |
| `QUEUED` | first slice starts | `RUNNING` |
| `QUEUED` | cancel requested | `CANCELLED` |
| `RUNNING` | all steps done, last not a false condition | `SUCCEEDED` |
| `RUNNING` | a step threw / child `AgentRun` terminal-failed | `FAILED` |
| `RUNNING` | a `condition` step evaluated false | `CONDITION_HALTED` |
| `RUNNING` | child `AgentRun` ended `credit_limit`, or pre-charge check failed | `CREDIT_BLOCKED` |
| `RUNNING` | cancel requested, observed at next step boundary | `CANCELLED` |
| any terminal | * | — (immutable) |

Terminal states: `SUCCEEDED`, `FAILED`, `CONDITION_HALTED`, `CANCELLED`,
`CREDIT_BLOCKED`. `isTerminalAutomationRunStatus()` mirrors the agent
framework's `isTerminalRunStatus()` helper.

---

## 4. Step contract

### 4.1 Step kinds (Beta)

| kind | external effect | produces |
| --- | --- | --- |
| `agent_run` | starts one child `AgentRun` (`RESEARCH` \| `MARKET_INTELLIGENCE` \| `STRATEGY_RESEARCH`), drives to terminal | `agentRunId`, observability snapshot in `outputRef` |
| `condition` | none (pure, deterministic) | `{ left, op, right, result: boolean }` recorded in `output` |
| `publication_draft` | `articleService.createDraft(userId, …)` | `articleId` |
| `workspace_save` | insert `AutomationArtifact` + surface in Workspace panel | `artifactId` |

No other step kinds exist in Beta. Adding one is a schema-compatible change
(a new `kind` value + a dispatcher branch) — **not** a definition-format
change.

### 4.2 Ordered, sequential, bounded

- Steps execute strictly in array order. Index is 0-based, gapless, recorded
  as `AutomationStepRun.index`.
- No step runs until the previous step reached `OK` (or `condition` = true).
- A `condition` = false → run `CONDITION_HALTED`; every later step is written
  as `AutomationStepRun { status: SKIPPED, reason: "condition <id> halted the run" }`.
- A step error → step `FAILED` (`error` = message + code); run `FAILED`;
  later steps `SKIPPED` (`reason: "prior step <id> failed"`).
- Per-step timeout: `agent_run` = child run's `limits.maxWallClockMs`
  (default from `DEFAULT_RUN_LIMITS`); `publication_draft` / `workspace_save`
  / `condition` = 30 000 ms. Timeout → step `FAILED` with code `STEP_TIMEOUT`.

### 4.3 Run context & output bindings

The dispatcher maintains an in-memory **run context** for the duration of one
run:

```jsonc
{
  "trigger": { "type": "weekly", "firedAt": "2026-10-06T03:00:00Z", "scheduledFor": "2026-10-06T03:00:00Z" },
  "input": { /* automation-level input, if any */ },
  "steps": {
    "s1": { "status": "OK", "confidence": 0.78, "result": { /* child AgentRun output */ } },
    "s2": { "status": "OK", "result": true }
  }
}
```

- After each step, its declared `outputBindings` (JSONPath → key) are
  evaluated against the step's raw output and merged into
  `context.steps.<id>`.
- `condition.left` and any `action.*From` field is a JSONPath **read** of
  this context. JSONPath is restricted to `$.steps.<id>.<field>` and
  `$.trigger.<field>` — no functions, no filters, no wildcards.
- The final context is persisted as `AutomationRun.contextSnapshot` (JSON)
  for audit. It never contains secrets or raw provider payloads (only what
  the child `AgentRun` observability model already exposes).

---

## 5. Condition evaluation

- Evaluated **server-side only**, in `services/automation/condition-eval.ts`.
- Signature: `evaluate(cond, context) → { result: boolean, left: unknown, right: unknown }`.
- Operators: `gte`, `gt`, `lte`, `lt`, `eq`, `neq`. Numeric compares coerce
  both sides to `number` and fail closed (`result:false`, step still `OK`)
  if either side is `NaN`/missing — a missing metric is **not** an error, it
  is "condition not met". This is logged distinctly (`reason: "left path
  <p> resolved to undefined"`).
- `eq`/`neq` do a strict, same-type compare (string vs string, number vs
  number, boolean vs boolean).
- The full `{ left, op, right, result }` is written to
  `AutomationStepRun.output` — the Run Detail UI shows `78 >= 75 ✓` verbatim
  (sprint §16).

---

## 6. Credit contract

**Automation never holds or charges credits itself.** All charges flow
through the existing `CreditLedger` from the child `AgentRun`s.

| Moment | Behaviour |
| --- | --- |
| Before an `agent_run` step | The dispatcher calls `agent-run-service.startAgentRun` which, via the runtime + `LimitEnforcer`, does the existing per-tool credit pre-check. No separate automation-level reservation in Beta. |
| During a child run | `CreditLedger.charge({ idempotencyKey: "auto:<automationRunId>:<stepIndex>:<childStepIndex>", … })` — automation-scoped keys so a resumed dispatch never double-charges. |
| Child run succeeds | `AutomationStepRun.creditsUsed = Σ CreditLedger.historyForRun(childRunId)`. |
| Child run fails **after** partial charges | Those charges **stand** (real model inference / tool calls happened). Step `FAILED`, `creditsUsed` = what was actually spent. **No automatic refund** in Beta — deterministic accounting over generosity. |
| Child run hits `credit_limit` | Step `FAILED` (code `CREDIT_LIMIT`), run `CREDIT_BLOCKED`. Steps already completed keep their recorded cost. |
| Owner has insufficient credits at step start | `startAgentRun` / first `tick()` terminates the child as `credit_limit` → same as above; **no** later steps run. |
| Manual re-run after a failure | A brand-new `AutomationRun` with fresh idempotency keys — the user is choosing to spend again. Prior run's costs are historical and unchanged. |
| Partial-execution invariant | `AutomationRun.creditsUsed` always equals the exact sum of its `AutomationStepRun.creditsUsed`, which always equals the exact sum of the underlying `AgentCreditLedgerEntry` rows. No estimate is ever stored as if it were actual. |

`AutomationRun` and `AutomationStepRun` both expose `creditsUsed`. There is no
`creditsReserved`/`creditsEstimated` field in Beta — reservation is a
post-Beta feature (`AUTOMATION_DECISION.md` roadmap).

---

## 7. Idempotency & concurrency

| Guard | Mechanism |
| --- | --- |
| One scheduled run per (automation, slot instant) | `@@unique([automationId, scheduledFor])` on `AutomationRun`; a duplicate insert is caught and logged as `skipped`, not raised. |
| One active run per automation | Dispatcher checks `NOT EXISTS AutomationRun WHERE automationId=? AND status IN (QUEUED,RUNNING)` before creating; a scheduled pass that loses this check is recorded as `skipped` and retried next slot. |
| Credit charge not doubled on resume | Automation-scoped `idempotencyKey` (§6) + the ledger's existing unique-key no-op. |
| Dispatch handler re-entrancy | The catch-up pass claims a `QUEUED`/`RUNNING` run by patching `status`/`startedAt` in a conditional update; a second concurrent handler's update affects 0 rows and it moves on. |
| One-time automation fires once | After the run reaches terminal, `AutomationService` transitions the automation to `ARCHIVED`; the due-set query also excludes `trigger.type=once` automations that already have any `AutomationRun`. |

`scheduledFor` for a missed slot is the **intended** slot instant, not
`now()`, so a late catch-up run still occupies the correct idempotency slot
and a subsequent on-time fire is correctly skipped.

---

## 8. Cancellation

- `POST /api/private/automation-runs/:id/cancel` (owner only) sets
  `AutomationRun.cancelRequestedAt`.
- The dispatcher checks `cancelRequestedAt` **between steps**. If set:
  - a `RUNNING` child `AgentRun` is left to finish its current `tick()` then
    not advanced further; the automation run goes `CANCELLED`;
  - remaining steps → `SKIPPED` (`reason: "run cancelled by owner"`).
- A `QUEUED` run cancels immediately.
- Cancellation is **cooperative** — there is no hard kill of an in-flight
  serverless invocation. Worst case: one more child `tick()` completes
  (bounded, already charged correctly).
- A terminal run cannot be cancelled (409).

---

## 9. Timeouts & serverless resumption

- Dispatch invocation budget: `maxDuration = 60` s.
- The dispatcher drives each run with `agentRuntime.runToCompletion(childRunId, { maxTicks })`
  where `maxTicks` is chosen to leave head-room; if a child does not finish,
  its `AgentRun` stays non-terminal and the automation run stays `RUNNING`.
- Resumption sources (any of):
  1. the next slot cron's **catch-up pass** (resumes `RUNNING` runs older
     than `RESUME_AFTER_MS`, config, default 120 s, before new dispatch);
  2. `POST /automation-runs/:id/advance` from a client watching the run.
- Because both the agent runtime and the automation dispatcher are
  **pure functions of persisted state**, a lost invocation loses no work —
  it re-derives position from `AutomationStepRun` rows + child `AgentRun`
  status.

---

## 10. Evidence / verification boundary (sprint §20)

The contract preserves four distinct states — Automation may only ever assert
the first:

```
execution_succeeded   →  AutomationRun.status = SUCCEEDED
analysis_verified     →  a property of the child AgentRun's output-integrity + evidence, surfaced but never asserted by Automation
publication_approved  →  Publishing workflow only
publication_published →  Publishing workflow only
```

- An `AutomationRun.status = SUCCEEDED` means "every step ran without error".
  It does **not** mean the analysis is correct, actionable, or reviewed.
- The Run Detail UI states this explicitly next to a green run: *"All steps
  completed. This does not verify the analysis — open the agent run for its
  evidence and confidence."*
- A `publication_draft` step always creates a **draft** (`ArticleStatus.draft`).
  Automation has no path to `scheduled`/`published`.
