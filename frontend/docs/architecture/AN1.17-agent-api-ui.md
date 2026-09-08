# AN1.17 — Agent API / UI integration (A15)

**Sprint:** AT24 AI Agents — Agent Framework Foundation
**Step:** A15 — wire `/dashboard/agents` to the real A1–A14 framework
**Depends on:** A1–A14 (complete, G01–G14 accepted)
**Gate:** G15 — review requested. **The final architecture gate before the framework is user-facing.**
**Migration:** **none**.

---

> **A15 adds a thin API seam + a real run console. It reimplements no
> runtime, planner, authorization, credit or integrity logic** — it selects
> a canonical agent definition and delegates to the shared `agentRuntime`,
> reading state back through the A14 ownership-scoped observability model.
> Every value the UI shows is persisted state. The legacy `/dashboard/agents`
> scaffold and `services/agents/*` are untouched.

---

## 1. What was built

| File | Role | LOC |
|---|---|---|
| `services/agent-framework/api/agent-run-service.ts` | **NEW.** The API-facing seam: `listRunnableAgentTypes()`, `startAgentRun({userId, agentType, goal})` (queues only), `advanceAgentRun(userId, runId)` (one `tick()`), `getAgentRun(userId, runId)`, `listAgentRuns(userId)`. All ownership-scoped; pure delegation. | ~180 |
| `app/api/private/agents/framework/runs/route.ts` | `GET` the user's runs + runnable types; `POST` start a run → `202 { runId, status: "queued" }`. | ~65 |
| `app/api/private/agents/framework/runs/[id]/route.ts` | `GET` one run's full observability model, ownership-scoped (non-owner → same 404 as nonexistent). | ~35 |
| `app/api/private/agents/framework/runs/[id]/advance/route.ts` | `POST` → one bounded `tick()` + return the updated model; no-op if terminal. | ~40 |
| `app/dashboard/agents/runs/page.tsx` | **NEW route.** The real run console — pick a type, enter a goal, watch the run advance one bounded slice at a time, see the real timeline / tool calls / evidence / output / evaluation / credits. | ~290 |
| `scripts/validate-agent-api.ts` | G15 proof — 9 tests. | ~200 |

**Modified (additive only):**

```
services/agent-framework/runtime/agent-run.repository.ts   + listRunsForUser(userId, limit)
services/agent-framework/runtime/agent-runtime.ts          creditLedger + evaluation are readonly (were private) so the
                                                          observability model reads from the same instances the run wrote
scripts/validate-agent-{research,strategy-research}.ts     "no new infra dir" assertion loosened to a subset+allowlist check
                                                          (A15 legitimately added services/agent-framework/api/)
package.json                                               + validate:agent-api
```

**Not touched:** `app/dashboard/agents/page.tsx`, `services/agents/*`, the
legacy `agents/route.ts` CRUD, every A1–A14 module, the schema. No migration,
no LLM call from a route.

---

## 2. The bounded, resumable request model (owner G14 lock 6–7)

```
POST  /api/private/agents/framework/runs                 -> 202 { runId, status: "queued" }   (startRun only; no execution)
GET   /api/private/agents/framework/runs/:id             -> the observability model            (pure read, ownership-scoped)
POST  /api/private/agents/framework/runs/:id/advance     -> one agentRuntime.tick() + model    (exactly one persisted slice)
```

The client loop is: `POST /runs` → then `POST …/advance` until the response
says `{ terminal: true }`, rendering the model after each step. **No request
runs a whole agent.** `startRun` persists a `queued` row and returns; each
`advance` executes one `tick()` — plan, or one tool call, or output+integrity
— then checkpoints and returns. This is the same resumable primitive a
scheduler would drive across serverless invocations; the UI just drives it
from the browser.

---

## 3. Security posture (owner G14 locks 3–4)

