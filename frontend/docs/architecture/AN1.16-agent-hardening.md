# AN1.16 — Regression + Security + Performance Hardening (A14)

**Sprint:** AT24 AI Agents — Agent Framework Foundation
**Step:** A14 — the deliberate hardening gate (no new agent)
**Depends on:** A1–A13 (complete, feature surface frozen at G13)
**Gate:** G14 — review requested
**Migration:** **none**.

---

> **A14 adds no agent and no capability.** It stresses the complete A1–A13
> system for bounded execution, cross-user isolation, concurrency safety,
> resistance to tampered/forged persisted state, and bounded per-phase
> latency — and fixes the genuine gaps that surfaced.

---

## 1. Genuine gaps found and fixed

| # | gap | fix |
|---|---|---|
| 1 | **Cross-user run reads.** `getRunObservability(runId)` and `agentRunRepository.getRun/getRunTrace` are `runId`-only — a caller holding another user's run id could read the whole trace, credit history and evaluation. No requester-facing surface existed yet, but A15's API will call exactly this. | `agentRunRepository.getRunForUser(runId, userId)` — `findFirst({ where: { id, userId } })`, returns `null` for a non-owner. `getRunObservability(runId, { requesterId })` — when `requesterId` is supplied and the run's `userId` differs, returns `null` (indistinguishable from not-found). The unscoped path stays for internal/trusted callers (scheduler, admin). **A15's route MUST pass the session user.** |
| 2 | **Validation-harness collisions** (surfaced during A13). Concurrent runs of a validation script — or a peer session running it — shared one synthetic user id; one run's `cleanup()` deleted another's in-flight `AgentRun` → `AgentStep_runId_fkey`. | All real-agent + hardening scripts derive the user id from `process.pid` + a random token. A new `scripts/validate-agent-parallel.mjs` runs 9 DB-writing suites (incl. two copies of the hardening suite) **concurrently** and asserts every one stays clean — the collision is now a covered regression. |

### 1.1 Documented bounds (not defects)

- **Distinct-key credit charges racing for one user.** `charge()` is
  idempotent per `idempotencyKey` and never goes negative for
  sequential/identical-key operations; the `idempotencyKey` unique index
  makes a duplicate a no-op even under a race. Two *different* charges for
  the same user issued truly concurrently (only possible with concurrent
  runs-per-user, which v1 has no path for) both read the same pre-balance
  and could both commit. A `SELECT … FOR UPDATE` / balance check-constraint
  is the fix when concurrent-multi-run-per-user lands — noted for that work.
- **`MemoryGateway.approvePending(recordId, approver)`** takes a raw record
  id with no ownership check. `approver` is a real user/admin id by
  contract; the approval UX (A15+) supplies the scoping.

---

## 2. What A14 proves — `npm run validate:agent-hardening`

### 2.1 Bounded execution
- **one `tick()` = at most one tool call**, then persist + return — asserted by
  driving a 2-tool run tick-by-tick and checking the tool-call delta is ≤ 1
  every tick; final step sequence is the exact
  `plan → tool_call → evidence → tool_call → evidence → output → evaluation`
  with gapless indices.
- a **terminal run re-ticked 5×** adds no steps, keeps its status, returns fast.
- a **fresh `AgentRuntime` per tick** drives the same run to completion from
  the DB row alone.
- **repeated runs** of the same `(definition, input)` are structurally identical
  (status, step kinds, tool order, evidence count).

### 2.2 Cross-user isolation
- `getRunForUser` returns the run to its owner, `null` to anyone else;
  `getRunObservability({ requesterId })` honours it; an internal caller
  (no `requesterId`) still gets the model.
- **MemoryGateway reads are user-scoped** — user B reading user A's
  own-scoped record gets zero rows.
- **credit balances + run ledgers are per-user** — a charge for A never moves
  B's balance; `historyForRun` entries are all one user.
- **two runs for two users** (via `Promise.all`) — evidence and steps never
  cross; distinct run ids.
