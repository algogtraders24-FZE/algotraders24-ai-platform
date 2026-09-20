# AT24 Credits Metering — Architecture Discovery & Reconciliation

**Sprint:** CREDITS-01 — Metering Architecture Discovery & Reconciliation
**Status:** DISCOVERY ONLY. No application code, schema, migration, or UI was changed to produce this document.
**Date:** 2026-09-20
**Branch:** `docs/credits-metering-reconciliation-v2` (based on `origin/main` @ `64db032`)

---

## 1. Executive Summary

AT24 does not have one credit system with an unclear status — it has **two real, independently-built systems that do different jobs, plus a user-facing page that is unaware of both**.

1. **System A — the Agent Framework Credit Ledger** (`AgentCreditLedgerEntry`, `services/agent-framework/credits/*`) is a real, tested, **already-applied-to-production** append-only ledger. It actively charges and refunds credits, per tool call, for every Agent Framework run (Research, Market Intelligence, Strategy Research, Support Agent) and, transitively, every Automation that dispatches a child AgentRun. It enforces a hard stop at zero balance today. **This is the single most important correction this discovery makes to the prior sprint's framing**: the schema comment that reads "NOT APPLIED" is a frozen, intentionally-preserved review-time header (a repo-wide convention — see §18/§20), not a live status flag. The migration was applied to production on 2026-09-07 (commit `2dd06af`, "G09 authorized") with a documented post-apply verification against the live database, and the code has been debiting real ledger rows in production ever since.
2. **System B — the Billing Entitlement/Usage pool** (`aiMessages`/`aiCredits`, `EntitlementService`, `UsageMeteringService`) is real, live, and queryable, but is **read-only aggregation with no deduction, no enforcement, and no coupling to System A**. It counts `Message` rows with `role: "assistant"` and compares the count to `PLAN_LIMITS[plan].aiCredits` purely for display on the Billing page. Its own header comment says enforcement was deliberately never wired in.
3. **`/dashboard/credits/page.tsx`** — the one page literally named "Credits" — reads neither system. It is 100% static text, written 2026-09-05 (before System A existed), stating "there is no balance to show here… pricing and the credit policy have not been finalized." This claim was true when written and is **now stale**: real credit numbers already exist and are already shown to users elsewhere (Agent Runs page, Automation page — see §17), just not here.
4. **No monthly credit reset job exists.** Confirmed: no cron, no scheduled route, no billing-period handler resets anything. Both System A and System B instead use an **implicit "lazy reset"**: balance/usage is always recomputed as `SUM(...) WHERE periodStart/createdAt >= currentPeriodStart`, so a rollover happens automatically the moment `Subscription.currentPeriodStart/End` advances (via the Stripe/NowPayments webhook). This is real, working, and adequate for both existing systems — but it is a period boundary mechanism, not a "reset event" a notification system could hook.
5. The **main AI Assistant (`app/api/private/knowledge/chat/route.ts`, 477 lines)** — the flagship, highest-traffic AI feature — touches **neither** credit system. It only writes `Message` rows, which System B later counts for display. It has no relationship to System A's ledger at all.
6. Consequently: **no single existing system is a safe, complete, product-ready canonical credit meter today.** System A is real and structurally sound but scoped only to the Agent Framework/Automation surface, with placeholder (not final) per-tool prices and zero end-user visibility. System B is real but display-only and covers the AI Assistant, not agents. Unifying them was explicitly deferred by the engineers who built System A ("Pool-unification with the existing aiMessages entitlement is a deliberate follow-on, out of A9 scope" — `prisma/schema.prisma:1932`).

**Beta impact:** Credits Low/Exhausted/Reset emails remain correctly blocked. A canonical, unified, product-priced credit system does not exist. What exists (System A) could feed such emails for Agent/Automation usage only, but not for the AI Assistant, and the per-tool costs it uses today are explicit placeholders, not committed prices.

---

## 2. Repository Baseline

Confirmed before any investigation:

- Branch at task start: `worktree-agent-adfa1a83945cc1c81`, HEAD `64db032a2bd43dce89352f195aaca2c88e2f9989` ("Merge pull request #98 from feat/email-sprint2-payment-failed"), identical to `origin/main`.
- `git status` — clean working tree, no unrelated uncommitted changes.
- A branch named `docs/credits-metering-reconciliation` already existed locally but is checked out in a **different** worktree (`agent-a5b5435d8187bb54d`, presumably the prior rate-limited attempt) and has zero commits ahead of `main` — it was not touched. This work was done on a fresh branch, `docs/credits-metering-reconciliation-v2`, cut from `origin/main`.
- No destructive git operations were performed (no reset, no rebase, no stash pop).

---

## 3. Existing Credit Systems — Full Inventory

