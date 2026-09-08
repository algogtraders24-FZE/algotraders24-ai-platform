# AUTOMATION_DECISION.md — AT24 Automation (Beta)

**Sprint:** Automation Foundation & MVP Specification
**Stage:** Decision lock — precedes implementation
**Inputs:** `AUTOMATION_RND.md`, `AUTOMATION_ARCHITECTURE.md`,
`AUTOMATION_EXECUTION_CONTRACT.md`, `AUTOMATION_DATA_MODEL.md`,
`AUTOMATION_API_CONTRACT.md`, `AUTOMATION_TEST_PLAN.md`,
`AUTOMATION_GAP_REPORT.md`; AN1.2 (agent framework locked decisions).
**Status:** 8 decisions PROPOSED · **3 PENDING owner sign-off** ·
implementation NOT started (sprint §26 STOP on the G1 conflict).

> This document is the single source of truth for the Automation Beta. A
> change to any LOCKED decision requires a new dated ADR entry here, never an
> inline code choice.

---

## 0. Core principle (LOCKED)

> **AT24 Automation is the orchestration layer that decides *when*, *how
> often*, and *in what order* to run existing AT24 capabilities — chiefly the
> Agent Framework. It does not analyse markets, call data providers, score
> confidence, generate evidence, or publish. It records what ran and what
> happened.**

```
Market Data → Market Intelligence → Research/Knowledge → AI Agent
   → Automation (WHEN/HOW OFTEN/IN WHAT ORDER)
   → Evidence-backed Result → Publishing / Workspace / Marketplace
```

Automation is **not** a generic task scheduler and **not** Zapier. Its only
reason to exist is to make AT24's verifiable-intelligence loop *repeatable*.

---

## 1. What we are building (Beta)

1. A **canonical Automation model** — `Automation` (v2) with a **versioned**
   workflow definition (`AutomationDefinitionVersion`), executed as
   `AutomationRun` → `AutomationStepRun`, superseding the half-built 14D
   `Automation` and 14E `Workflow` models.
2. A **guided 6-step builder** and a real `/dashboard/automation` page (list,
   metrics from real data, detail, run detail, empty state) — replacing the
   current page whose runs are fabricated client-side.
3. **Four trigger types:** `manual`, `once`, `daily`, `weekly`. Explicit,
   stored, frozen timezone.
4. **Four action/step kinds:** `agent_run` (Research / Market Intelligence /
   Strategy Research), `condition`, `publication_draft`, `workspace_save`.
5. **Deterministic server-side conditions** (`{ left(JSONPath), op, right }`,
   6 operators), recorded in run history.
6. A **preset-slot scheduler** — a small set of fixed daily Vercel cron
   entries dispatch due automations; per-automation time is a named slot.
7. **Credits, evidence, authorization, cancellation, resumability** — reused
   verbatim from the Agent Framework (Sprint AN A1–A15). No reimplementation.
8. **3 templates** producing real configurations.
9. The full `validate-automation-*` test suite (house style, no Vitest) +
   green regression + production smoke.

## 2. Why

- **The loop is the product.** AT24 spent 15+ sprints building
  evidence-backed intelligence and a governed agent framework. Automation is
  the missing verb ("do this every weekday") that turns those capabilities
  into a habit users pay for. It is a thin layer by design.
- **The substrate already exists.** `AUTOMATION_RND.md` shows every hard
  requirement (durable execution, idempotent credits, immutable evidence,
  per-tool permissions, observability, resumable runs) is already shipped and
  tested in `services/agent-framework/**`. Building Automation as an
  orchestrator over it is the smallest reliable foundation (sprint's
  explicit ask: "Do not overbuild").
- **Reliability > features.** Beta deliberately omits branching, event
  triggers, autonomous agents, notifications, and a free-time scheduler so
  that what ships is auditable and correct.

## 3. What we are NOT building (Beta) — LOCKED

- No arbitrary code / expression language / visual programming.
- No branching, loops, parallel steps, sub-automations, fan-out.
- No price / indicator / news / event triggers; no event-bus consumption
  (the `AgentRunTrigger.event` enum slot stays reserved & unused).
- No continuous / autonomous agents — every run is bounded and terminates.
- No new intelligence engine, market-data provider, backtest engine, or
  evidence model.
