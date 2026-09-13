# AUTOMATION_TEST_PLAN.md — AT24 Automation

**Status:** PROPOSED (LOCK with `AUTOMATION_DECISION.md`).
**House style (AN1.2 D2 — no Vitest):** every test is a standalone
`scripts/validate-automation-*.ts` using `node:assert/strict`, run via `tsx`,
with a `validate:automation-*` entry in `package.json`. Pattern: build
deterministic fake inputs → run the **real, unmodified** service chain →
assert → print `PASS`/`FAIL` + a one-line summary. In-memory stores via the
existing `RepositoryFactory` mock mode + `InMemoryCreditStore`.

A `validate:automation` aggregate script runs all of them; it is added to the
regression list in `AUTOMATION_GAP_REPORT.md §6`.

---

## 1. Unit (sprint §22 "Unit")

### `validate-automation-workflow-validation.ts`
- valid minimal definition (1 `agent_run` step) → passes
- valid full definition (all 4 step kinds) → passes
- `schemaVersion ≠ 1` → rejected
- 0 steps / 9 steps → rejected
- duplicate step ids → rejected
- first step is `condition` → rejected
- `agent_run.agentType` not in `RUNNABLE_AGENT_TYPES` → rejected
- `publication_draft.category` not in `CONTENT_CATEGORIES` → rejected
- JSONPath referencing a **later** step → rejected
- JSONPath with a wildcard/filter/function → rejected
- `condition.op` not in the 6 allowed → rejected
- `definition` > 16 KB → rejected

### `validate-automation-trigger-validation.ts`
- `manual` (no slot) → ok
- `daily` + valid slot → ok; `daily` + unknown slot → rejected
- `weekly` + empty `daysOfWeek` → rejected; + valid subset → ok
- `once` + past `runAt` → rejected; + future → ok
- invalid IANA timezone → rejected
- timezone defaulting: create with no tz → `Automation.timezone` = account tz,
  frozen on the definition (changing account tz later does not change it)

### `validate-automation-condition-eval.ts`
- `78 gte 75` → true; `71 gte 75` → false (step still `OK`, run `CONDITION_HALTED`)
- `"LOW" eq "LOW"` → true; `"LOW" eq "MEDIUM"` → false
- `status neq "SUCCESS"` semantics
- left path resolves to `undefined` → `result:false`, `reason` recorded, **not** an error
- `NaN` on either side of a numeric op → `result:false`, fails closed
- type-mismatch on `eq` (number vs string) → `result:false`
- output shape is exactly `{ left, op, right, result }`

### `validate-automation-state-transitions.ts`
- automation: every allowed transition in `AUTOMATION_EXECUTION_CONTRACT.md §2`
- automation: `ARCHIVED → ACTIVE`, `DRAFT → PAUSED`, `DRAFT → RESUME` → 409
- run: `QUEUED→RUNNING→SUCCEEDED`; `RUNNING→FAILED`; `RUNNING→CONDITION_HALTED`;
  `RUNNING→CREDIT_BLOCKED`; `RUNNING→CANCELLED`
- run: any write to a terminal run → rejected
- edit while `RUNNING` → new version created, in-flight run keeps its
  `definitionVersionId`

### `validate-automation-credit-calc.ts`
- `AutomationRun.creditsUsed` == Σ `AutomationStepRun.creditsUsed` ==
  Σ underlying `AgentCreditLedgerEntry` for the child runs
- a failed child run with partial charges: those charges stand, step
  `creditsUsed` = actual spent, **no auto-refund**
- estimate is never persisted as actual (no `creditsEstimated` field exists)

### `validate-automation-idempotency.ts`
- scheduled idempotency key = `(automationId, scheduledFor)`; a second
  dispatch for the same slot instant → `skipped`, no second `AutomationRun`
- many manual runs (`scheduledFor = null`) coexist (Postgres NULL-distinct
  unique index) — asserted against the real DB shape in mock mode's
  equivalent guard