| Artifact | Type | Path | Used by | Read/Write | Production-used? | Purpose | Status |
|---|---|---|---|---|---|---|---|
| `AgentCreditLedgerEntry` | Prisma model | `prisma/schema.prisma:1948` | `PrismaCreditStore` | R/W | **YES** (migration applied `2dd06af`, 2026-09-07) | Immutable per-charge accounting row for Agent Framework tool calls | **CANONICAL for Agent Framework scope; live** |
| `AgentCreditEntryKind` enum | Prisma enum | `prisma/schema.prisma:1937` | ledger writes | — | YES | tool_call/model_inference/research_search/backtest/optimization/large_context/refund/adjustment | Live |
| Migration `20260907120000_add_agent_credit_ledger` | SQL migration | `prisma/migrations/20260907120000_add_agent_credit_ledger/migration.sql` | Prisma | — | YES, applied | Creates the table/enum/indexes | Applied 2026-09-07; header text frozen at "NOT APPLIED" by repo convention (see §18) |
| `docs/architecture/AN1.11-agent-credit-ledger.md` | Doc | same | — | — | — | Records the actual live-DB post-apply verification (enum, table, unique index, `_prisma_migrations` row, real-persistence smoke) | Authoritative — supersedes the frozen migration header |
| `CreditLedger` | Service class | `services/agent-framework/credits/credit-ledger.ts` | `AgentRuntime`, `EvaluationService`, `observability.ts`, `services/support/generate-answer.ts` | R/W | YES | `balance`/`canAfford`/`charge`/`refund`/`historyForRun`, idempotent, hard-blocks at zero | **Canonical accounting authority for Agent Framework** |
| `CreditStore` port + `PrismaCreditStore` | Service | `services/agent-framework/credits/credit-store.ts`, `prisma-credit-store.ts` | `CreditLedger` | R/W | YES | Real Postgres-backed store; maps `P2002` → `DuplicateLedgerEntryError` | Live |
| `InMemoryCreditStore` | Service | `services/agent-framework/credits/in-memory-credit-store.ts` | validation scripts only (`AGENT_CREDIT_INMEMORY=1`), never production | R/W (in memory) | NO (test-only, explicitly forbidden in prod by comment) | Dependency-free ledger for test harnesses | Test-only |
| `PlanAllowanceResolver` / `FixedAllowanceResolver` | Service | `services/agent-framework/credits/allowance-resolver.ts` | `CreditLedger` | R | YES (Plan) / test-only (Fixed) | Resolves `PLAN_LIMITS[plan].aiCredits` + period bounds from `Subscription.currentPeriodStart/End` or calendar month | Live |
| `TOOL_CREDIT_COST_PLACEHOLDERS` | Const map | `services/agent-framework/tools/tool-credit-costs.ts` | `AgentRuntime.flatEstimate`, `ToolGateway` | R | YES | Per-tool cost used for reserve/reconcile | **Explicitly placeholder, not a priced product** (own header: "PLACEHOLDER — pricing pass required") |
| `AutomationRun.creditsUsed` / `AutomationStepRun.creditsUsed` | Prisma columns | `prisma/schema.prisma:362,398` | `services/automation/dispatcher.ts`, `automation-repository.ts` | R/W | YES | Denormalised copy of the child AgentRun's real ledger total (`obs.credits.totalCharged`) | Live, derived from System A — not an independent ledger |
| `Entitlement`/`UsageService`/`EntitlementService`/`UsageMeteringService` | Service | `services/billing/EntitlementService.ts`, `UsageMeteringService.ts`, `UsageService.ts` | `app/api/private/billing/usage/route.ts`, `app/dashboard/billing/page.tsx`, `components/billing/UsageCard.tsx`, `services/admin/AdminAnalyticsService.ts` | **R only** | YES | Counts `Message{role:assistant}` per period vs. `PLAN_LIMITS[plan].aiCredits`, purely for display | **Display-only; no deduction, no enforcement** |
| `types/billing.ts` `Entitlements.aiMessages` | Type | `types/billing.ts:96` | above | — | — | The shape System B returns | Live, display |
| `types/credits.ts` `CREDIT_ACTION_LABELS` | Type/const | `types/credits.ts` | `app/dashboard/credits/page.tsx` | none | YES (rendered) but **inert** | Labels for a future "what will consume credits" list | Own file comment: "an inert type skeleton… nothing reads/writes it" |
| `/dashboard/credits/page.tsx` | UI | same | end users | none | YES (rendered) | Explicit "not built yet" disclosure page | **Static, stale (written 2026-09-05, before System A existed)** |
| `Entitlement` / `License` / `Purchase` (Marketplace) | Prisma models | `prisma/schema.prisma:1218-1305` | Marketplace/licensing services | R/W | YES | Per-product **licenses**, not AI credits | Unrelated system — correctly not conflated with AI credits anywhere found |
| `Plan` / `Subscription` (DB) | Prisma models | `prisma/schema.prisma:35,50` | Billing | R/W | YES | Subscription entitlement records, `currentPeriodStart/End` | Live; feeds both System A and System B period resolution |

No `CreditTransaction`, `balance` table, `quota` table, or `usage event` table exists beyond the artifacts above. No hardcoded credit values were found in production UI other than the `PLAN_LIMITS` and `TOOL_CREDIT_COST_PLACEHOLDERS` constants, both explicitly labeled as product configuration / placeholders in their own comments.

---

## 4. Credit System A Analysis (Agent Framework Ledger)

**Schema:** `AgentCreditLedgerEntry` — `id, userId, runId, stepId?, toolCallId?, kind, amount (signed float), balanceAfter, idempotencyKey (unique), reason, periodStart, createdAt`. Indexes: `(userId, periodStart)`, `(runId)`, `(userId, createdAt)`, unique `idempotencyKey`. Append-only — no `updatedAt`, no `deletedAt`, no update path (`prisma/schema.prisma:1948-1970`).

**Migration:** `20260907120000_add_agent_credit_ledger`. Purely additive (1 enum + 1 table, zero changes to existing tables). **Applied to the live database on 2026-09-07** via `prisma migrate deploy` under explicit "G09" owner authorization (commit `2dd06af9be4805ee39e4c459d103db0382f48c58`, message: "Applied … via `prisma migrate deploy` … Verified live: … `_prisma_migrations` recorded, `migrate status` up to date"). Full verification log lives in `docs/architecture/AN1.11-agent-credit-ledger.md:8-25`, including a real-persistence smoke test (`charge → entry; duplicate key → alreadyApplied; overdraft → InsufficientCreditsError with NO entry; refund → signed entry; balance arithmetic verified`).

**Write paths (all real, all in production code paths):**
- `services/agent-framework/runtime/agent-runtime.ts:448` — reserve estimated cost before every tool call (`kind: "tool_call"`), idempotency key `${runId}:step${index}:reserve`.
- `agent-runtime.ts:519` — reconcile top-up if actual cost > estimate.
- `agent-runtime.ts:525` — refund if actual cost < estimate.
- `services/support/generate-answer.ts:359` — charges `SUPPORT_GENERATION_CREDIT_COST` (`kind: "model_inference"`) when the Support Agent generates an answer from KB coverage, idempotency key `${runId}:support-generate`. **Best-effort** — wrapped in `.catch(() => {})` deliberately (comment: "a charging failure must never unwind an already-delivered, already-persisted answer").

