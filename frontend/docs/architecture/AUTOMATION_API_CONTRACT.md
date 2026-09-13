# AUTOMATION_API_CONTRACT.md — AT24 Automation

**Status:** PROPOSED (LOCK with `AUTOMATION_DECISION.md`).
All routes follow existing platform conventions: `withContext`,
`ApiResponse.success/error`, `Errors.validation`, `getUserOrNull()` →
`sessionUser.profile.id`, `export const maxDuration = 60` on work routes.

**Base:** `/api/private/automations` and `/api/private/automation-runs`
(private = session-authenticated). The one exception is the cron dispatch
route, which is `CRON_SECRET`-or-admin authenticated.

---

## 1. Existing routes — disposition

| Route | Today | Beta |
| --- | --- | --- |
| `GET /api/private/automations` | 14D list of the minimal `Automation` model | **repurposed** — returns the new `Automation` list shape below |
| `GET /api/private/workflows` | 14E workflows + runs + queue | **deprecated** — kept returning `{ workflows: [], runs: [], queue: [], deprecated: true }` for one release, then removed. The `/dashboard/automation` page stops calling it. |

No other automation/workflow routes exist today. Everything below is new.

---

## 2. Automation CRUD & lifecycle

### `GET /api/private/automations`
List the caller's automations (excludes `ARCHIVED` unless `?status=archived`
or `?includeArchived=1`).

```jsonc
// 200
{ "items": [
  { "id": "aut_…", "name": "Gold Morning Intelligence", "description": "…",
    "status": "ACTIVE", "timezone": "Asia/Kolkata",
    "trigger": { "type": "weekly", "slot": "0830_IST", "daysOfWeek": ["MON","TUE","WED","THU","FRI"] },
    "activeVersion": 3,
    "lastRun": { "id": "arun_…", "status": "SUCCEEDED", "at": "2026-10-06T03:00:14Z", "creditsUsed": 18 },
    "nextRunAt": "2026-10-07T03:00:00Z",
    "stats30d": { "runs": 12, "succeeded": 11, "failed": 1, "creditsUsed": 214 },
    "createdAt": "…", "updatedAt": "…" }
], "total": 1 }
```
`stats30d` is computed from real `AutomationRun` rows — **no field is
synthesized** (sprint §12: "Only show metrics that are backed by real data").

### `POST /api/private/automations`
Create. Body = `{ name, description?, timezone?, definition }` where
`definition` is the §4 JSON of `AUTOMATION_DATA_MODEL.md`. Server:
- validates `definition` via `WorkflowValidator` → `422` with a field list on
  failure;
- enforces `count(active+draft automations) < PLAN_LIMITS[plan].maxAutomations`
  → `403 PLAN_LIMIT_REACHED`;
- creates the `Automation` (`status: DRAFT`) + `AutomationDefinitionVersion`
  v1, sets `activeVersionId`.
- `201 { id, status: "DRAFT", version: 1 }`.

### `GET /api/private/automations/:id`
Full detail (overview + active definition + last 20 runs summary). `404` if
not the caller's.

### `PATCH /api/private/automations/:id`
Edit. Body may include `name`, `description`, `timezone`, and/or
`definition`. If `definition` is present and different → validate → create a
**new** `AutomationDefinitionVersion`, bump `activeVersionId`. **Status is
never changed by PATCH.** `200` with the new version number.

### `POST /api/private/automations/:id/activate`
`DRAFT|PAUSED → ACTIVE`. Re-validates the active version. Computes
`nextRunAt`. `200 { status: "ACTIVE", nextRunAt }`. `409` on bad transition.

### `POST /api/private/automations/:id/pause`
`ACTIVE → PAUSED`. `200 { status: "PAUSED" }`.

### `POST /api/private/automations/:id/resume`
`PAUSED → ACTIVE`. Same effect as activate. `200`.

### `POST /api/private/automations/:id/archive`
`DRAFT|ACTIVE|PAUSED → ARCHIVED` (terminal). Runs retained. `200`.
**There is no `DELETE`.** (sprint §13, §20)

### `POST /api/private/automations/:id/duplicate`
Creates a new `DRAFT` automation with a copied active definition (name
suffixed " (copy)"). Subject to the plan limit. `201 { id }`.

---

## 3. Running

### `POST /api/private/automations/:id/run`  ("Run now", sprint §13/§14)
Allowed for `ACTIVE` and `PAUSED` (owner test-run); `409` for `DRAFT` /
`ARCHIVED`. Creates `AutomationRun { trigger: "manual", scheduledFor: null,
requesterId: <owner> }`, drives it inline (bounded by `maxDuration`), returns
immediately with the run id — the client then polls the run detail /
`advance`.
```jsonc
// 202
{ "runId": "arun_…", "status": "QUEUED" }
```
If a run is already `QUEUED|RUNNING` for this automation → `409 RUN_IN_PROGRESS`
with `{ runId }` of the active run.