- No email / SMS / push / Slack / social publishing. Beta notification =
  in-app run record + badge.
- No automation marketplace, no third-party workflow integrations.
- No hard delete; no in-place edit of historical runs.
- No credit *reservation/estimate* stored as if actual (post-Beta).
- Automation never asserts an AI result is "verified" — only "execution
  succeeded".

---

## 4. Architecture decision — **PENDING-1** (owner sign-off required)

**Conflict (see `AUTOMATION_GAP_REPORT.md` G1):** three overlapping models —
14D `Automation`, 14E `Workflow`/`WorkflowRun`, AN `AgentRun`.

| Option | What | Cost | Recommendation |
| --- | --- | --- | --- |
| **1. Supersede** | New `Automation` v2 + versions + `AutomationRun`/`StepRun` wrapping `AgentRun`. Migrate 14E `workflows` → new tables, drop 14D + 14E tables/enums, delete the fake client executor, rebuild `/dashboard/automation`. | 1 additive migration + 1 data migration + drops; UI rebuild (was going to happen anyway). | ✅ **RECOMMENDED** — one canonical model, one run-history shape, reuses C entirely, no dead schema. |
| 2. Extend 14E | Keep `Workflow`/`WorkflowRun`, add a real executor, reference `AgentRun.id` from `WorkflowRun`, upgrade `log` → structured. | Less migration churn. | ❌ keeps a weak `WorkflowRun.log`, keeps enum names that don't match the sprint, two run shapes long-term. |
| 3. Additive-only | Add new tables, leave 14D + 14E in the schema unused. | Least work now. | ❌ permanent "which automation model?" confusion; violates the spirit of §26. |

**Proposed LOCK:** Option 1. Migration is "GENERATED + REVIEWED, NOT APPLIED"
until this sign-off (AN-series precedent).

> **OWNER DECISION (PENDING-1):** ______________________  date: __________

---

## 5. Scheduler decision — **PENDING-2 / PENDING-3**

