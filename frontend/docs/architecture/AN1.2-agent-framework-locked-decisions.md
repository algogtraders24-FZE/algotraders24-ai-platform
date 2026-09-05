# AN1.2 — AT24 Agent Framework: Locked Decisions & Architecture Decision Record

**Sprint:** AT24 AI Agents — Agent Framework Foundation
**Stage:** Post-A0 decision lock (precedes A1)
**Inputs:** `AN1.1-agent-framework-architecture-audit.md` + product owner review (2026-09-05)
**Status:** 4 decisions LOCKED · 3 questions PENDING owner sign-off · A1 not started

This document freezes the architectural decisions coming out of the AN1.1
audit so implementation (A1→A4) cannot drift. Any change to a LOCKED decision
requires an explicit new ADR entry here, not an inline code choice.

---

## 0. Core principle (LOCKED — governs everything below)

> **The AT24 Agent Framework is an orchestration + persistence + governance
> layer. It does NOT rebuild the existing Intelligence Pipeline or Quant
> Engine — it drives them through an AT24-owned Tool Registry.**

Concretely:

- `RealTimeIntelligenceService`, `MarketIntelligencePipelineService` (v15D.12.0),
  the regime/hypothesis engines, `at24-quant-engine`, `services/algo-test`,
  `news.service`, `KnowledgeRetriever`, the risk engine and paper-trading are
  **called as tools**. Their source is not modified by this sprint.
- No second backtest engine, no second market-intelligence pipeline, no
  second evidence model. Agent evidence reuses the pipeline's `EvidenceItem`
  vocabulary.
- The LLM (`lib/ai` `AIService`, vendor-neutral) is used **only** for planner
  assistance and final narrative synthesis, always behind an integrity check.
  Never for facts, tool results, or evidence.

Rationale: this is the differentiator. AT24's value is verifiable,
evidence-backed intelligence built over 15 sprints. An agent layer that
re-implements any of it would be strictly worse and would fork the truth.

---

## 1. LOCKED DECISIONS

### D1 — AgentType: validated free-string, registry-driven (not a DB enum)

- `Agent.type` stays a `String` column (as today). **No Prisma enum, no
  migration of the 3 seeded rows.**
- A code-level `AGENT_TYPE_REGISTRY` (`types/agent-framework/agent-type-registry.ts`)
  is the authority: it defines each type's default tools, default permission
  grants, and autonomy cap.
- Writes validate `type` against the registry keys. Unknown type → 422.
- Adding `EXECUTION`, `COMPLIANCE`, `PORTFOLIO_OPTIMIZER`, `STRATEGY_MONITOR`,
  `DATA_QUALITY` later = one registry entry + optional tools. **Zero schema
  migration.**
- Legacy seeded values (`market-analyst`, `risk-manager`, `strategy-generator`)
  are mapped to the new registry keys by a lookup table in the registry
  module — the rows are not rewritten.

### D2 — Tests: existing `scripts/validate-*.ts` house style (no Vitest)

- No new test-runner dependency this sprint.
- Every framework test ships as `scripts/validate-agent-*.ts` — a standalone
  `node:assert/strict` harness run via `tsx`, following
  `scripts/validate-decision-context.ts` exactly (build deterministic fake
  inputs → run the real unmodified service chain → assert → print pass/fail).
- Each new script gets a `validate:agent-*` entry in `package.json`.
- Required coverage (from brief §24): contract valid/invalid, runtime
  success/failed/timeout/step-limit/tool-limit/credit-limit, permission
  allowed/denied, live-execution-denied-by-default, tool valid/invalid/error/
  timeout, evidence captured/provenance-retained/missing-handled, memory
  scoped read/write + policy enforcement, credit cost/usage/limit,
  evaluation attached/failed.

### D3 — Mock agents are a legacy compatibility layer; new code is isolated

- `services/agents/*`, `types/agent.ts`, `data/mock-agents.ts`,
  `config/agent.config.ts`, `services/api/AgentsApi.ts`,
  `components/agents/*`, `app/dashboard/agents/page.tsx` — **treated as a
  frozen legacy layer.** Not deleted, not extended, kept working.
- All new implementation lives under:
  - `types/agent-framework/` — contracts
  - `services/agent-framework/` — runtime, supervisor, planner, tools,
    evidence, memory, credits, guardrails, evaluation, observability
  - `app/api/private/agents/**` — new route handlers (the existing `GET`
    route is preserved; new endpoints are added alongside it)
- The existing `/dashboard/agents` UI is **not touched until A15**, and only
  after G07.
- The new `AgentRun`-centric models coexist with the legacy
  `AgentTask`/`AgentActivity` tables — legacy tables are read by the old UI,
  new tables by the new runtime. No cross-writes.

### D4 — `research.web_search` is in v1 scope, but ONLY as a Tool Registry adapter

- The Research Agent is **not** limited to knowledge-base + news. Web search
  is a first-class research tool.
- **It is not hardcoded into the Agent Runtime.** Path is strictly:

  ```
  Research Agent
       -> Planner / Supervisor
       -> Tool Registry  (research.web_search)
       -> pluggable SearchProvider adapter
       -> AgentEvidence  (citations + provenance mandatory)
  ```

- `research.web_search` is a `ToolDefinition` like any other:
  `inputSchema` / `outputSchema` / `requiredPermissions: [CAN_RUN_RESEARCH]` /
  `creditCost` / `handler`.
- The underlying provider/engine is replaceable behind a
  `SearchProvider` interface (same DIP pattern as `lib/ai` `AIProvider` and
  `MarketDataProvider`). No vendor named in the contract.