### `GET /api/private/automations/:id/runs`
Paginated run history for one automation. `?limit` (≤ 50, default 20),
`?cursor`. Each item: `{ id, status, trigger, startedAt, completedAt,
durationMs, creditsUsed, stepCount, outputRef }`.

### `GET /api/private/automation-runs/:id`
**Run Detail** (sprint §16). `404` if not the caller's.
```jsonc
// 200
{ "run": {
    "id": "arun_1042", "automationId": "aut_…", "automationName": "Gold Morning Intelligence",
    "definitionVersion": 3,
    "status": "SUCCEEDED", "trigger": "schedule",
    "startedAt": "2026-10-06T03:00:00Z", "completedAt": "2026-10-06T03:00:14Z",
    "durationMs": 14000, "creditsUsed": 18,
    "steps": [
      { "index": 0, "stepId": "s1", "kind": "agent_run", "status": "OK",
        "label": "Gold Market Intelligence", "durationMs": 9000, "creditsUsed": 12,
        "agentRunId": "agr_…", "outputRef": { "kind": "agent_run", "runId": "agr_…" } },
      { "index": 1, "stepId": "s2", "kind": "condition", "status": "OK",
        "label": "Confidence check", "output": { "left": 78, "op": "gte", "right": 75, "result": true } },
      { "index": 2, "stepId": "s3", "kind": "agent_run", "status": "OK",
        "label": "Gold Research", "durationMs": 5000, "creditsUsed": 0, "agentRunId": "agr_…" },
      { "index": 3, "stepId": "s4", "kind": "publication_draft", "status": "OK",
        "label": "Create publication draft", "creditsUsed": 6, "articleId": "art_…" },
      { "index": 4, "stepId": "s5", "kind": "workspace_save", "status": "OK",
        "label": "Save to Workspace", "artifactId": "aa_…" }
    ],
    "error": null,
    "contextSnapshot": { /* the final run context */ }
} }
```
Failed run example — steps 0,1 `OK`, step 2 `FAILED`
`{ code: "CREDIT_LIMIT", message: "insufficient credits: need 12, have 4" }`,
steps 3,4 `SKIPPED` (`reason: "prior step s3 failed"`), run `CREDIT_BLOCKED`.
**Failures are never omitted from the `steps` array.**