**Read paths:** `services/agent-framework/evaluation/observability.ts` (`totalCharged` for the Agents/Runs UI), `evaluation-service.ts` (A10 scoring), `app/dashboard/agents/runs/page.tsx`, `app/dashboard/automation/page.tsx` (via the `AutomationRun.creditsUsed` denormalisation).

**Callers confirmed by direct trace, not by naming inference:** `agent-runtime.ts` (all agent types: Research, Market Intelligence, Strategy Research, Support — confirmed via `services/agent-framework/agents/*-agent.ts` all sharing the `agentRuntime` singleton), `services/support/generate-answer.ts`.

**Test coverage:** `scripts/validate-agent-credit.ts` — 13 tests: balance recompute-not-cached, `canAfford`, atomic charge, idempotent no-op, **hard block at zero (no entry written on overdraft)**, negative-amount rejection, signed refund, full run history, enum parity with the type contract, plan-fallback allowance, and two **runtime integration** tests (insufficient credits terminates the run with `credit_limit`/`insufficient_credits`; a well-funded run charges exactly once per tool call across a re-tick — i.e. retries are proven non-double-charging).

**Is it canonical?** For its own scope (Agent Framework + Automation), **yes** — it is the only real accounting authority, it is live, tested, and its idempotency/no-overdraft/refund semantics are already locked (owner gates G08/G09), not open questions. It is **not** canonical for the whole product: it does not know about the AI Assistant, and its per-tool prices are explicit placeholders.

---

## 5. Credit System B Analysis (Billing Entitlement/Usage Pool)

**No dedicated schema.** System B is a live aggregation over tables other features already write: `Message` (role=assistant), `Knowledge`, `Conversation` (`services/billing/UsageMeteringService.ts:33-48`). There is no ledger table, no transaction row, no balance column anywhere for this system — "balance" is `limit − live COUNT()`, recomputed on every request.

**Write paths:** **none.** `UsageMeteringService.getUsage()` is pure read aggregation. Its own header states this explicitly: "this file adds zero writes… only read-only aggregation" (`UsageMeteringService.ts:6-7`). `EntitlementService.ts:10-14` states enforcement was "intentionally NOT wired in this sprint."

**Read paths / consumers:** `app/api/private/billing/usage/route.ts` (the only API consumer — computes `periodStart/periodEnd` from `Subscription.currentPeriodStart/End` or calendar-month fallback, then calls `entitlementService.getEntitlements`), `app/dashboard/billing/page.tsx`, `components/billing/UsageCard.tsx`, `services/admin/AdminAnalyticsService.ts` (admin reporting).

**Test coverage:** `scripts/validate-billing-entitlements.ts` — 14 tests, confirming `aiMessages.used` counts only assistant-role messages in the period and `aiMessages.limit` equals the plan's `aiCredits` value. No enforcement tests exist because there is no enforcement.

**Is it canonical?** No — by its own design and its own documentation it is display-only. It is **not dead code** (it is live, queried on every Billing page load) but it is **not an accounting system**: nothing ever debits it, and "credits" in its naming is really "assistant-message count" mapped onto the same numeric ceiling System A also reads (`PLAN_LIMITS[plan].aiCredits`), independently implemented in two different files (`allowance-resolver.ts` and `usage/route.ts`) rather than shared.

**Conflict with System A?** Not a functional conflict (they never write to the same place), but a **naming/semantic collision**: both call the same config value `aiCredits`, but System A treats it as a hard spendable pool with variable per-operation cost, while System B treats it as a 1-unit-per-message quota with no deduction logic. A user could see two different "credit" numbers in two different dashboard pages, computed by two independent formulas, from the same config constant.

---

## 6. Real AI Usage Paths

| Path | User action → chain | Credit deduction today? |
|---|---|---|
| **AI Assistant (main knowledge chat)** | `app/api/private/knowledge/chat/route.ts` (477 lines, zero credit references) → K1-K3 knowledge/orchestration services → model provider → `Message` row persisted | **No.** Only counted after the fact by System B for display. |
| **AI Agents — Research / Market Intelligence / Strategy Research** | `services/agent-framework/agents/{research,market-intelligence,strategy-research}-agent.ts` → shared `agentRuntime` singleton → `AgentRuntime.tick()` → tool call → `CreditLedger.charge()` (reserve) → tool executes → reconcile/refund | **Yes**, System A, per tool call. |
| **Support AI Assistant (CS1)** | `support-agent.ts` → `agentRuntime` → tools `support.knowledge_search` / `support.account_read` (both charged like any other tool call) → if no KB coverage, `services/support/generate-answer.ts` generates a fallback answer and best-effort charges `model_inference` | **Yes** (tool calls) + best-effort (generated-answer path). |
| **Automation-triggered AI work** | `services/automation/dispatcher.ts` → dispatches a child `AgentRun` (never charges itself, per `AUTOMATION_EXECUTION_CONTRACT.md`, `dispatcher.ts:7-9`) → same Agent Framework path above | **Yes, transitively**, via the child AgentRun's own System A charges; `AutomationRun.creditsUsed` is a denormalised copy of `obs.credits.totalCharged`. |
| **AI News** | Feed/store/cron pipeline (`project_news_and_calendar_features` per memory) — no credit references found in this pipeline | No evidence of credit involvement either way; not an Agent Framework tool, not touched by this discovery's grep. |
| **Market Intelligence (direct dashboard route, non-agent)** | Not traced in this sprint beyond confirming the `market.intelligence`/`market.snapshot` **tool** costs exist for the *agent-invoked* version; a standalone non-agent Market Intelligence route was out of this sprint's time budget to fully trace end-to-end. | Unconfirmed for any non-agent invocation path — flagged as an open item, not assumed. |