| lock | enforcement |
|---|---|
| `userId` from the server session, never the body | routes call `getUserOrNull()` → `sessionUser.profile.id` and pass it as the *argument*; `goal` is parsed separately. **Test:** `startAgentRun({ userId: A, goal: { userId: B, … } })` → the run belongs to **A**. |
| every requester-facing read is ownership-scoped | `getAgentRun` → `getRunObservability(runId, { requesterId })`; `advanceAgentRun` → `agentRunRepository.getRunForUser(runId, userId)` before any tick. **Test:** user B cannot read, advance, or list user A's run — non-owner gets the same `null`/404 as a nonexistent run (no existence leak). |
| no duplicate runtime/planner/authz in API/UI | **Structural test:** neither the routes nor the service import `new AgentRuntime`, `SupervisorService`, `authorization-service`, `tool-gateway`/`invokeTool`, `output-integrity`, or `@/lib/ai`. The service imports exactly one thing that executes: the shared `agentRuntime` singleton. |
| no fake progress / results | the UI renders only fields from the API's observability model — `steps`, `toolCalls`, `evidence`, `run.output`, `evaluation`, `credits`. There is no client-side simulation. |
| no live trading | A15 adds no execution capability; the three runnable agents are all autonomy-1 decision-support (A11–A13), and `LIVE_EXECUTION` stays double-denied by A8. |

---

## 4. Runnable agents

`listRunnableAgentTypes()` exposes exactly the three types with a real
canonical definition + specialist: **RESEARCH**, **MARKET_INTELLIGENCE**,
**STRATEGY_RESEARCH**. The other `AGENT_TYPE_REGISTRY` entries (RISK,
BACKTEST_OPTIMIZATION, …) are declared but not startable — `startAgentRun`
rejects them with `UnknownAgentTypeError` ("registered but has no runnable
definition yet"), distinct from an unknown type.

---

## 5. G15 proof — `npm run validate:agent-api` → **9 passed, 0 failed**

| test | verdict |
|---|---|
| runnable types = exactly the 3 real agents, each with label / description / tools / goal hint / autonomy cap 1 | ✅ |
| unknown & not-yet-runnable types rejected with a clear, distinct message | ✅ |
| `startAgentRun` creates a **`queued`** run (0 steps — no execution) with the canonical definition snapshot | ✅ |
| a `userId` inside the goal body is **ignored** — the run belongs to the caller's id | ✅ |
| `advanceAgentRun` — one bounded slice per call (≤ 3 new steps/advance), reaches terminal within a bounded number of advances, then a no-op (`advanced: false`) | ✅ |
| **ownership** — user B cannot read, advance, or list user A's run; A can | ✅ |
| `getAgentRun` returns real persisted state — `run / steps / toolCalls / evidence / credits / evaluation / timeline`, cross-checked against the raw trace | ✅ |
| structural — routes auth via `getUserOrNull` + `sessionUser.profile.id`, never a body `userId`; routes + service import no second runtime / planner / authorizer / LLM | ✅ |

### 5.1 Full regression

`validate:agent-contracts` 38/0 · `-tools` 20/0 · `-run-persistence` 17/0 ·
`-runtime` 9/0 · `-supervisor` 11/0 · `-integrity` 21/0 · `-memory` 19/0 ·
`-authorization` 17/0 · `-credit` 13/0 · `-evaluation` 9/0 · `-research` 9/0 ·
`-market-intelligence` 8/0 · `-strategy-research` 8/0 · `-hardening` 18/0 ·
`-api` **9/0**.

**Total: 226 tests, 0 failing.** `validate:agent-parallel` still clean.

---

## 6. TypeScript

`npx tsc --noEmit`: **0 errors** in the A15 code (routes, service, page,
script). Repo-wide the only errors remain in the stale generated
`.next/dev/types/validator.ts`.

The run console page (`/dashboard/agents/runs`) is a `"use client"` route
behind the dashboard auth gate; it compiles clean and renders its shell.
Full interactive verification requires an authenticated session + live
providers — the API path it drives is covered by `validate:agent-api`.

---

## 7. Non-goals honoured

- No new agent / runtime / planner / tool / engine / RAG.
- No duplicate runtime/authorization logic in the API or UI.
- No long-running request — every route does strictly bounded work.
- No direct LLM call from a route or the page.
- No schema, no migration, no live trading.
- The legacy `/dashboard/agents` scaffold is untouched.

---

## 8. Status

**A15 complete.** `/dashboard/agents/runs` runs the real A1–A14 framework:
start → poll → advance (one bounded `tick()` each) → terminal, with the
ownership boundary enforced server-side through the A14 primitives and every
displayed value read from persisted state.

**A1–A15 complete — the Agent Framework Foundation is user-facing.**

**G15 review requested** — the API seam, the route security posture, and the
8-test proof.

*End AN1.17.*