- credit idempotency key format `auto:<automationRunId>:<stepIndex>:<childStepIndex>`;
  a resumed dispatch re-charging the same step → ledger no-op (`alreadyApplied`)
- missed slot: `scheduledFor` is the **intended** instant, so a later on-time
  fire is still correctly deduped

---

## 2. Integration (sprint §22 "Integration")

### `validate-automation-lifecycle.ts` (end-to-end, mock stores)
1. create automation (DRAFT) → activate → `nextRunAt` computed
2. manual run: 1 `agent_run` step → child `AgentRun` created with
   `trigger:"manual"`, driven to `succeeded`, `AutomationRun` → `SUCCEEDED`,
   `outputRef` points at the child run
3. scheduled run: `Scheduler.dueForSlot(slot, now)` returns it →
   `Dispatcher.drive` → child run `trigger:"schedule"` → `SUCCEEDED`
4. `daily` vs `weekly`: a Wed 08:30 slot fires a
   `weekly [MON,WED,FRI]` automation but not a `weekly [TUE,THU]` one
5. condition true → downstream steps run; condition false → downstream
   `SKIPPED`, run `CONDITION_HALTED`
6. `agent_run` → `publication_draft`: a real `Article` row is created with
   `status: draft` (never `published`); `articleId` recorded on the step
7. `workspace_save`: an `AutomationArtifact` row is created and appears in the
   Workspace panel query
8. pause → a due slot pass **skips** it; resume → next slot runs it
9. run history: `GET /automations/:id/runs` returns the runs in order with
   real durations/credits
10. one-time automation: fires once, then automation auto-transitions to
    `ARCHIVED`; a second slot pass does nothing

### `validate-automation-failure.ts`
- step 2 of 4 throws → step `FAILED` with code+message, run `FAILED`,
  steps 3–4 `SKIPPED` with reason, step 1 stays `OK`
- child `AgentRun` ends `failed` → parent step `FAILED`, run `FAILED`
- child `AgentRun` ends `timeout` → step `FAILED` code `STEP_TIMEOUT`
- `publication_draft` step: `articleService.createDraft` throws → step
  `FAILED`, no half-created article visible (service is transactional)
- failures are present in the `steps` array of the Run Detail response
  (never omitted)

### `validate-automation-credit-failure.ts`
- owner allowance = 4, step needs 12 → child run terminates `credit_limit`,
  parent step `FAILED` code `CREDIT_LIMIT`, run `CREDIT_BLOCKED`
- a completed earlier step's credits are still recorded and still counted in
  `AutomationRun.creditsUsed`
- ledger has no negative/refund entry (no auto-refund in Beta)
- re-run after top-up: a fresh `AutomationRun`, fresh idempotency keys,
  succeeds

### `validate-automation-dispatch.ts`
- dispatch handler: auth rejects no-secret / wrong-secret / plain-user; accepts
  valid `CRON_SECRET` and admin
- batch limit respected (26 due, BATCH=25 → 25 dispatched, 1 left `QUEUED`,
  picked up next pass)
- catch-up pass resumes a `RUNNING` run older than `RESUME_AFTER_MS` before
  starting new dispatch
- concurrency: an automation with a `RUNNING` run is `skipped` with reason
  `run_in_progress`
- double-fire of the same slot cron → second pass creates 0 new runs

### `validate-automation-cancel.ts`
- cancel a `QUEUED` run → immediately `CANCELLED`
- cancel a `RUNNING` run → `cancelRequestedAt` set; at the next step boundary
  the run goes `CANCELLED`, remaining steps `SKIPPED`
- cancel a terminal run → 409
- a child `AgentRun` mid-`tick()` is allowed to finish that tick (bounded),
  then not advanced

### `validate-automation-pause-resume.ts`
- (covered in lifecycle §2.8, plus:) `nextRunAt` is retained while paused and
  recomputed on resume; a slot that passed during the pause is treated as
  "missed", not back-filled

---

## 3. Security (sprint §22 "Security")

