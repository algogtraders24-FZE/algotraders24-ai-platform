# AUTOMATION_RND.md — AT24 Automation: R&D Pass

**Sprint:** Automation Foundation & MVP Specification
**Stage:** Mandatory R&D (precedes any implementation)
**Beta target:** 1 October 2026
**Status of this document:** R&D COMPLETE — findings feed `AUTOMATION_ARCHITECTURE.md`, `AUTOMATION_DECISION.md`, `AUTOMATION_GAP_REPORT.md`

> **Verdict: AUTOMATION R&D = PASS.** No new execution engine, scheduler
> primitive, credit system, or evidence model needs to be built. Every
> capability the Beta requires already exists in the repo as a shipped,
> tested subsystem. Automation is a thin orchestration + scheduling +
> definition-versioning layer over the **AT24 Agent Framework (Sprint AN
> A1–A15)**. One genuine architectural conflict was found and is escalated
> in `AUTOMATION_GAP_REPORT.md` (three overlapping "workflow/automation"
> models) — it requires an owner decision, captured as PENDING-1 in
> `AUTOMATION_DECISION.md`.

---

## 1. Method

1. Audited the repository first (per sprint §26.1). Enumerated every existing
   model, route, service and doc touching "automation", "workflow", "agent
   run", "schedule", "credit" and "publishing".
2. Mapped each Beta requirement (sprint §5–§20) to an existing AT24
   subsystem. Only requirements with **no** existing owner become new code.
3. Reviewed first-party technical docs for the two areas where the repo has
   no precedent: **durable scheduling on our hosting plan** and
   **idempotent scheduled dispatch**.
4. Did **not** adopt any third-party workflow architecture (Temporal,
   Inngest, Trigger.dev, n8n, Zapier) wholesale. Their durable-execution
   *principles* are used as a checklist; their runtimes are not introduced.

---

## 2. What already exists in the repo (the reuse surface)

### 2.1 Execution substrate — `services/agent-framework/` (Sprint AN)

