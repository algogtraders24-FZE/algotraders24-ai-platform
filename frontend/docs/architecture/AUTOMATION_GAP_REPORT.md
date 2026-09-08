# AUTOMATION_GAP_REPORT.md — AT24 Automation

**Status:** OPEN — contains 1 P0 architectural conflict that, per sprint §26,
**halts implementation** until the product owner decides
(`AUTOMATION_DECISION.md` PENDING-1). The R&D + design deliverables are
complete; code is not started.

**Sprint rule invoked (§26):** *"If an architectural conflict is discovered,
STOP and document it in `AUTOMATION_GAP_REPORT.md` rather than silently
creating a second competing architecture."*

---

## G1 — [P0] Three overlapping "automation / workflow / run" architectures

### What exists

| # | Models | Sprint | Routes | UI | Real execution? |
| --- | --- | --- | --- | --- | --- |
| A | `Automation { id, userId, name, trigger, enabled }` | 14D | `GET /api/private/automations` (list only) | none | no |
| B | `Workflow` + `WorkflowRun` + `WorkflowQueueItem` + enums `WorkflowTrigger/WorkflowStatus/RunStatus` | 14E | `GET /api/private/workflows` | `/dashboard/automation` (`page.tsx`, `components/automation/*`, `types/automation.ts`, `WorkflowsApi`, `workflowMetrics`) | **no — the UI fabricates run rows client-side (`onRun()` pushes `status:"success"`), metrics computed client-side, `AutomationExecutor`/`AutomationScheduler`/`AutomationRunner` are simulation stubs per `docs/AI-Automation-Architecture.md`** |
| C | `AgentRun` + `AgentStep` + `AgentToolCall` + `AgentEvidence` + `AgentCreditLedgerEntry` + `AgentEvaluation` + full `services/agent-framework/**` | AN A1–A15 | `POST/GET /api/private/agents/framework/runs`, `/runs/:id`, `/runs/:id/advance` | `/dashboard/agents` | **yes — resumable runtime, idempotent credit ledger, immutable evidence, per-tool authorization, observability, 3 runnable agent types** |

### Why it's a conflict

- The sprint's own model (§3) — `Automation` / `AutomationRun` /
  `AutomationStepRun` — collides on the name `Automation` (A) and on the
  concept (B). Adding a fourth set silently would be exactly what §26
  forbids.
- B's `/dashboard/automation` page is the page the sprint says to build
  (§12), but its runs are **mock data**, which the sprint forbids (§12 §27
  §26.7). It cannot be "finished" — it has no server executor to finish.
- C already solves execution, credits, evidence, permissions, cancellation,
  resumability and observability — every hard requirement in sprint §9–§11
  and §16. Rebuilding any of it in an automation-specific way would "fork
  the truth" (AN1.2 §0) and be strictly worse.
- B's `WorkflowRun.log` is a `Json` string array — not the structured,
  per-step, credit-attributed, evidence-linked record sprint §16 mandates.

### Recommended resolution (→ `AUTOMATION_DECISION.md` PENDING-1, option 1)

1. **Canonical model = new `Automation` (v2) + `AutomationDefinitionVersion`
   + `AutomationRun` + `AutomationStepRun` + `AutomationArtifact`** as in
   `AUTOMATION_DATA_MODEL.md`.
2. **`AutomationRun` wraps `AgentRun`.** The actual analysis work, all
   credit spend, all evidence, all tool authorization = the existing
   framework (C), reached only through
   `services/agent-framework/api/agent-run-service`.
3. **Migrate B's `workflows` table** into `automations` +
   `automation_definition_versions` (each `Workflow.steps` → a v1
   `definition`), then drop `workflows`, `workflow_runs`,
   `workflow_queue_items` and their 3 enums.
4. **Drop A** (`model Automation` 14D) — replaced by the v2 table; its one
   route path is reused.
5. **Delete the fake client executor** in `/dashboard/automation`
   (`onRun` optimistic push, client-side metrics) and rebuild the page on
   the real API.
6. Keep the route `/dashboard/automation` and the `components/automation/*`
   directory name (rewrite contents).
7. Update `docs/AI-Automation-Architecture.md` to point at the new docs
   (it currently says "Mock/in-memory only — no DB").

**Alternatives** (also in the DECISION doc): (2) keep B, bolt a real executor
onto `Workflow`/`WorkflowRun` and reference `AgentRun` from
`WorkflowRun` — less schema churn, but keeps two run-history shapes and the
weak `log` field; (3) additive-only, leave A and B dead in the schema — least
work now, permanent confusion later. Recommendation is **option 1**.

**Blocking:** yes. No automation model code is written until this is chosen.

---

## G2 — [P1] No "save result to Workspace" persistence