**Constraint:** Vercel **Hobby** = one cron/day per path; sub-daily schedule
breaks all deploys (prior outage, PR #34). Minute-cron unavailable.

| Option | Beta fit | Recommendation |
| --- | --- | --- |
| **(a) Preset slots** — 3–6 fixed daily cron entries; user picks a named slot ("08:30 IST" = a `0 3 * * *` cron). | Ships now, zero cost, Hobby-legal, honest. | ✅ **RECOMMENDED for Beta.** |
| (b) Vercel **Pro** upgrade — unlocks minute cron + free time picker; ~US$20/mo; also removes the once/day footgun. | Best long-term; a purchase decision. | ▶ recommended **post-Beta** (or now if the owner wants a free time picker at launch). |
| (c) External scheduler (Upstash QStash / GitHub Actions / cron-job.org) → `POST …/cron/dispatch` with `CRON_SECRET`. | Keeps Hobby, adds a dependency + a secret to manage. | fallback if (b) is declined and slots aren't enough. |

**PENDING-2:** choose (a) for Beta with (b) as the post-Beta upgrade? Y / N
**PENDING-3:** confirm the Beta slot list. Proposed (≤ 6):
`0800_IST`, `0830_IST`, `0900_IST`, `1800_IST`.

> **OWNER DECISION (PENDING-2):** ______________________  date: __________
> **OWNER DECISION (PENDING-3):** ______________________  date: __________

**LOCKED regardless of the choice:**
- Timezone is explicit, stored on the definition, defaulted from the account
  tz at creation, then never re-inferred.
- Dispatch route auth = `CRON_SECRET` (constant-time) **or** admin — exact
  `ingest-news` precedent.
- Idempotency: one `AutomationRun` per `(automationId, scheduledFor)` (unique
  index); missed slots use the intended instant; no multi-day back-fill.
- One active run per automation (concurrency guard).
- `maxDuration = 60`; unfinished runs resume via a catch-up pass and/or
  client `advance` — both are pure functions of persisted state.

---

## 6. Execution model — LOCKED

- **Automation status:** `DRAFT → ACTIVE ⇄ PAUSED`, `* → ARCHIVED` (terminal).
  Invalid transitions → 409. No hard delete.
- **Run status:** `QUEUED → RUNNING → {SUCCEEDED | FAILED | CONDITION_HALTED
  | CANCELLED | CREDIT_BLOCKED}`. Terminal runs are immutable.
- **Steps:** strict order, sequential, bounded timeout each. A false
  `condition` → `CONDITION_HALTED` (a neutral stop, not an error) + later
  steps `SKIPPED`. A step error → `FAILED` + later steps `SKIPPED`. Failures
  are never omitted from Run Detail.
- **`agent_run` step = one child `AgentRun`** (`trigger: schedule|manual`,
  `userId = automation.userId`), driven via
  `agent-run-service` → `AgentRuntime` (`runToCompletion` / resumable `tick`).
- **Versioning:** every edit writes a new `AutomationDefinitionVersion`;
  every `AutomationRun` hard-links the version it executed; history is
  reproducible and never mutated (sprint §4).
- Full contract: `AUTOMATION_EXECUTION_CONTRACT.md`.

---

## 7. Credit model — LOCKED

- **Automation never holds, reserves, or charges credits.** All spend flows
  through the existing `CreditLedger` (Sprint AN A9) from the child
  `AgentRun`s, against the **owner's** `PLAN_LIMITS[plan].aiCredits`
  allowance.
- Idempotency: automation-scoped keys
  `auto:<automationRunId>:<stepIndex>:<childStepIndex>` — a resumed dispatch
  never double-charges (the ledger's unique-key no-op).
- Failure accounting is deterministic: charges for work that actually
  happened **stand**; **no automatic refund** in Beta.
- Insufficient credits → child run terminates `credit_limit` → step `FAILED`
  (`CREDIT_LIMIT`) → run `CREDIT_BLOCKED`; completed steps keep their real
  cost; no later steps run.
- `AutomationRun.creditsUsed` ≡ Σ `AutomationStepRun.creditsUsed` ≡
  Σ underlying `AgentCreditLedgerEntry`. No estimate is ever persisted as
  actual.
- `maxAutomations` per plan (free 2 / pro 25 / elite 100) enforced on
  create/duplicate.

---

## 8. Security model — LOCKED

- Session auth on every `automations/**` and `automation-runs/**` route;
  `userId` = `sessionUser.profile.id`, **never** from body/query (grep-
  enforced by a security test).
- Ownership checked server-side before any work; non-owner `:id` → **404**
  (no existence leak), matching `getRunObservability`.
- The child `AgentRun` carries the owner's `userId`, so the framework's
  `authorization-service` applies the owner's tool permissions + autonomy
  ceiling to every call. **Automation cannot widen a grant** and cannot
  enable `live_execution` (denied by default).
- Publication steps call `articleService.createDraft` **only** — no code
  path to publish/schedule/approve.
- Cron dispatch: constant-time `CRON_SECRET`; never "accept anyone" when the
  secret is unset.
- Full checklist: `AUTOMATION_API_CONTRACT.md §7`, tests:
  `validate-automation-security.ts`.

---

## 9. Agent integration contract — LOCKED

- Automation reaches agents **only** through
  `services/agent-framework/api/agent-run-service` (`startAgentRun`,
  `advanceAgentRun`, `listAgentRuns`). It does **not** import
  `runtime/*`, `credits/*`, `tools/*` directly (preserves AN1.2 G14 locks).
- Runnable agent types in Beta: `RESEARCH`, `MARKET_INTELLIGENCE`,
  `STRATEGY_RESEARCH` (`RUNNABLE_AGENT_TYPES`).
- Each `agent_run` step: `startAgentRun({ userId: automation.userId,
  agentType, goal: action.input, trigger: "schedule" | "manual" })` → drive
  to terminal → read `getRunObservability(runId, { requesterId:
  automation.userId, … })` for the step output.
- Per-run limits (`AgentRun.limits`) are snapshotted at creation as today;
  Automation passes the framework defaults unless a later sprint adds
  per-automation ceilings.
- The child run's immutable trace (`AgentStep`/`AgentToolCall`/
  `AgentEvidence`) is linked from Run Detail — never summarised away.
- Automation must **not** touch the legacy `model Agent` / `services/agents/*`
  / `/dashboard/agents` layer (AN1.2 D3 frozen).

---

## 10. Publishing integration contract — LOCKED

- Automation's only publishing capability is
  `articleService.createDraft(userId, { category, keywords, aiOverviewText })`
  via a `publication_draft` step, producing an `Article` with
  `status: draft` and `sourceType: "research"` (or `"ai"`).
- Automation has **no** path to `publish`, `schedule`, `duplicateAsDraft`, or
  approval. Composition, verification, review, scheduling and distribution
  stay entirely inside Publishing and its permissions (sprint §19).
- A published `Article` is read-only (existing service guarantee) — a later
  automation run cannot mutate it.
- The four states stay distinct and Automation only ever asserts the first
  (sprint §20):
  `execution_succeeded ≠ analysis_verified ≠ publication_approved ≠ publication_published`.

---

## 11. Beta acceptance criteria (from sprint §23) — how each is met

| Criterion | Met by |
| --- | --- |
| `/dashboard/automation` functional | rebuilt page on the real API (§1.2) |
| user can create an automation | `POST /automations` + guided builder |
| user can manually run it | `POST /automations/:id/run` |
| user can schedule it | `once`/`daily`/`weekly` triggers + preset slots |
| daily/weekly scheduling works | slot cron dispatch + `dueForSlot` + `daysOfWeek` |
| timezone is explicit | `Automation.timezone` + `definition.trigger.timezone`, frozen |
| Agent can be executed by Automation | `agent_run` step → child `AgentRun` |
| conditions work | server-side `ConditionEval`, recorded in run history |
| credits correctly accounted | reused A9 ledger; `creditsUsed` ≡ Σ ledger |
| failed runs visible | Run Detail always includes failed steps + reasons |
| run history inspectable | `AutomationRun`/`AutomationStepRun` + detail routes |
| permissions enforced | 404 isolation + framework authorization on child runs |
| duplicate execution prevented | `(automationId, scheduledFor)` unique index |
| historical workflow versions auditable | `AutomationDefinitionVersion` + hard FK from runs |
| no mock metrics/data | page metrics computed from real `AutomationRun` rows; empty state for new users |
| existing regression passes | `AUTOMATION_TEST_PLAN.md §4` |
| production build passes | `npm run build` in CI |
| deployment succeeds | `vercel.json` stays all-daily; migration via `migrate deploy` |
| production smoke passes | `scripts/smoke-automation.mjs` (`AUTOMATION_TEST_PLAN.md §5`) |

**P0 acceptance items still open:** PENDING-1 (model), PENDING-2/-3
(scheduler) — until resolved, Beta readiness is **NO-GO**.

---

## 12. Post-Beta roadmap

| Theme | Item |
| --- | --- |
| Scheduler | Vercel Pro upgrade → minute-cron + free time-of-day picker; multi-day missed-run back-fill policy |
| Triggers | `once`-after-event, price/indicator/regime-change triggers via a real event bus consuming `AgentRunTrigger.event` |
| Credits | pre-run credit **reservation** + estimate; automatic refund on partial failure; pool unification with the `aiMessages` entitlement |
| Reliability | automatic whole-automation retry with backoff; dead-letter view; per-automation limit ceilings |
| Actions | knowledge-write step (gated), multi-agent supervisor step, notification step (email/Slack) once a channel exists |
| Workflow | simple branching (if/else), a second condition operator set (contains, between), templated inputs |
| UX | Workspace "Automation results" as a first-class panel with filters; run diff between definition versions |
| Distribution | shareable automation templates within an org (still not a public marketplace) |

---

## 13. Final sprint status (to be completed at implementation end)

```
AUTOMATION R&D:      PASS
ARCHITECTURE:        NOT LOCKED  (PENDING-1)
DATA MODEL:          PASS (proposed; locks with PENDING-1)
API CONTRACT:        PASS (proposed)
UI:                  NOT STARTED
SCHEDULER:           NOT LOCKED  (PENDING-2/-3)
AGENT INTEGRATION:   PASS (contract locked, §9)
CREDITS:             PASS (contract locked, §7)
SECURITY:            PASS (contract locked, §8)
TESTS:               0 / ~18 planned  (AUTOMATION_TEST_PLAN.md)
REGRESSION:          NOT RUN
PRODUCTION:          NOT DEPLOYED
SMOKE TEST:          NOT RUN

BETA READINESS:      NO-GO  — blocked on PENDING-1, PENDING-2, PENDING-3.
```

Implementation starts when PENDING-1/-2/-3 are signed off above.