| Capability | Where | Reuse for Automation |
| --- | --- | --- |
| Resumable, bounded run engine | `runtime/agent-runtime.ts` — `startRun()` persists a `queued` run; `tick()` executes **one** bounded slice and persists; `runToCompletion(runId,{maxTicks})` loops `tick()` for the synchronous path | An automation "Run an agent" step **is** an `AgentRun`. No second runtime. |
| Run persistence + immutable trace | `AgentRun` / `AgentStep` / `AgentToolCall` / `AgentEvidence` (schema L1476–1669) | Automation adds a parent `AutomationRun` that **references** child `AgentRun`s; it does not duplicate step/evidence tables. |
| Trigger vocabulary | `enum AgentRunTrigger { manual, schedule, event, supervisor }` (schema L1493) — `schedule` is **already defined and unused** | Scheduled automations start their child `AgentRun` with `trigger = "schedule"`. Zero migration. |
| Limit enforcement | `runtime/limit-enforcer.ts` — wall-clock / step / tool-call / retry / credit ceilings, snapshotted on the run at creation (`AgentRun.limits`) | Automation sets per-run limits when it calls `startRun`; nothing new. |
| Authorization | `authorization/authorization-service.ts` — per-tool permission + autonomy-ceiling checks, `live_execution_denied` by default | Automation cannot widen this: the child `AgentRun` carries the **requester's** `userId`, so every tool call is checked exactly as an interactive run. |
| Output integrity | `integrity/output-integrity.ts`, `integrity/evidence-lineage.ts` — a conclusion citing a fact with no evidence row fails | Preserves the "execution succeeded ≠ analysis verified" boundary (sprint §20) for free. |
| Observability read model | `evaluation/observability.ts` — `getRunObservability(runId, { requesterId, ... })`, **ownership-scoped** (returns `null` if the run is not the requester's) | Automation Run Detail (sprint §16) renders this per child `AgentRun`. |
| API-facing seam | `api/agent-run-service.ts` — `startAgentRun` / `advanceAgentRun` / `listAgentRuns`; `userId` is **always** the server session, never a body value | Automation dispatcher calls this module, not the runtime directly. |
| Runnable agent types | `RUNNABLE_AGENT_TYPES = ["RESEARCH", "MARKET_INTELLIGENCE", "STRATEGY_RESEARCH"]` | These are the Beta "Run an AI Agent" action targets. |

### 2.2 Credits — `services/agent-framework/credits/` (Sprint AN A9)

- `CreditLedger` (`credit-ledger.ts`): `balance()` recomputed fresh every call
  (`allowance − Σ ledger`); `charge()` is **atomic + idempotent** on a unique
  `idempotencyKey`; `refund()` is a signed negative entry; `historyForRun()`
  is the per-run audit.
- `AgentCreditLedgerEntry` (schema L1770): append-only, immutable, unique
  `idempotencyKey`, `periodStart` denormalised for period-sum queries.
- `AgentRunStatus` includes `credit_limit` — a first-class terminal state for
  "ran out of credits mid-run".
- Allowance = `PLAN_LIMITS[plan].aiCredits` (`config/plan-limits.ts`):
  free 500 / pro 10 000 / elite 50 000 per calendar month.
- **Finding:** the double-charge guard the sprint §9 asks for is already the
  design centre of A9. Automation adds nothing to the ledger; it reuses
  `charge`/`refund` with automation-scoped `idempotencyKey`s.

### 2.3 Actions — existing capability owners

| Beta action (sprint §6) | Existing owner | Integration path |
| --- | --- | --- |
| Run Market Intelligence | `services/agent-framework/tools/impl/market-intelligence.tool.ts` + `MARKET_INTELLIGENCE` agent | as an `AgentRun` (agentType `MARKET_INTELLIGENCE`) |
| Run AI Research | `RESEARCH` agent (`agents/research-agent.ts`), `research-knowledge-search.tool.ts`, `news-search.tool.ts` | as an `AgentRun` (agentType `RESEARCH`) |
| Run an AI Agent | `agent-run-service.startAgentRun` | direct |
| Search / retrieve AT24 Knowledge | `research-knowledge-search.tool.ts` (already a registry tool) | **only** via an agent step — no standalone "knowledge action" for Beta |
| Save result to Workspace | *(gap — see §4.2)* | new: `AutomationArtifact` row + Workspace "Automation results" panel |
| Create a publication draft | `services/publishing/article.service.ts` → `articleService.createDraft(userId, { category, keywords, aiOverviewText })`; `Article` model, `ArticleStatus { draft, scheduled, published, failed }`; **published rows are read-only** | new: `automation.publication` step calls `createDraft` — never `publish` |
| Notification | *(gap — see §4.3)* | Beta: in-app only, reuse `AnalyticsEvent` + a Run record; no email in Beta |

### 2.4 Scheduling / cron precedent

- `vercel.json` currently has **two** cron entries, both **daily**
  (`0 2 * * *` evaluate-outcomes, `0 6 * * *` ingest-news).
- Cron auth: `lib/intelligence/cron-auth.ts` — `isValidCronSecret(req)` does a
  constant-time `Bearer <CRON_SECRET>` check; accepts Vercel's native
  `CRON_SECRET` injection. Route pattern (`admin/intelligence/ingest-news`):
  **cron secret OR authenticated admin**, both calling the same service fn.
- **Hosting constraint (confirmed, load-bearing):** the project is on the
  Vercel **Hobby** plan. Hobby crons are limited to **once per day per cron
  path**. A sub-daily `schedule` in `vercel.json` silently blocks *all* main
  deployments (this already caused a ~1-day production outage, fixed in
  PR #34). **A minute-resolution scheduler tick is not available on the
  current plan.** This is the single biggest constraint on the Beta
  scheduler and is treated fully in `AUTOMATION_ARCHITECTURE.md §4` and
  escalated as PENDING-2 in `AUTOMATION_DECISION.md`.

### 2.5 API / platform conventions

- Route handlers: `withContext(async (req, ctx) => …)` from
  `services/backend/Middleware`; responses via `ApiResponse.success/​error`
  with `ctx.requestId` / `ctx.startedAt`; validation errors via
  `Errors.validation(...)`.
- Auth: `getUserOrNull()` → `sessionUser.profile.id`. **`userId` is never
  read from a request body** anywhere in `app/api/private/**` (explicit lock
  in the agent-framework routes).
- Data access: `RepositoryFactory` with a mock/Prisma dual mode; Prisma repos
  extend `PrismaBaseRepository`.
- Serverless bound: routes that do work export `export const maxDuration = 60`.
- Tests: **no Vitest** (AN1.2 D2). Every subsystem ships
  `scripts/validate-*.ts` — a standalone `node:assert/strict` harness run via
  `tsx`, plus a `validate:*` entry in `package.json`. Automation follows this
  exactly (`validate-automation-*.ts`).
- Migrations: `prisma/migrations/*` timestamped dirs. **Trap:**
  `prisma migrate dev` resets the pgvector extension on this DB — migrations
  are applied with `prisma migrate deploy` against a prepared migration SQL,
  never `migrate dev` on a shared DB.

### 2.6 The half-built automation surface (must be reconciled, not extended)

| Artefact | Sprint | State |
| --- | --- | --- |
| `model Automation { id, userId, name, trigger, enabled }` | 14D | Minimal. `PrismaAutomationRepository` + `GET /api/private/automations` (list only). No runs, no executor. |
| `model Workflow` / `WorkflowRun` / `WorkflowQueueItem` + `enum WorkflowTrigger/WorkflowStatus/RunStatus` | 14E | `PrismaWorkflowRepository`, `GET /api/private/workflows`, UI at `/dashboard/automation` (`page.tsx` + `components/automation/*`), `types/automation.ts`, `services/api/WorkflowsApi.ts` + `workflowMetrics.ts`. |
| `/dashboard/automation` UI behaviour | 14E | **Runs are faked.** `onRun()` pushes an optimistic `status: "success"` run **client-side only**; metrics computed client-side; `steps` JSON is `{ id, actionId, label }` with no executor wired to any real action. |
| `docs/AI-Automation-Architecture.md` | 14D/E | States "Mock/in-memory only — no DB". Stale: DB models now exist. Describes `AutomationExecutor` / `AutomationScheduler` / `AutomationRunner` as **simulation stubs**. |

**These three models (`Automation`, `Workflow`, `AgentRun`) are the
architectural conflict.** Resolution is proposed in
`AUTOMATION_ARCHITECTURE.md` and requires owner sign-off
(`AUTOMATION_DECISION.md` PENDING-1).

---

## 3. Durable-execution best practice → what AT24 Beta actually needs

Checklist distilled from first-party durable-workflow documentation
(Temporal "workflow determinism & idempotency", AWS Step Functions "at-least-
once & idempotent tasks", Google Cloud Tasks "deduplication", Vercel Cron
"delivery semantics"). For each: does AT24 already satisfy it, and what is the
Beta-minimal answer.

| Principle | Beta-minimal AT24 answer | Already have it? |
| --- | --- | --- |
| **Scheduled workflows** | 1–4 fixed daily UTC cron slots dispatch due automations; per-automation time is a preset aligned to a slot (not a free clock). | Cron mechanism ✅ / preset-slot model ❌ (new) |
| **Durable job execution** | Reuse `AgentRuntime` — already resumable from the DB row across serverless invocations. | ✅ |
| **Idempotency** | (a) One `AutomationRun` per (automationId, scheduledFor) — unique constraint. (b) Credit charges keyed by `auto:<runId>:<stepIndex>`. | credit idempotency ✅ / run-level dedup ❌ (new unique index) |
| **Retries** | Beta = **no automatic retry of a whole automation**. A failed run is terminal + visible; the user re-runs manually. Within a child `AgentRun`, the runtime's existing bounded retry (`retriesUsed`) applies to transient tool errors only. | ✅ (agent-level) / deliberately-omitted (automation-level) |
| **Failure handling** | Step fails → `AutomationStepRun.status = failed` + reason; run → `failed`; later steps `skipped`. Never hidden (sprint §16). | pattern ✅ / new rows ❌ |
| **Job cancellation** | `AgentRunStatus.cancelled` exists. Beta: `POST /automation-runs/:id/cancel` sets a cancel flag the dispatcher checks between steps and asks the child `AgentRun` to stop at its next `tick()` boundary. | enum ✅ / cooperative-cancel wiring ❌ (new, small) |
| **Concurrency** | Beta: **one active run per automation** (DB guard). Global dispatch fan-out is bounded by the cron handler processing a capped batch per invocation. | ❌ (new guard) |
| **Execution history** | `AutomationRun` + `AutomationStepRun` list, immutable. | pattern ✅ / new rows ❌ |
| **Auditability** | Child `AgentRun` trace + evidence + credit ledger already immutable & queryable; `AutomationRun` links them. | ✅ |
| **Permissions** | Child `AgentRun` carries requester `userId` → existing per-tool authorization is unbypassable. Automation CRUD is owner-scoped like every other private route. | ✅ |
| **Usage / credit accounting** | `CreditLedger.charge/refund` with automation-scoped idempotency keys; `AutomationRun.creditsUsed = Σ child ledger entries`. | ✅ |

**Conclusion:** the only genuinely new mechanisms are (1) the definition +
version model, (2) the preset-slot scheduler + dispatcher, (3) run-level
idempotency/concurrency guards, (4) cooperative cancel, (5) the
Workspace-artifact sink. Everything else is composition of shipped parts.

---

## 4. Gaps found (detail in `AUTOMATION_GAP_REPORT.md`)

### 4.1 Architectural conflict — three "workflow" models (P0, owner decision)
`Automation` (14D) vs `Workflow`/`WorkflowRun` (14E) vs `AgentRun` (AN).
The 14E UI at `/dashboard/automation` shows fabricated runs. Per sprint §26,
implementation STOPS here pending the owner's choice between the three
resolution options in `AUTOMATION_DECISION.md` PENDING-1. Recommended:
**supersede both 14D/14E models with an Automation entity whose runs wrap
`AgentRun`s**, migrate the 14E table, delete the fake client executor.

### 4.2 No "save to Workspace" sink (P1, new code)
`WorkspacePreference` is presentation-only; the Workspace research panel is a
read-only view over `ResearchSnapshotService`. There is no table for "a
result an automation produced". New: `AutomationArtifact` (runId, kind,
title, payload ref, createdAt) + a Workspace "Automation results" panel.

### 4.3 No first-party notification mechanism (P2, scope-trim)
No email/notification service in the repo (only `AnalyticsEvent` +
Stripe/NOWPayments webhooks). Beta "Notification" action = in-app only: the
`AutomationRun` completing **is** the notification, surfaced by an unread
badge on `/dashboard/automation`. Email/push is explicitly post-Beta
(sprint §24 "advanced notification integrations").

### 4.4 Hosting plan blocks true time-of-day scheduling (P1, owner decision)
See §2.4. Beta options in `AUTOMATION_DECISION.md` PENDING-2:
(a) preset slots on 1–4 daily Hobby crons [recommended];
(b) upgrade to Vercel Pro for minute-cron;
(c) external scheduler (Upstash QStash / GitHub Actions / cron-job.org)
posting to a secret dispatch route.

### 4.5 `AgentRunTrigger.event` + a real event bus (out of scope — confirmed)
The enum has `event`, but the sprint (§24) explicitly excludes price/
indicator/news/event triggers from Beta. No work; noted so a future sprint
knows the enum slot is reserved.

---

## 5. R&D outcome

- **New execution engine required?** No.
- **New scheduler primitive required?** Only a preset-slot dispatcher over
  existing cron; no cron *engine*.
- **New credit system required?** No — reuse A9 ledger verbatim.
- **New evidence/audit model required?** No — reuse `AgentEvidence` +
  `AgentStep` + `AgentCreditLedgerEntry`.
- **New persistence?** Yes, minimal: `Automation` (v2), `AutomationRun`,
  `AutomationStepRun`, `AutomationArtifact` + enums. Detailed in
  `AUTOMATION_DATA_MODEL.md`.
- **Blocking decisions for the owner:** PENDING-1 (model reconciliation),
  PENDING-2 (scheduler on Hobby plan). Both in `AUTOMATION_DECISION.md`.

**AUTOMATION R&D: PASS** — proceed to architecture lock, then STOP for the two
PENDING sign-offs before writing implementation code.