### `validate-automation-security.ts`
- user A `GET /automations/:id` for user B's automation → 404
- user A `POST /automations/:id/run` for user B's automation → 404
- user A `PATCH /automations/:id` for user B's automation → 404
- user A `GET /automation-runs/:id` for user B's run → 404
- `userId` supplied in the request body/query is **ignored** — the run is
  created for the session user (assert the created row's `userId`)
- a definition whose `agent_run` step names a tool/agent the owner lacks
  permission for → the child `AgentRun` is denied by `authorization-service`
  (`permission_denied`), parent step `FAILED`, run `FAILED` — automation did
  **not** widen the grant
- a definition cannot express `live_execution`; even if crafted, the
  framework denies it by default
- `publication_draft` produces only a `draft`; there is no automation code
  path that sets `ArticleStatus` to `scheduled`/`published`
- credit spend always lands on the **session owner's** ledger, never a
  body-supplied user
- static grep assertion: no file under `services/automation/**` or
  `app/api/private/automations/**` reads `body.userId` / `query.userId` /
  `searchParams.get("userId")`

---

## 4. Regression (sprint §22 "Regression")

- `npm run build` (`prisma generate && next build`) passes.
- `npx tsc --noEmit` clean.
- `npm run lint` clean.
- The **full existing** `validate:*` suite (60+ scripts in `package.json`)
  runs green — in particular `validate:agent-*` (framework),
  `validate:billing`, `validate:scheduler-wiring`, `validate:publishing*` (if
  present). No existing test is weakened, skipped, or its assertions relaxed.
- The two existing crons (`evaluate-outcomes`, `ingest-news`) still deploy —
  `vercel.json` remains all-daily.

---

## 5. Production smoke (sprint §23, §27)

Run against the deployed site after merge (script:
`scripts/smoke-automation.mjs`, mirrors existing smoke scripts):
1. `GET /api/health` → 200.
2. Auth as the seeded beta user; `GET /api/private/automations` → 200,
   `{ items: [], total: 0 }` for a fresh user (no mock rows).
3. `POST /api/private/automations` (template `daily-market-brief`,
   `slot: 0830_IST`) → 201 DRAFT.
4. `POST …/activate` → 200 ACTIVE, `nextRunAt` in the future.
5. `POST …/run` → 202; poll `GET /api/private/automation-runs/:id` until
   terminal (≤ 90 s). Expect `SUCCEEDED` with ≥ 1 step, real `creditsUsed`,
   real `durationMs`.
6. `GET /dashboard/automation` renders the automation with a real
   last-run chip and **no `NaN` / "—" / mock numbers**.
7. Manually `GET …/cron/dispatch?slot=0830_IST` with the `CRON_SECRET`
   → 200, `dispatched`/`skipped` reflect real state.
8. `POST …/archive` → 200; the automation leaves the default list.

---

## 6. Coverage matrix vs sprint §22

| Sprint item | Script |
| --- | --- |
| workflow validation | `validate-automation-workflow-validation` |
| trigger validation | `validate-automation-trigger-validation` |
| condition evaluation | `validate-automation-condition-eval` |
| state transitions | `validate-automation-state-transitions` |
| credit calculation | `validate-automation-credit-calc` |
| idempotency key generation | `validate-automation-idempotency` |
| create automation | `validate-automation-lifecycle §1` |
| activate automation | `validate-automation-lifecycle §1` |
| manual run | `validate-automation-lifecycle §2` |
| scheduled run | `validate-automation-lifecycle §3` / `validate-automation-dispatch` |
| Agent execution | `validate-automation-lifecycle §2–3` |
| failed execution | `validate-automation-failure` |
| credit failure | `validate-automation-credit-failure` |
| pause/resume | `validate-automation-pause-resume` |
| run history | `validate-automation-lifecycle §9` |
| user A ↛ user B (access/run/modify) | `validate-automation-security` |
| automation ↛ bypass Agent permissions | `validate-automation-security` |
| automation ↛ bypass credit rules | `validate-automation-security` + `validate-automation-credit-failure` |
| regression suite | §4 above |