**Do not confuse:** token counting, API cost tracking, UI display, schema existence, and entitlement checks all exist somewhere in this codebase; only System A's `CreditLedger.charge()` calls are actual **credit metering** (a deduction against a spendable balance that can reach zero and block).

---

## 7. AI Metering Boundary Analysis

System A already made this decision, and it is a real engineering answer worth preserving rather than re-litigating: **reserve-before-execute, reconcile-after**.

- The boundary is **not** "request received" or "request authorized" (A8's authorization is a separate, prior gate — `authorizationService.authorize()` in `agent-runtime.ts:379`).
- The boundary **is**: immediately after authorization and immediately before the tool executor runs, `AgentRuntime` reserves the tool's placeholder estimate (`flatEstimate`) as a real, immediately-idempotent ledger charge (`agent-runtime.ts:446-461`). After the tool returns, the reservation is reconciled up (top-up) or down (refund) to the tool's actual reported cost (`agent-runtime.ts:514-530`).
- **Why this boundary and not "successful result only":** it fails safe against non-refundable provider cost — even a tool call that errors after the provider already did paid work keeps the reservation (only refunded if the *actual* cost comes back lower, never automatically zeroed on error). It also means a run that hits an authorization-level or resource-limit denial is **never** charged (the reserve step is only reached after authorization passes).
- **Idempotency is structural to the boundary, not bolted on**: the key is derived from `(runId, plan step index)`, not from a fresh UUID per attempt, so a resumed/retried tick reuses the same reservation row instead of creating a new one — proven by `scripts/validate-agent-credit.ts:254` ("a well-funded run charges once per tool call, no double-charge on a re-tick").
- This boundary is **not** exercised anywhere outside the Agent Framework. The AI Assistant chat path has no equivalent boundary because it has no ledger to charge.

---

## 8. AI Assistant Metering Analysis

The **main** AI Assistant (`app/api/private/knowledge/chat/route.ts`) has no credit metering, so the questions below are answered as "no current behavior" rather than invented:

- **Request lifecycle / answer generation:** exists (K1-K3 knowledge loop, per memory `project_k0_knowledge_loop.md`), but is entirely outside this discovery's credit-relevant surface — zero references to `credit`/`Credit` in the route file.
- **Caching:** a real retrieval cache exists (`services/knowledge-loop/knowledge/retrieval-cache.ts`, `PrismaRetrievalCache`/`InMemoryRetrievalCache`) — same repo pattern as System A: comment says "Inert until the K2 migration is applied," and a matching apply-commit was found (`593fea6`, "K2 gate: apply retrieval-cache migration to prod + live verification + read-path fix") confirming it, too, is actually live. It caches **retrieval** (chunk ids + similarity), explicitly not the answer text ("This is the RETRIEVAL cache, not the ANSWER cache" — `retrieval-cache.ts:9`).
- **Should a cached response consume credits?** **Not decided anywhere in the repo, and moot today** because the AI Assistant does not consume credits at all yet, cached or not. If/when it is wired into a future unified ledger, this is a genuine open product question: **PRODUCT DECISION REQUIRED.**
- **Distinguishing model execution vs. web search vs. RAG retrieval vs. cache hit:** System A already models this distinction in its own domain — `AgentCreditEntryKind` has separate `tool_call`, `model_inference`, and `research_search` kinds, each independently priced in `tool-credit-costs.ts` (e.g. `research.knowledge_search: 2`, `market.intelligence: 4`). This is real, working precedent for "not all AI operations should cost the same" — but it has never been applied to the AI Assistant's own retrieval/search/generation split.

---

## 9. AgentRun / Automation Analysis

Confirmed architecture, straight from the locked contract comment in `services/automation/dispatcher.ts:6-9`:

> "Automation NEVER charges credits or writes AgentRun rows itself - a child AgentRun does, through the existing ledger. `creditsUsed` here is a denormalised copy of `obs.credits.totalCharged`."

- **AgentRun is the canonical execution record** for anything that spends credits. `AutomationRun`/`AutomationStepRun` never call `CreditLedger` directly (`grep` for `creditLedger`/`.charge(`/`.refund(` outside `services/agent-framework/` and `services/support/` returned nothing in `services/automation/*`).
- AI execution occurs **inside** the child `AgentRun`'s own tool calls, not in the dispatcher.
- `AutomationRun.creditsUsed` and `AutomationStepRun.creditsUsed` **do** record AI usage, but only as a **read-side rollup**: `dispatcher.ts:216` reads `obs?.credits.totalCharged ?? obs?.run?.creditsConsumed ?? 0` from the child run's real observability model (which itself reads the ledger) and copies it onto the automation row (`dispatcher.ts:147,243`; aggregated further in `automation-repository.ts:434-446` for 30-day stats shown on `/dashboard/automation`).
- **Multiple AI calls inside one AgentRun:** each tool call gets its own reserve/reconcile idempotency key (`step${index}`), so multiple calls in one run are charged and tracked individually, then summed for `run.creditsConsumed` and the ledger's `historyForRun`.
- **Retries:** proven non-double-charging by test (`validate-agent-credit.ts:254`) — a re-tick of the same plan step reuses the same idempotency key.
- **Failed AgentRuns:** a failed tool call still keeps its reservation (no automatic refund-on-failure was found in `agent-runtime.ts`; refund only fires when `actual < estimate`, which is a cost-accuracy correction, not a failure-based waiver). Whether a failed run *should* be refunded is not decided anywhere — **PRODUCT DECISION REQUIRED** if failure-based refunds are ever wanted; today, System A's real behavior is "you pay for the attempt at its estimated cost regardless of tool outcome, reconciled only against actual provider cost."

---

## 10. Plan / Entitlement Analysis

Three genuinely distinct concepts exist in the schema and must not be conflated (the brief's own warning is validated by real evidence):

1. **Subscription entitlements** — `Plan`/`Subscription` models (`prisma/schema.prisma:35,50`) + `config/plan-limits.ts` (`free`/`pro`/`elite`/`enterprise`, each with `aiCredits`, `maxAgents`, `maxAutomations`, `maxKnowledgeDocuments`, `storageLimit`, feature flags). This is what both System A's `PlanAllowanceResolver` and System B's `EntitlementService` read for the credit ceiling and the billing period.
2. **Product licenses** — `Purchase` → `Entitlement` → `License` model chain (`prisma/schema.prisma:1218-1305`), the Marketplace's per-trading-system licensing (Ed25519-signed, activation-tracked). Confirmed **completely separate**: no code path found anywhere linking `License`/marketplace `Entitlement` rows to `AgentCreditLedgerEntry` or `PLAN_LIMITS.aiCredits`. Owning a Marketplace product does not touch either credit system.
3. **AI credit allowances** — exists only as `PLAN_LIMITS[plan].aiCredits`, a single number per subscription plan, read independently by both credit systems.

**Quant Lite / Algo Testing Pro:** no dedicated entitlement or license row was found for these (`services/quant-lite/*`, `services/algo-test/*` exist as feature code, not as billing/entitlement models). Whether/how these should relate to AI credits is **undefined in the repository** — **PRODUCT DECISION REQUIRED.**

**Monthly AI allowances:** defined, but only as the single `PLAN_LIMITS[plan].aiCredits` figure — there is no per-feature sub-allowance (e.g., no separate "agent credits" vs. "assistant credits" pool; System A and System B both draw against the *same* number independently, which is itself a drift risk — see §20).

---

## 11. Credit Period Analysis

Both systems already implement the **same real rule**, in two independent implementations:

- If the user has an `active` `Subscription`, the period is `[currentPeriodStart, currentPeriodEnd)` from that row (`allowance-resolver.ts:40-58`; `app/api/private/billing/usage/route.ts:33-34`).
- Otherwise (no active subscription, e.g. Free plan), the period falls back to the **UTC calendar month** (`allowance-resolver.ts:29-33`; `usage/route.ts:37-38`).

This is evidence-backed, not invented, but it answers "how does it work today," not "is this the intended policy" — no product document was found declaring calendar-month vs. subscription-period as the deliberate choice (it appears to be an engineering default). Given it is already consistently implemented twice, **treat as the working default; formal product sign-off is still recommended but the risk of leaving it as-is is low.**

---

## 12. Reset Analysis

Confirmed: **no explicit reset mechanism exists anywhere.**
- `vercel.json` crons: three exist total (`admin/intelligence/evaluate-outcomes`, `automations/cron/dispatch/morning-ist`, `automations/cron/dispatch/evening-ist`) — none touch billing periods or credits.
- No file matches `monthlyReset`/`resetCredits`/`resetPeriod`/`creditReset`/billing-reset naming anywhere in the repository.
- What exists instead is an **implicit lazy reset**: both systems' balance/usage queries are always scoped to `>= periodStart`, and `periodStart` itself advances automatically whenever the Stripe/NowPayments webhook updates `Subscription.currentPeriodStart/End` (confirmed callers: `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/nowpayments/route.ts`, `app/api/private/subscription/route.ts`). No stored balance is ever explicitly zeroed; old ledger rows simply fall outside the new period's query window.

This is a legitimate, working design pattern (it is the same pattern many credit systems use), but it means **there is no discrete "reset event"** a notification system could subscribe to today — see §22.

---

## 13. Rollover / Expiration Analysis

Not defined anywhere. Because the "reset" is really just a moving query window rather than a truncation, unused System-A allowance for a closed period is neither explicitly forfeited nor explicitly rolled over — it simply stops being counted once `periodStart` advances (functionally equivalent to "expires," but never stated as policy). No pricing page, plan config, or UI text was found asserting rollover behavior either way. **PRODUCT DECISION REQUIRED.**

---

## 14. Consumption Semantics

Grounded in System A's actual, tested behavior (not invented) where it applies; marked open where System A has no opinion or where the question is about a surface System A doesn't cover (AI Assistant):

| Scenario | Current real behavior (System A, Agent Framework scope only) |
|---|---|
| Successful AI request (tool call) | Charged at estimate, reconciled to actual cost. |
| Failed AI request | Charged at estimate; no automatic refund found on tool failure. |
| Provider error inside a tool | Same as failed request — no special-cased waiver. |
| User cancels request | Not traced; `cancelRequestedAt` exists on `AutomationRun` but no corresponding credit refund logic was found. |
| Streaming interrupted | Not applicable to Agent Framework tool calls (not a streaming primitive there); undefined for AI Assistant, which does stream but doesn't charge at all. |
| Retry | Proven not to double-charge (idempotency key keyed to plan step, not attempt). |
| Cached response | Not applicable — nothing that charges credits today has a cache in front of it. |
| Web-search-only / RAG-retrieval-only | System A prices `research.knowledge_search`/`news.search`/`support.knowledge_search` distinctly from `model_inference` — different kinds, different placeholder costs — so the *mechanism* to treat these differently already exists. |
| One AgentRun, multiple AI calls | Each call charged/reconciled independently, summed for the run total. |

Final unit prices, whether failures should be refunded, and whether the AI Assistant should ever charge at all: **PRODUCT DECISION REQUIRED** for each.

---

## 15. Idempotency Analysis

Already solved, in production, for System A: the **preferred idempotency boundary is `(AgentRun.id, plan-step-index)`**, not a fresh request/attempt id. Evidence: `credit-ledger.ts:59-62` ("derive from (runId, plan step index), never from a fresh toolCallId"); enforced via `AgentCreditLedgerEntry.idempotencyKey` being `@unique`; a Postgres unique-violation race is explicitly caught and treated as "already applied" (`prisma-credit-store.ts:49-54`, `credit-ledger.ts:142-148`). This handles browser retry, AgentRun tick resume, and concurrent duplicate ticks identically — no new ID scheme is needed for the Agent Framework surface. **No equivalent idempotency boundary exists for the AI Assistant**, because it has nothing to be idempotent against yet (no ledger). If the AI Assistant is ever metered, its natural analogue would be its own execution/turn id (an "AnswerTurn"-equivalent record) — not found as an existing persisted concept in this codebase during this discovery, so this is a **build item, not a decision** for that future work.

---

## 16. Concurrency / Negative Balance Analysis

Already solved and tested for System A: `charge()` recomputes `available = allowance - SUM(period)` fresh on every call and throws `InsufficientCreditsError` with **no partial write** if the charge would exceed it (`credit-ledger.ts:109-124`, tested at `validate-agent-credit.ts:138`). This is a **hard block at zero**, not a reservation-with-timeout, not an overdraft, and not a negative-balance model. It is not fully race-proof under true concurrent requests (two simultaneous ticks both reading `available` before either writes could theoretically both pass the check — no `SELECT … FOR UPDATE` or serializable transaction was found wrapping the read-then-write in `charge()`), which is a real, if narrow, gap worth flagging rather than a "PRODUCT DECISION REQUIRED" (it's an implementation robustness question, not a policy question). Whether this hard-block *policy* (vs. overdraft/grace) is what the business wants for a future unified, user-facing system: **PRODUCT DECISION REQUIRED** — today's behavior is an Agent-Framework engineering default, not a documented product ruling.

---

## 17. Credits Page Reconciliation

`app/dashboard/credits/page.tsx` (written 2026-09-05, `98474671`/`f964a53`) is 100% static: a "Not yet available" badge and prose stating metering "has not been built yet." It imports only `CREDIT_ACTION_LABELS` from `types/credits.ts`, which its own file header calls "an inert type skeleton… nothing reads/writes it." It makes zero Prisma calls and zero API calls.

**The mismatch:** this claim was accurate on 2026-09-05. It is **stale today (2026-09-20)** — two days after this page shipped, System A was built and applied to production (2026-09-07), and it has been charging real credits ever since. Concretely, **real credit numbers already exist and are already rendered to users**, just not on the page named "Credits":
- `app/dashboard/agents/runs/page.tsx:269-270,294` shows `credits charged: {obs.credits.totalCharged}`, `run.creditsConsumed: {obs.run.creditsConsumed}`, and a per-run `{r.creditsConsumed} cr` badge.
- `app/dashboard/automation/page.tsx:60,82,103` shows a "Credits Used (30d)" aggregate stat and a per-automation "Credits 30d" column.

Neither of those pages calls itself "the credits page," and the actual Credits page shows neither number nor links to either. This is the clearest concrete instance of the drift this sprint was asked to find: **the canonical-sounding page is the one place in the app where credit reality is least visible.**

---

## 18. Database / Migration Analysis

**Critical methodology finding, applicable beyond credits:** this repository has a deliberate, repo-wide convention where a migration's `STATUS: NOT APPLIED` header and matching `schema.prisma` comment are **written at review time and never edited again, even after the migration is applied to production** (confirmed explicitly by commit `2dd06af`'s own message: "Migration files are immutable once applied; the header keeps its review-time wording," and reproduced in the relaxed test assertion in `scripts/validate-agent-credit.ts:203-206`). The same pattern was independently confirmed for the K2 retrieval-cache migration (`git log` shows commit `593fea6`, "K2 gate: apply retrieval-cache migration to prod + live verification + read-path fix," against a schema file that still reads "Inert until the K2 migration is applied").

**Practical consequence for this and any future discovery task:** grepping `schema.prisma`/migration headers for "NOT APPLIED" is **not sufficient evidence** of current production state. The only reliable signal found in-repo is a corresponding "apply + verify" commit and/or an `AN1.x`/`K*` architecture doc with a live-DB verification section. For `AgentCreditLedgerEntry` specifically, that evidence exists and is unambiguous (§4). This discovery did not have direct production database access and relied on this documented evidence trail rather than a live `\dt`/`prisma migrate status` query — if the owner wants absolute certainty, a live check against production is still the strongest possible confirmation, but the paper trail here is internally consistent and was cross-checked against a second, independent example (K2).

No other credit-adjacent table (no separate `CreditTransaction`, `Balance`, or `UsageEvent` table) exists in the schema.

---

## 19. Existing Test Coverage

| Suite | File | Scope | Count |
|---|---|---|---|
| Agent credit ledger | `scripts/validate-agent-credit.ts` | Unit (balance/charge/refund/idempotency/no-overdraft) + 2 runtime integration tests | 13 |
| Billing entitlements | `scripts/validate-billing-entitlements.ts` | `aiMessages` counting + limit mapping | 14 |
| Agent runtime (broader) | `scripts/validate-agent-runtime.ts`, `validate-agent-hardening.ts`, etc. | Exercise the runtime end-to-end using `AGENT_CREDIT_INMEMORY=1`, i.e. **against the in-memory store, not the real Prisma-backed one** | many, indirectly touch credits |

**Missing for a real, unified, product-grade metering system:** any test of System A against a genuinely concurrent double-charge scenario (see §16); any test of System B at all being wired into enforcement (there is nothing to test — it doesn't enforce); any test of the AI Assistant path with credits, because it has none; any test of cross-system consistency (System A and System B ever agreeing on a user's remaining balance) — because they are not designed to agree, they measure different things.

---

## 20. Duplicate / Drift Findings

| Source A | Source B | Conflict | Evidence | Recommended canonical source |
|---|---|---|---|---|
| System A `PlanAllowanceResolver` (`allowance-resolver.ts`) | System B `usage/route.ts` period logic | Independently re-implement the *same* subscription-period-or-calendar-month rule in two files | `allowance-resolver.ts:29-58` vs `usage/route.ts:30-42` | One shared period-resolution helper, used by both, if/when unified |
| System A ledger balance | System B `aiMessages` entitlement | Both read the same `PLAN_LIMITS[plan].aiCredits` number but compute two semantically different "remaining" figures (spendable balance with variable cost vs. flat per-message count) | `allowance-resolver.ts:50` vs `EntitlementService.ts:52` | Needs an explicit product decision on which model "aiCredits" is supposed to mean — cannot both be true at once for a user-facing number |
| `/dashboard/credits` page | `/dashboard/agents/runs` + `/dashboard/automation` pages | The page named "Credits" shows nothing; two unrelated pages already show real credit numbers | §17 | Consolidate real numbers onto the Credits page once a unified system is decided |
| `AgentRun.creditsConsumed` (budget counter) | `AgentCreditLedgerEntry` (accounting ledger) | Deliberately two separate concepts by design (own doc: "This is NOT `run.creditsConsumed += cost`… A9 is a separate accounting authority" — `credit-ledger.ts:8-9`) — **not a bug**, but worth naming explicitly since both are called "credits" in code and could be confused by a future maintainer | `credit-ledger.ts:1-17`, `AN1.11-agent-credit-ledger.md:30-44` | Keep both; document the distinction near both fields (a documentation gap, not a code gap) |

No evidence of multiple *competing* ledgers, multiple balance calculations claiming to be the same authority, or hardcoded fake numbers presented to users as real credit balances. The Credits page's honesty ("not yet available") is a mitigating factor, not a fabrication risk — it is simply out of date, not dishonest.

---

## 21. Beta Minimum Requirements

**The question this section must answer: "What is the minimum real credit system AT24 needs before Credits emails can safely exist?"**

Today, "Credits Low / Exhausted / Reset" cannot safely exist because:
1. There is no single balance number that means the same thing everywhere a user might see it (System A's ledger balance ≠ System B's message count).
2. The system that *does* have a real, enforced, testable balance (System A) only covers Agent/Automation usage, not the AI Assistant — a "credits exhausted" email triggered by System A would be misleading to a user who has only ever used the (uncounted) AI Assistant.
3. No reset *event* exists to anchor a "Credits Reset" email (§12) — only a moving query window.
4. Per-tool prices feeding System A are explicit placeholders, not committed pricing — an early "Low"/"Exhausted" email built on placeholder prices could contradict a later pricing change.

**Minimum for Beta**, in order: (a) an explicit product decision on whether Beta's credit-facing surface is Agent/Automation-only (System A) or unified with the AI Assistant (requires new work, not just a decision); (b) if Agent/Automation-only, real per-tool prices replacing the placeholders, and the Credits page updated to show System A's real balance instead of the static "not built" text; (c) a discrete reset/period-rollover event (even a simple "periodStart changed" detection) for a Reset email to hook into. None of this is being built by this sprint.

---

## 22. Future Email Dependencies

```
Canonical credit event  →  Credit state transition   →  Notification event  →  Email
CreditLedger.charge()   →  balance crosses threshold  →  (not implemented)   →  C01 Credits Low
CreditLedger.charge()   →  balance reaches 0           →  (not implemented)  →  C02 Credits Exhausted
Subscription webhook    →  currentPeriodStart advances →  (not implemented)  →  C03 Credits Reset
```

All three require: (1) the canonical-balance decision above, (2) a place to detect the transition (today, `balance()` is computed on-demand, not watched — there is no event emitted when a charge crosses a threshold), and (3) the email system remaining strictly downstream, never re-deriving its own balance logic. This sprint recommends **not** building any of these three until §21's minimum is met.

---

## 23. Decision Matrix

| Decision | Current State | Evidence | Recommendation | Product Decision Required? |
|---|---|---|---|---|
| Canonical ledger | Two systems; System A is a real accounting ledger (Agent/Automation only), System B is display-only (AI Assistant usage only) | §4, §5 | Decide scope: extend System A to cover the AI Assistant, or keep them separate with clearly different names | **YES** |
| AI metering boundary | Reserve-before-execute / reconcile-after, already built and tested for Agent Framework | §7 | Reuse this boundary pattern if the AI Assistant is ever metered | No (pattern already proven; only "apply it to AI Assistant?" is a decision) |
| Monthly allowance | `PLAN_LIMITS[plan].aiCredits`, one number, used two different ways | §3, §10 | Decide whether Agent and Assistant usage should share one pool or have separate pools | **YES** |
| Reset semantics | No explicit reset; implicit lazy reset via period-scoped queries | §12 | Acceptable as a mechanism; needs a discrete "reset happened" signal for emails | **YES** (for the event, not the mechanism) |
| Rollover | Undefined; functionally "expires" by omission, never stated as policy | §13 | State it explicitly either way | **YES** |
| Failed AI call charging | Charged at estimate today, no failure-based refund | §9, §14 | Decide if failures should be refunded/waived | **YES** |
| Cache-hit charging | N/A — nothing that charges credits is cached yet | §8, §14 | Decide before ever metering the AI Assistant (which does have a retrieval cache) | **YES** |
| AgentRun charging | Already real, tested, per-tool-call, idempotent | §4, §7, §9 | Keep as-is; only the unit prices are placeholders | Partial — pricing only |
| Low threshold | Not defined anywhere | §21 | Do not select without a canonical balance to threshold against | **YES** |
| Exhausted definition | System A: balance = 0 blocks further charges (real, tested). No product-facing "exhausted" state exists for a user who hasn't touched Agents. | §16 | Define per canonical-scope decision | **YES** |
| Negative balance | Hard block at zero (System A); not race-proof under true concurrency (no `FOR UPDATE`) | §16 | Confirm hard-block is the intended product policy; consider tightening the race window as a follow-up engineering task (not a product decision) | Partial — policy yes, race-hardening no |
| Idempotency key | `(runId, plan-step-index)` — solved for Agent Framework; no equivalent exists for AI Assistant | §15 | Reuse the same pattern (an execution/turn id) if AI Assistant is metered | No (pattern proven), but AI-Assistant-side implementation is new work |

---

## 24. Proposed Canonical Architecture

Repository evidence supports **not** building a third, parallel system. The existing System A mechanism (allowance → immutable ledger → deterministic balance → idempotent charge → auditable history) is real, tested, and already generalized behind ports (`CreditStore`, `AllowanceResolver`) that don't assume "Agent Framework" specifically — they take a `userId` and a signed amount. The straightest path that avoids a parallel system:

```
AI Operation (Agent tool call | Automation step | [future] AI Assistant turn)
        │
        ▼
Canonical Execution Record (AgentRun/AgentToolCall today; would need an
        AI-Assistant-side equivalent — e.g. an AnswerTurn record — to extend)
        │
        ▼
Metering Boundary (reserve-before-execute, reconcile-after — already built,
        §7 — reused as-is)
        │
        ▼
Credit Ledger (AgentCreditLedgerEntry — already built, already applied to
        production — extended with real per-operation kinds/costs for any
        new surface, not a new table)
        │
        ▼
Balance / Period State (CreditLedger.balance() — already built; needs a
        discrete "period rolled over" signal added for §22)
        │
        ▼
Notification Event (new — not built; the only genuinely new infrastructure
        this diagram calls for)
        │
        ▼
Email (C01/C02/C03 — blocked until everything above is real)
```

The proposal explicitly **retires nothing and duplicates nothing**: System B (`EntitlementService`/`UsageMeteringService`) would remain as the Billing page's own usage-transparency feature (it answers "how many assistant messages did I send," a legitimate question independent of credits) rather than being forced to pretend to be a ledger it was never built to be.

---

## 25. Product Decisions Required

Genuinely unsupported by existing evidence — listed once, not padded:

1. **Scope of "canonical credits":** Agent/Automation-only (System A as-is) vs. unified across the AI Assistant too (requires new build work, not just a decision).
2. **Pool sharing:** one shared `aiCredits` pool across every AI surface, or separate pools per surface.
3. **Real per-tool/per-operation prices**, replacing `TOOL_CREDIT_COST_PLACEHOLDERS`.
4. **Rollover vs. expiration** of unused credits at period end.
5. **Failed-call and cache-hit charging semantics**, especially before the AI Assistant is ever metered (it already has a retrieval cache; charging semantics for that must be decided before, not after, wiring it up).
6. **Low/Exhausted thresholds**, and whether "Low" is a percentage, an absolute number, first-crossing-only, or recurring.
7. **Negative-balance/overdraft policy** for a future user-facing product (today's hard-block-at-zero is an Agent Framework engineering default, not a ratified product policy).
8. **Whether Quant Lite / Algo Testing Pro purchases should ever interact with the AI credit pool** (no relationship exists today).

---

## 26. Explicit Non-Goals (this sprint)

This sprint did NOT and does not: implement credit metering; implement or modify the credit ledger; implement a reset job; implement thresholds; implement any email; change plans or pricing; change the Agent Framework, Automation, AI Assistant, Marketplace, or Billing code; change any UI, including `/dashboard/credits`. Zero application code, schema, or migration files were touched.

---

## 27. Recommended Implementation Sequence

```
DISCOVERY (this document)
   │
PRODUCT DECISIONS (§25 — owner sign-off required before any code)
   │
ARCHITECTURE LOCK (confirm §24's diagram, or amend it, in writing)
   │
CANONICAL CREDIT IMPLEMENTATION
   (extend System A's existing ports rather than building a new ledger;
   real per-operation prices replacing placeholders)
   │
REAL AI METERING for whichever surfaces §25.1 selects (if AI Assistant is
   in scope, this is the largest single piece of new work — it currently
   has zero metering infrastructure)
   │
RESET / PERIOD LOGIC (add a discrete "period rolled over" signal on top of
   the existing lazy-reset query pattern — do not replace the pattern)
   │
LOW / EXHAUSTED STATE (once thresholds are decided, §25.6)
   │
CREDIT UI RECONCILIATION (`/dashboard/credits` finally reads the real
   balance; retire or clearly re-label the System-B "AI Messages" widget
   on the Billing page so it doesn't compete with the real number)
   │
CREDIT EMAILS (C01/C02/C03 — strictly downstream, per §22)
   │
TEST / AUDIT (concurrency/race hardening for §16; cross-surface consistency
   tests once unified)
```

This order matches the brief's expected sequence. The one repository-specific adjustment: **"Canonical Credit Implementation" should be explicitly scoped as "extend System A," not "build new"** — System A's ledger, store port, and allowance port are already production-proven and there is no evidence anywhere in this repository suggesting they need to be replaced rather than extended.

---

## 28. Final Discovery Gate

- Independently verified all three claims carried in from the prior sprint: (1) confirmed **with a major correction** — the Agent Credit Ledger is not schema-only/dead code, it is live and has been applied to production since 2026-09-07; the "NOT APPLIED" wording is a frozen historical header, a repo-wide convention also confirmed for the unrelated K2 migration; (2) confirmed verbatim — the billing entitlement pool is real, read-only, and was deliberately never wired into enforcement; (3) confirmed — no monthly reset mechanism exists anywhere, though an implicit lazy-reset via period-scoped queries does the equivalent job for both existing systems.
- Went deeper than the prior sprint's yes/no framing across §4-9 as instructed: traced every write path (`agent-runtime.ts:448,519,525`; `generate-answer.ts:359`) to exact line numbers, confirmed idempotency/hard-block/refund semantics against passing tests, traced the AgentRun↔AutomationRun credit relationship end-to-end through `dispatcher.ts`, and confirmed the AI Assistant's complete non-participation in either system.
- No implementation was performed. No product decisions were made on the owner's behalf.

---

## 30. Final Validation

```
git status            → only this file is new/untracked before commit
git diff --stat       → (see final report — one file, this document)
git diff              → no application code, schema, migration, or package changes
```

Confirmed manually during this sprint: no `.prisma` schema edits, no new migration folder, no `package.json` change, no edits under `app/`, `components/`, `services/`, `config/`, or any UI file. The only file created is this document.