- **cleanup of user B's runs mid-flight** does not affect user A's in-flight
  run (the exact A13 collision, now a guarded test).

### 2.3 Concurrency
- a **double `tick()` race** on one run: `Promise.allSettled` pairs until
  terminal — a rejection is the `(runId, index)` unique constraint doing its
  job; the final history has no duplicate indices, is gapless, and has
  exactly the expected tool-call count.
- **two identical charges** (same `idempotencyKey`) via `Promise.all` settle to
  exactly one ledger entry; balance debited once.
- `DuplicateLedgerEntryError` is raised by the store on a duplicate key.

### 2.4 Never trust persisted agent state
- **autonomy raised to 4 in the persisted `metadata.definition`** after a legal
  `startRun` → the run terminates `permission_denied` / `agent_autonomy_ceiling`
  (A8 re-checks the snapshot every tick).
- a **fabricated `evidenceId`** in the output → `failed` / `output_integrity`.
- an **`evidenceId` borrowed from another run** → `failed` /
  `foreign_evidence_id | broken_lineage`.
- a **credential embedded in evidence provenance** → `failed` / `sensitive_data`.
- a **malformed tool output** → clean `tool_error`, not a crash.

### 2.5 Performance (measured, generously bounded)
Per-phase wall-time on deterministic fixtures (no network) is logged and
asserted: `startRun`, plan tick, tool tick each < 3 s; a full deterministic
run < 15 s. These ceilings only catch a pathological blow-up; the observed
numbers are far lower and printed for the record.

---

## 3. Parallel regression — `npm run validate:agent-parallel`

9 DB-writing suites (including **two concurrent copies of the hardening
suite**) run at the same time against the shared dev DB. Pass condition:
every suite exits 0 with 0 failures and no FK / constraint errors in its
output. This is the standing guard for harness isolation.

---

## 4. Full regression

`validate:agent-contracts` 38/0 · `validate:agent-tools` 20/0 ·
`validate:agent-run-persistence` 17/0 · `validate:agent-runtime` 9/0 ·
`validate:agent-supervisor` 11/0 · `validate:agent-integrity` 21/0 ·
`validate:agent-memory` 19/0 · `validate:agent-authorization` 17/0 ·
`validate:agent-credit` 13/0 · `validate:agent-evaluation` 9/0 ·
`validate:agent-research` 9/0 · `validate:agent-market-intelligence` 8/0 ·
`validate:agent-strategy-research` 8/0 · `validate:agent-hardening` **18/0**.

**Total: 217 tests, 0 failing.** Repeatable; `validate:agent-parallel` clean
(9 suites incl. 2× hardening, concurrent).

---

## 5. TypeScript

`npx tsc --noEmit`: **0 errors** in the A14 code. Repo-wide the only errors
remain in the stale generated `.next/dev/types/validator.ts`.

---

## 6. Files changed

**Added (3):**
```
frontend/scripts/validate-agent-hardening.ts
frontend/scripts/validate-agent-parallel.mjs
frontend/docs/architecture/AN1.16-agent-hardening.md
```

**Modified:**
```
frontend/services/agent-framework/runtime/agent-run.repository.ts   + getRunForUser(runId, userId)
frontend/services/agent-framework/evaluation/observability.ts       + requesterId ownership guard
frontend/scripts/validate-agent-{research,market-intelligence}.ts   per-process test user (with A13's strategy script)
frontend/package.json                                               + validate:agent-hardening, validate:agent-parallel
```

**Not touched:** every contract, the runtime execution model, the
authorization / integrity / memory / credit / evaluation logic, the three
agents. No schema, no migration, no API route.

---

## 7. Status

**A14 complete.** The gaps found were a cross-user read path (fixed) and
harness-isolation (fixed + now a parallel regression). The core invariants
hold under stress: one bounded slice per tick, per-user isolation of every
persisted artefact, safe concurrency via the unique constraints and
idempotency keys, and rejection of tampered or forged persisted state.

**A1–A14 complete. A15 — the Agents UI — is next.**

**G14 review requested.**

*End AN1.16.*