- `WorkspacePreference` is presentation-only (documented as "never read by
  the AI Intelligence pipeline"). The Workspace research panel
  (`/api/private/intelligence/research`) is a **read-only** view over
  `ResearchSnapshotService`. There is no table representing "an output an
  automation produced and parked for the user".
- **Resolution (new code, not blocking):** `AutomationArtifact` table +
  a Workspace "Automation results" panel that lists the caller's recent
  artifacts. Payload = the child `AgentRun`'s already-safe observability
  output or an `{ articleId }` pointer.
- Scope note: this is a **sink**, not a new Workspace feature. If the owner
  prefers, Beta can ship `workspace_save` as "attach to the automation run
  record only" (visible on Run Detail) and defer the Workspace panel — the
  `workspace_save` step still works, it just surfaces in one fewer place.

---

## G3 — [P1] Hosting plan cannot do arbitrary time-of-day scheduling

- Vercel **Hobby** plan: cron runs **once per day per path**; a sub-daily
  `schedule` in `vercel.json` silently breaks every main deployment (prior
  ~1-day outage, PR #34).
- Therefore "Run on Sep 15 at 08:30 IST" and "Every weekday at 08:30 IST"
  (sprint §5 examples) **cannot** be honoured to the minute for arbitrary
  user-chosen times on the current plan.
- **Resolution options (→ `AUTOMATION_DECISION.md` PENDING-2):**
  - **(a) Preset slots [recommended for Beta]** — 3–6 fixed daily cron
    entries at fixed UTC times; users pick a slot, not a clock. "08:30 IST"
    becomes a named slot backed by a `0 3 * * *` cron. Honest, Hobby-legal,
    zero cost, ships now.
  - **(b) Upgrade to Vercel Pro** — unlocks minute-level cron; ~US$20/mo;
    enables a true `* * * * *` dispatch tick and free time picker. Also
    lifts the once/day limit that has already bitten us once.
  - **(c) External scheduler** — Upstash QStash / GitHub Actions cron /
    cron-job.org posting to `POST /api/private/automations/cron/dispatch`
    with `CRON_SECRET`. Keeps Hobby, adds one external dependency.
- **Blocking:** partially. Implementation can proceed on option (a)'s
  interface (slot registry) immediately; the owner only needs to confirm the
  slot list (PENDING-3) and whether to pursue (b)/(c) post-Beta.

---

## G4 — [P2] No first-party notification channel

- Repo has no email/notification service (only `AnalyticsEvent` and payment
  webhooks). Sprint §6 "Notification: use an existing notification mechanism
  **if available**" — none is.
- **Resolution (scope-trim, not blocking):** Beta "notification" = the
  `AutomationRun` reaching a terminal state, surfaced as an unread badge /
  toast on `/dashboard/automation` and a row in run history. Optional
  `AnalyticsEvent` of type `automation_run_completed`. Email/push/Slack is
  explicitly post-Beta (sprint §24).

---

## G5 — [P2] `docs/AI-Automation-Architecture.md` is stale

- Says "Enterprise workflow automation foundation. Mock/in-memory only — no
  DB, no external APIs." — false since 14E added Prisma models.
- Describes `AutomationEngine` facade + `WorkflowService`/`Executor`/
  `Runner`/`Scheduler`/`Registry` as the design; none of it is wired to real
  work.
- **Resolution:** on PENDING-1 sign-off, replace its body with a pointer to
  `AUTOMATION_ARCHITECTURE.md` + `AUTOMATION_DECISION.md`. Non-blocking.

---

## G6 — [P3] `AgentRunTrigger.event` slot is reserved but unused

- The enum has `event`; the sprint (§24) excludes event/price/indicator/news
  triggers from Beta.
- **Resolution:** none. Documented so a future sprint knows the slot is
  intentional and that `AUTOMATION_DECISION.md`'s post-Beta roadmap owns it.

---

## G7 — [P3] `Agent` (legacy CRUD model) vs framework agent types

- The legacy `model Agent` (`services/agents/*`, `/dashboard/agents` old UI)
  is a frozen compatibility layer (AN1.2 D3). Automation must **not** touch
  it — the "Run an AI Agent" action targets `RUNNABLE_AGENT_TYPES` in the
  **framework** (`agent-run-service`), never a legacy `Agent` row.
- **Resolution:** the API contract already routes only through
  `agent-run-service`; `validate-automation-security.ts` asserts no import
  of `services/agents/*` from `services/automation/**`. Non-blocking.

---

## Summary

| Gap | Severity | Blocks implementation? | Owner decision needed? |
| --- | --- | --- | --- |
| G1 three competing models | **P0** | **YES** | **YES — PENDING-1** |
| G2 no Workspace sink | P1 | no | optional scope call |
| G3 scheduling on Hobby | P1 | interface no / plan choice yes | **YES — PENDING-2, PENDING-3** |
| G4 no notification channel | P2 | no | confirm scope-trim |
| G5 stale doc | P2 | no | no |
| G6 reserved `event` trigger | P3 | no | no |
| G7 legacy Agent model | P3 | no | no |

**Next action:** owner reviews `AUTOMATION_DECISION.md`, resolves PENDING-1/-2/-3,
then implementation begins on the locked architecture.