### `POST /api/private/automation-runs/:id/advance`
Drives one bounded slice of a non-terminal run (mirrors the agent
framework's `runs/:id/advance`). `200 { run, terminal, advanced }`.
For a client watching a long run.

### `POST /api/private/automation-runs/:id/cancel`
Owner only. Sets `cancelRequestedAt`. `200 { status: "RUNNING",
cancelRequested: true }` (or `{ status: "CANCELLED" }` if it was `QUEUED`).
`409` if already terminal.

---

## 4. Dispatch (scheduler)

### `GET /api/private/automations/cron/dispatch?slot=<slotId>`
**Auth:** `isValidCronSecret(req)` (constant-time `Bearer <CRON_SECRET>`)
**OR** `requireAdmin(...)`. Never a plain logged-in user. Exact precedent:
`app/api/private/admin/intelligence/ingest-news/route.ts`.

`maxDuration = 60`. Behaviour = `AUTOMATION_ARCHITECTURE.md §4.3`
(catch-up pass, then bounded batch of due automations).
```jsonc
// 200
{ "slot": "0830_IST", "now": "2026-10-06T03:00:01Z",
  "resumed": 1, "dispatched": 4, "skipped": [{ "automationId": "aut_…", "reason": "run_in_progress" }],
  "durationMs": 41231 }
```
GET is Vercel Cron's only method; a POST alias is provided for a non-Vercel
scheduler (PENDING-2 option c).

### `vercel.json` additions (PENDING-2 = "preset slots")
```jsonc
{ "crons": [
  { "path": "/api/private/admin/intelligence/evaluate-outcomes", "schedule": "0 2 * * *" },
  { "path": "/api/private/admin/intelligence/ingest-news",        "schedule": "0 6 * * *" },
  { "path": "/api/private/automations/cron/dispatch?slot=0800_IST", "schedule": "30 2 * * *" },
  { "path": "/api/private/automations/cron/dispatch?slot=0830_IST", "schedule": "0 3 * * *" },
  { "path": "/api/private/automations/cron/dispatch?slot=0900_IST", "schedule": "30 3 * * *" },
  { "path": "/api/private/automations/cron/dispatch?slot=1800_IST", "schedule": "30 12 * * *" }
] }
```
All entries daily → Hobby-plan legal (each is `* * *` on day-of-month /
month / day-of-week). **Do not add a sub-daily entry** — it silently blocks
every main deployment (prior incident, PR #34).

---

## 5. Templates (sprint §17/§18)

### `GET /api/private/automations/templates`
Static list from `config/automation-templates.ts` (not a DB table). Each:
`{ id, name, description, definition }` (a ready-to-use §4 JSON).

### `POST /api/private/automations/from-template`
Body `{ templateId, overrides?: { name?, timezone?, symbol? } }`. Server
loads the template `definition`, applies the whitelisted overrides
(symbol is substituted into `agent_run.action.input.symbol` fields only),
validates, creates a `DRAFT` automation. `201 { id }`. **Creates a real
configuration — never a demo run** (sprint §17).

Beta templates: `daily-market-brief`, `gold-morning-intelligence`,
`research-publication-monitor`.

---

## 6. Error model

Uses the platform `ApiResponse.error` envelope. Codes:

| HTTP | code | when |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | no session (or bad cron secret on the dispatch route) |
| 403 | `PLAN_LIMIT_REACHED` | create/duplicate over `maxAutomations` |
| 404 | `NOT_FOUND` | `:id` not owned by caller (no existence leak) |
| 409 | `INVALID_STATE_TRANSITION` | lifecycle transition not allowed (payload: `from`, `to`) |
| 409 | `RUN_IN_PROGRESS` | manual run while one is `QUEUED|RUNNING` (payload: `runId`) |
| 422 | `VALIDATION` | bad `definition` (payload: `issues: [{ path, message }]`) |
| 429 | `RATE_LIMITED` | > N manual runs/min per user (reuse platform limiter if present) |
| 500 | `INTERNAL` | unhandled |

---

## 7. Security checklist (sprint §11) — how each item is met

| Requirement | Mechanism |
| --- | --- |
| authentication | `getUserOrNull()` on every private route; `401` if absent |
| authorization | every query/mutation filtered by `userId = session.profile.id` |
| owner/requester isolation | `:id` routes 404 for non-owners; `AutomationRun.userId` + `requesterId` recorded |
| server-side ownership checks | done in the service layer before any work, not in the client |
| protected mutations | activate/pause/resume/archive/run/cancel all re-check ownership + current state server-side |
| no client-trusted user IDs | `userId` never read from body/query anywhere; grep-enforced in `validate-automation-security.ts` |
| no cross-user automation access | covered by the 404 rule; asserted by security tests (user A vs user B) |
| no unauthorized Agent execution | child `AgentRun.userId = automation.userId`; the agent framework's `authorization-service` applies the owner's permissions + autonomy ceiling to every tool call; `live_execution` stays denied-by-default |
| no unauthorized publication | `publication_draft` step calls `articleService.createDraft` only — no publish/schedule/approve path exists in automation code |
| no credit bypass | all spend goes through `CreditLedger.charge` on the **owner's** allowance; insufficient → `CREDIT_BLOCKED`; automation has no ledger write of its own |
| dispatch route abuse | `CRON_SECRET` constant-time check, never "accept anyone" when unset; admin fallback only |
| plan limits | `maxAutomations` enforced on create/duplicate |

---

## 8. Route ↔ sprint §21 mapping

| Sprint §21 conceptual | AT24 route |
| --- | --- |
| `GET /api/automations` | `GET /api/private/automations` |
| `POST /api/automations` | `POST /api/private/automations` |
| `GET /api/automations/:id` | `GET /api/private/automations/:id` |
| `PATCH /api/automations/:id` | `PATCH /api/private/automations/:id` |
| `POST /api/automations/:id/run` | `POST /api/private/automations/:id/run` |
| `POST /api/automations/:id/pause` | `POST /api/private/automations/:id/pause` |
| `POST /api/automations/:id/resume` | `POST /api/private/automations/:id/resume` |
| `POST /api/automations/:id/archive` | `POST /api/private/automations/:id/archive` |
| `GET /api/automations/:id/runs` | `GET /api/private/automations/:id/runs` |
| `GET /api/automation-runs/:id` | `GET /api/private/automation-runs/:id` |
| *(added)* | `POST /api/private/automations/:id/activate` · `/duplicate` · `POST /api/private/automation-runs/:id/advance` · `/cancel` · `GET .../cron/dispatch` · templates ×2 |