- Every result item that informs a conclusion **must** produce an
  `AgentEvidence` row with `source`, `sourceId` (URL), `timestamp`,
  `provenance` (provider, retrievedAt), and `relevance`/`confidence`. A
  conclusion citing web content with no evidence row fails the output
  integrity check.
- Outbound network egress from `research.web_search` is subject to the same
  privacy rules as the rest of the platform (no user PII in query strings,
  no personal-data compilation).

---

## 2. PENDING — owner sign-off required before the affected step

These are the AN1.1 §13 questions not yet locked. Recommended defaults are
given; each is low-risk, but the owner asked to review §13 line-by-line and
return a final decision sheet.

### P1 — Migration application timing  *(affects A3)*
**Recommendation:** generate the migration + hand-reviewed SQL in A3, but
**do not apply** to any live DB until an explicit go-ahead (M8/M11 precedent).
Apply via `prisma migrate deploy` / reviewed SQL — **never `prisma migrate dev`**
(pgvector-reset trap, see `project_sprint15c_workflow`). All new columns on
`Agent`/`AgentMemory` are nullable + defaulted, so no backfill.

### P2 — Run execution model  *(affects A4)*
**Recommendation:** `POST /agents/:id/runs` executes **synchronously** for
fast agents (Research / Market Intelligence on cached data — one serverless
request) and returns `202 Accepted` + a `runId` for slow agents (backtest
sweeps), with continuation driven by the existing Vercel cron seam +
`AgentRuntime.tick(runId)` (resumable state machine). **No dedicated queue/
worker service this sprint** (brief §26 — no microservices). A first-class
job queue is a later, separately-scoped decision.

### P3 — Credit numbers  *(affects A9)*
**Recommendation:** no pricing decisions this sprint. Balance ceiling =
`PLAN_LIMITS[planId].aiCredits` (already exists). Per-tool `creditCost`
values are placeholder constants in one file
(`services/agent-framework/credits/tool-credit-costs.ts`), each flagged
`// PLACEHOLDER — pricing pass required`. The **mechanism** (pre-flight
estimate, per-step debit, immutable ledger, hard stop) is fully built and
tested; only the numbers are deferred.

---

## 3. Locked execution sequence

```
AN1.1 Audit  (done, committed)
   |
AN1.2 Lock decisions  (this doc)
   |
[owner returns final decision sheet on P1-P3]
   |
A1 — Locked-decision capture + Agent Contract
        - this ADR is the decision capture; A1 code = types/agent-framework/
          contracts (definition, run, step, tool-call, evidence, memory,
          permission, credit, evaluation) + contractVersion "AF-v1"
          + agent-type-registry.ts + validate-agent-contracts.ts
   |
A2 — Tool Contract + Tool Registry
        - ToolDefinition, ToolRegistry (code Map), ToolGateway
          (schema-validate -> permission-check -> autonomy-check ->
          credit-check -> invoke handler)
        - v1 tool stubs wrapping existing engines (see AN1.1 §3.3)
        - validate-agent-tools.ts
   |
A3 — Agent Run / State Contract + Prisma migration (generated, NOT applied)
        - 7 new models + additive Agent/AgentMemory columns
        - reviewed SQL ready; application gated on P1 go-ahead
   |
A4 — Server-side resumable tick() Runtime
        - AgentRuntime: load -> policy check -> supervisor/plan ->
          tool loop -> evidence capture -> state persist -> output
        - LimitEnforcer (max steps / tool calls / runtime / retries / credit)
        - RunTracer (structured trace -> AgentStep rows + logger)
        - validate-agent-runtime.ts (success + every failure/limit path)
   |
[Gate G02 review]  then A5+ per AN1.1 §7
```

**Not in this window:** any change to `/dashboard/agents`, any real agent
(A11–A13), any UI work, any live-execution wiring.

---

## 4. Invariants carried into implementation (LOCKED)

1. Runtime is **server-only** (`services/agent-framework/*`) — never in the
   client bundle. Client gets a typed API client only.
2. `AgentStep` / `AgentToolCall` / `AgentEvidence` / `AgentCreditLedgerEntry`
   are **append-only, immutable, no `deletedAt`, no update path** (mirror
   `AuditLog` / `AgentActivity`). A re-run is a new `AgentRun` row.
3. `PermissionPolicy` is an **allowlist; default deny.** `CAN_CREATE_ORDER` /
   `CAN_EXECUTE_ORDER` are rejected at the policy-parser layer unless a
   server env flag **and** a user allowlist both pass — `LIVE_EXECUTION = DENY`
   enforced twice (parser + tool gate).
4. Default `autonomyLevel = 0`. Trading Decision Agent capped at `L1`
   (decision-support) in v1. `L3`/`L4` are contract-only — no execution
   wiring this sprint. `L2` = existing paper-trading service.
5. Every tool invocation passes `CreditGateway` — **no bypass path.** A run
   that would exceed `min(remaining, perRunCeiling, perDayCeiling)` ends
   `credit_limit` with partial output + full trace preserved.
6. Final agent output is validated against `AgentDefinition.outputSchema`
   **and** an evidence-integrity check (reuse the
   `ai-response-integrity.service.ts` pattern) — a claim with no backing
   `AgentEvidence` row is rejected.
7. No vendor name in any contract type. `modelPolicy` is
   `{ preferred, fallback[], allowed[] }`. LLM access only through
   `lib/ai` `AIService`.
8. AT24 owns tool **selection** (planner/supervisor) — provider-native
   tool-calling is not relied upon (neither provider layer supports it today;
   can be added later without a contract change).

---

## 5. Change log

| Date | Entry |
|---|---|
| 2026-09-05 | AN1.2 created. D1–D4 locked from AN1.1 + owner review. P1–P3 pending owner decision sheet. Core principle (§0) and invariants (§4) locked. |
