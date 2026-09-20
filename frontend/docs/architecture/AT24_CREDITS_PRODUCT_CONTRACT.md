# AT24 AI Credits — Product Contract Decision Gate

**Sprint:** CREDITS-02 — AI Credits Product Contract Decision Gate
**Status:** DECISION / RECONCILIATION ONLY. No application code, schema, migration, or UI was changed to produce this document.
**Date:** 2026-09-20
**Branch:** `docs/credits-product-contract` (based on `origin/main` @ `59f481a`)
**Builds on:**
- `docs/architecture/AT24_EMAIL_COMMUNICATION_RECONCILIATION.md` (Email Sprint 1)
- `docs/architecture/AT24_CREDITS_METERING_RECONCILIATION.md` (CREDITS-01, merged PR #99 → `59f481a`)

Every claim below was independently re-verified against current code in this sprint (file paths / line evidence given); CREDITS-01's core conclusions held up under re-verification with no material corrections found.

---

## 1. Purpose

CREDITS-01 discovered that AT24 has two real, non-competing systems doing different jobs (an already-live Agent Framework ledger, and a display-only Billing usage counter), plus a stale "Credits" page that reflects neither. That discovery answered **"what exists."** This document answers the next question: **exactly what product contract must the owner sign off on before CREDITS-03 (real implementation) can begin?**

This is not an implementation plan. It is a decision matrix: for every open product question, it states the current evidence, a recommended direction (grounded in what already works in production), and marks whether that direction is CONFIRMED by evidence, RECOMMENDED but requires sign-off, or genuinely UNRESOLVED. No price, threshold, allowance, or policy in this document is a final decision — none of them were invented, and none should be treated as approved until the owner explicitly says so.

---

## 2. Production Evidence (independently re-verified this sprint)

| Fact | Status | Evidence (re-checked 2026-09-20) |
|---|---|---|
| `AgentCreditLedgerEntry` ledger is live in production | **CONFIRMED** | `prisma/schema.prisma:1937-1970` (enum + model); applied via migration `20260907120000_add_agent_credit_ledger`, commit `2dd06af`, "G09 authorized"; live-DB post-apply verification in `docs/architecture/AN1.11-agent-credit-ledger.md:1-27` (enum/table/unique-index/`_prisma_migrations` row all confirmed present, plus a real-persistence smoke test: charge→entry, duplicate key→`alreadyApplied`, overdraft→`InsufficientCreditsError` with no entry, refund→signed entry, balance arithmetic `100−30+10=80`). |
| Reserve-before-execute / reconcile-after boundary is real and tested | **CONFIRMED** | `services/agent-framework/runtime/agent-runtime.ts:446-461` (reserve, idempotency key `${run.id}:step${index}:reserve`), `:514-530` (reconcile: `charge` topup if `delta>0`, `refund` if `delta<0`, both keyed `...:topup`/`...:refund`). |
| Support Agent's generated-answer charge is best-effort | **CONFIRMED** | `services/support/generate-answer.ts:108` (`SUPPORT_GENERATION_CREDIT_COST = 5`), `:366-370` (`.catch(() => {})` around the charge call). |
| Automation never charges credits itself; a child AgentRun does | **CONFIRMED** | `services/automation/dispatcher.ts:8-10` (locked contract comment, verbatim: "Automation NEVER charges credits or writes AgentRun rows itself — a child AgentRun does, through the existing ledger"), `:216` (`obs?.credits.totalCharged ?? obs?.run?.creditsConsumed ?? 0`), `:220-225` (`credit_limit` → `CREDIT_BLOCKED`/`CREDIT_LIMIT` mapping). |
| Main AI Assistant has zero credit references | **CONFIRMED** | `app/api/private/knowledge/chat/route.ts` — 477 lines, `grep -in "credit"` returns **zero matches**. This is the real, current route (confirmed by its own header comment chain through Sprint D2.6.9 / K3-B-3, `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`). |
| Billing entitlement system (`aiMessages`) is read-only, no deduction | **CONFIRMED** | `services/billing/UsageMeteringService.ts:2-9` ("this file adds zero writes... only read-only aggregation"), `services/billing/EntitlementService.ts:10-14` ("Enforcement... intentionally NOT wired in this sprint"). Both files re-read line-for-line this sprint; unchanged since CREDITS-01. |
| `/dashboard/credits` shows stale static text | **CONFIRMED** | `app/dashboard/credits/page.tsx:38-43` — Badge "Not yet available"; text: "there is no balance to show here... pricing and the credit policy have not been finalized." Imports only `CREDIT_ACTION_LABELS` from `types/credits.ts`, itself an explicitly inert skeleton (`types/credits.ts:1-9`: "Nothing in the app reads or writes these yet"). |
| No monthly/period credit-reset job exists | **CONFIRMED** | `vercel.json` crons re-read in full this sprint: 5 total (`evaluate-outcomes`, `ingest-news`, `publishing/dispatch`, `automations/cron/dispatch/morning-ist`, `automations/cron/dispatch/evening-ist`) — none touch billing periods or credits. |
| Per-tool costs are explicit placeholders | **CONFIRMED** | `services/agent-framework/tools/tool-credit-costs.ts:1-11` header, verbatim: "LOCKED (AN1.2 P3): no pricing decisions this sprint... PLACEHOLDER — pricing pass required (A9)." |
| Pool-unification with `aiMessages` was deliberately deferred, not an oversight | **CONFIRMED** | `services/agent-framework/credits/allowance-resolver.ts:6-9`: "LOCKED (owner P3 / A9): no pricing changes... A9 does NOT unify this pool with the aiMessages entitlement... that is a deliberate, separately-scoped billing follow-on." |

No corrections to CREDITS-01 were required. One additional fact surfaced in this sprint's deeper pass: `TOOL_CREDIT_COST_PLACEHOLDERS` (`tool-credit-costs.ts:12-21`) has **no entry for a generic "web search" tool** — the AI Assistant's Claude-native web search has no analogue anywhere in System A's pricing table today, which matters directly for §16 below.

---

## 3. Existing Architecture (recap, evidence-linked)

```
                 System A (real, live)                     System B (real, display-only)
        AgentCreditLedgerEntry ledger                    EntitlementService / UsageMeteringService
   agent-runtime.ts reserve→execute→reconcile         Message{role:assistant} COUNT() vs PLAN_LIMITS.aiCredits
        charges: Agents, Support, Automation                  reads: Billing dashboard only
        (via child AgentRun)                                  writes: NONE
                    │                                                │
                    ▼                                                ▼
          /dashboard/agents/runs, /dashboard/automation      /dashboard/billing (UsageCard)
                    │
        /dashboard/credits reads NEITHER — static "not built" text (app/dashboard/credits/page.tsx)
```

Two independently-implemented period-resolution formulas exist for the *same* rule (`Subscription.currentPeriodStart/End` if active, else UTC calendar month): `allowance-resolver.ts:29-61` (System A) and `EntitlementService`/`app/api/private/billing/usage/route.ts` (System B, per CREDITS-01 §11 — re-confirmed, not re-read line-by-line this sprint since it carries no new decision weight beyond what CREDITS-01 already established).

---

## 4. Canonical Ledger Decision

**Question:** should AT24 build a second ledger, or extend System A?

**Evidence:** System A's ports (`CreditStore`, `AllowanceResolver`) already take a generic `userId` + signed amount — nothing in `credit-ledger.ts` or `credit-store.ts` assumes "Agent Framework" specifically (re-verified: `credit-ledger.ts:73-182` has no Agent-Framework-specific types in its public surface, only `AgentCreditEntryKind` as the operation-kind enum, which is itself extensible). It is tested (13 tests, `scripts/validate-agent-credit.ts`, confirmed present this sprint), idempotent, and has been debiting real production balances since 2026-09-07.

**Recommended direction:** Reuse `AgentCreditLedgerEntry` / `CreditLedger` as the one canonical AI Credits ledger for Agents, Automation, and (pending §5) the AI Assistant. Do not create a second ledger, a new Prisma model, or a new credits service.

**Tag: RECOMMENDED — Owner Confirm.** This is an architecture recommendation grounded in real, working code, not an invented preference — but "reuse this specific system" is still a product/architecture call the owner must ratify before any implementation work is authorized.

---

## 5. AI Assistant Integration Decision

**Question:** should the AI Assistant (`app/api/private/knowledge/chat/route.ts`) be metered via the same ledger, and how?

**Evidence:** The route has zero credit references today (§2). It has its own product identity — RAG retrieval, Claude-primary with native web search + Gemini/OpenAI fallback, per `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md` — and a real retrieval cache (`services/knowledge-loop/knowledge/retrieval-cache.ts`) that is genuinely live (K2 migration applied, confirmed by CREDITS-01 §8 via commit `593fea6`).

**Recommended direction, per the brief's explicit constraint ("do NOT turn Main AI Assistant into an Agent Framework Agent merely to obtain credit metering"):** Charge the *same* `CreditLedger` (same table, same `charge()`/`refund()` API, same idempotency contract) from a new call site inside the Assistant's own route/orchestration layer — not by routing Assistant turns through `AgentRuntime`. The Assistant keeps its own execution path, tool orchestration, and product surface; it becomes a *second caller* of the existing ledger, exactly as Support Agent and Research Agent are today, each with their own call site (`generate-answer.ts:359` vs. `agent-runtime.ts:448`). This requires a new idempotency key scheme scoped to an Assistant turn (analogous to `(runId, step-index)`, but there is no existing "AnswerTurn" record to key off — this is new build surface, not a reused one).

**Tag: RECOMMENDED — Owner Confirm** (direction), **OWNER DECISION REQUIRED** (whether to meter the Assistant at all, and on what timeline — this is new metering infrastructure, not a policy flip on an existing switch).

---

## 6. Shared-Pool Decision

**Question:** one shared `aiCredits` pool across Assistant + Agents + Automation, or separate pools per surface?

**Evidence:** Today there is exactly one number, `PLAN_LIMITS[plan].aiCredits` (`config/plan-limits.ts:11`, values: free 500 / pro 10,000 / elite 50,000 / enterprise 500,000), read independently by both System A's `PlanAllowanceResolver` (`allowance-resolver.ts:50`) and System B's `EntitlementService` (`EntitlementService.ts:52`) — but computed two different ways (System A: spendable balance with variable per-operation cost; System B: flat 1-unit-per-assistant-message count against the same ceiling). These are not currently reconciled and were never intended to be reconciled by the engineers who built them (`allowance-resolver.ts:6-9`, quoted in §2).

**Recommended direction:** One shared AI Credits pool per user per period (matches the "AT24 AI Credits" north-star diagram in the brief), fed by all three surfaces through the one ledger. This requires retiring or clearly re-scoping System B's "AI Messages" framing so it doesn't present a second, disagreeing "credits" number to the same user.

**Tag: OWNER DECISION REQUIRED.** A shared pool is the brief's stated hypothesis, and the evidence doesn't contradict it, but nothing in the repository commits to it — this is a genuine business decision (a heavy Agent user could exhaust a pool an Assistant-only user never touches, changing the product's per-plan value proposition).

---

## 7. Credit Unit Analysis (AI Assistant)

**Options from the brief, evaluated against existing precedent:**

- **Option A — Per user message.** Matches System B's current (display-only) model exactly. Simplest, but ignores that a single Assistant turn can trigger RAG retrieval, web search, and/or a Claude/Gemini/OpenAI fallback chain — costs that plainly differ in real provider expense, a distinction System A already treats as real (see below).
- **Option B — Per model execution.** Closer to provider-cost reality, but the Assistant already has a documented multi-provider fallback chain (Claude → Gemini → OpenAI → deterministic, `AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`) — charging "per model execution" is ambiguous when a fallback silently retries against a second provider for the same user turn.
- **Option C — Per operation/tool** (reasoning, web search, RAG retrieval, specialized tool), independently priced. This is the model System A **already uses and has already tested** for Agents: `AgentCreditEntryKind` distinguishes `tool_call` / `model_inference` / `research_search` (`prisma/schema.prisma:1937-1946`), and `TOOL_CREDIT_COST_PLACEHOLDERS` prices `research.knowledge_search` (2), `news.search` (2), and `market.intelligence` (4) independently (`tool-credit-costs.ts:12-21`). No entry for a bare "web search" tool exists yet, but the pattern (separate kinds, separately priced) is proven, not proposed.
- **Option D — Hybrid** (base charge per turn + optional tool/search add-ons). Closest to what a unified system would need in practice: a turn that only hits the retrieval cache (no live RAG call, no web search) is cheaper than one that does a live web search and a multi-provider fallback.

**Recommended direction:** Option D (hybrid: base turn charge + itemized add-ons), because it is the only option that (a) reuses System A's already-proven "different kinds cost different amounts" mechanism unmodified, and (b) doesn't force every Assistant turn to the cost of its most expensive possible path.

**Tag: RECOMMENDED — Owner Confirm.** This is a genuine pricing-model choice; the recommendation is grounded in reusing proven mechanics, not in inventing new ones, but it is not a foregone conclusion.

---

## 8. Current Pricing Inventory

All values re-read directly from `services/agent-framework/tools/tool-credit-costs.ts:12-21` this sprint (unchanged from CREDITS-01):

| Operation | Code constant | Current cost | Charged in | Called by | Production evidence | Provisional? |
|---|---|---|---|---|---|---|
| Market snapshot | `market.snapshot` | 1 | `agent-runtime.ts:448` reserve → `:519`/`:525` reconcile | Market Intelligence Agent tool calls | Live (real ledger rows since 2026-09-07) | **Yes** — file header: "PLACEHOLDER — pricing pass required (A9)" |
| Market intelligence | `market.intelligence` | 4 | same reserve/reconcile path | Market Intelligence Agent | Live | Yes |
| Backtest run | `backtest.run` | 8 | same | Agent-invoked backtest tool | Live | Yes |
| Portfolio read | `portfolio.read` | 1 | same | Agent portfolio tool | Live | Yes |
| Research knowledge search | `research.knowledge_search` | 2 | same | Research Agent | Live | Yes |
| News search | `news.search` | 2 | same | Research/Market Intelligence Agent | Live | Yes |
| Support knowledge search | `support.knowledge_search` | 2 | same | Support Agent (CS1) | Live | Yes |
| Support account read | `support.account_read` | 1 | same | Support Agent (CS1) | Live | Yes |
| Support generated-answer fallback | `SUPPORT_GENERATION_CREDIT_COST` | 5 | `generate-answer.ts:359` (best-effort, `.catch(() => {})`) | Support Agent, KB-miss path | Live | Yes — no "PLACEHOLDER" header on this constant specifically, but it shares the same un-ratified-pricing status as the table above; no product pricing memo was found anywhere in the repo for any of these nine values |
| AI Assistant (any operation) | *(none exists)* | — | — | — | Not metered | N/A — nothing to be provisional about; zero code today |

**Proposed pricing table structure** (owner fills in; no values proposed here per the brief's explicit prohibition on inventing final prices):

| Operation | Current | Proposed | Reason | Owner Approval |
|---|---|---|---|---|
| `market.snapshot` | 1 | — | — | Required |
| `market.intelligence` | 4 | — | — | Required |
| `backtest.run` | 8 | — | — | Required |
| `portfolio.read` | 1 | — | — | Required |
| `research.knowledge_search` | 2 | — | — | Required |
| `news.search` | 2 | — | — | Required |
| `support.knowledge_search` | 2 | — | — | Required |
| `support.account_read` | 1 | — | — | Required |
| Support generated answer | 5 | — | — | Required |
| AI Assistant base turn (new) | n/a | — | — | Required |
| AI Assistant + web search (new) | n/a | — | — | Required |
| AI Assistant + RAG retrieval (new) | n/a | — | — | Required |

**Tag: existing values CONFIRMED as-is-in-code and CONFIRMED provisional by their own header; final prices UNRESOLVED / OWNER DECISION REQUIRED.** Per the brief's own instruction, do **not** convert provider token cost directly into customer-facing credits unless the existing architecture already establishes that rule — it does not (no token-to-credit conversion formula exists anywhere in the repo; the nine values above are round, product-chosen-looking integers, not derived costs).

---

## 9. Plan Allowance Inventory

Re-read directly from `config/plan-limits.ts:23-80` this sprint:

| Plan | `priceYearly` (config) | `aiCredits` allowance | Current source of truth | Status |
|---|---|---|---|---|
| free | $0 | 500 | `PLAN_LIMITS.free.aiCredits`, `config/plan-limits.ts:27` | Live number, but its own file header says limits are "product configuration... until entitlement enforcement lands" — i.e., real as config, never product-priced against real credit costs |
| pro | $279 | 10,000 | `PLAN_LIMITS.pro.aiCredits:41` | Same caveat |
| elite | $949 | 50,000 | `PLAN_LIMITS.elite.aiCredits:55` | Same caveat |
| enterprise | $4,790 | 500,000 | `PLAN_LIMITS.enterprise.aiCredits:69` | Same caveat |

**Important discrepancy found this sprint (not in CREDITS-01):** the *database* `Plan` model (`prisma/schema.prisma:34-46`) has its own `price: Float` and `interval: String` fields, entirely separate from `config/plan-limits.ts`'s `priceYearly` constant — i.e., **pricing potentially exists in two places** (a DB-configurable `Plan.price` for whatever billing actually charges, and a hardcoded `priceYearly` in this config file used only for allowance/limit lookups). This sprint did not trace which one Stripe/billing actually uses for real checkout amounts — that reconciliation is out of this sprint's scope (it's a billing-config question, not a credits-contract question) but is flagged here because it directly affects whether "allowance per plan" in any future contract can be safely hardcoded next to `aiCredits` or must be resolved from the DB `Plan` row instead.

**Tag: current numbers CONFIRMED as the numbers currently in code; whether they represent a deliberate, final per-plan AI-credit allowance is UNRESOLVED — no product pricing memo exists anywhere in this repository stating these four numbers were chosen deliberately (as opposed to being an engineering placeholder carried from Sprint 14E, per the file's own header comment). OWNER DECISION REQUIRED** to ratify, adjust, or explicitly declare these as the locked allowances.

---

## 10. Billing-Period Analysis

**Confirmed current mechanism** (re-verified `allowance-resolver.ts:27-61`, `prisma/schema.prisma:50-58`): if the user has an `active` `Subscription`, the period is `[currentPeriodStart, currentPeriodEnd)` from that exact row; otherwise it falls back to the UTC calendar month. `Subscription.currentPeriodStart` defaults to `now()`, `currentPeriodEnd` has no default (schema line 55-56) — meaning a subscription row without a provider-set period end would need application logic to populate it (not traced further; out of scope for a credits contract).

**Contract options per the brief:**
1. **Subscription billing period** (credits reset per user's own subscription cycle) — this is what System A already does today for any user with an active subscription.
2. **Calendar month** (reset on the 1st) — this is what System A already does today as the *fallback* for users without an active subscription (i.e., Free plan users, by construction, always use calendar-month).
3. **Other** — no third period concept exists anywhere in the codebase; not recommending one.

**Recommended direction:** Formalize the existing dual rule as intentional product policy (subscription-period for paying plans, calendar-month for Free) rather than leaving it as an unratified engineering default. This changes nothing about behavior — it only turns already-working code into a stated policy.

**Implications requiring explicit owner input (none implemented, none decided here):**
- **Upgrade mid-period:** does the new plan's allowance apply immediately (prorated? full?) or only at the next period boundary? No code answers this today — `changePlan` (per CREDITS-01's citation of `SubscriptionActionService.ts:70-115`) changes the plan row; whether/how that interacts with an in-flight credit period was not found anywhere.
- **Downgrade mid-period:** same open question, worse case (a user who has already spent more than the lower plan's allowance mid-period — no floor/grace logic exists).
- **Cancellation:** `setCancelAtPeriodEnd` exists (per Email Sprint 1's citation, `SubscriptionActionService.ts:57-69`) but nothing ties it to credit-allowance behavior between cancellation-request and actual period end.
- **Renewal / failed payment / reactivation:** Per Email Sprint 1 §6, `invoice.payment_failed` isn't even subscribed to by the Stripe webhook handler today (`app/api/webhooks/stripe/route.ts`'s switch only handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) — there is currently no code path that would even *detect* a failed renewal to reconsider credit allowance around.

**Tag: current mechanism CONFIRMED; formalizing it as policy is RECOMMENDED; every upgrade/downgrade/cancellation/failed-payment implication above is OWNER DECISION REQUIRED / UNRESOLVED** — none of them have any existing code to point to, unlike the base period rule itself.

---

## 11. Expiration/Rollover Decision

**Evidence:** No code implements either behavior explicitly. Because "reset" is really a moving query window (`SUM(...) WHERE periodStart >= currentPeriodStart`), unused allowance from a closed period is never explicitly zeroed, refunded, or carried forward — it simply falls outside the next period's query the moment `periodStart` advances. This is functionally closest to **expire**, but it has never been stated as policy anywhere (no pricing page, plan config, or code comment asserts either rollover or expiration as intended behavior).

**Contract to resolve:**
- **Expire:** unused credits disappear at period end. This is what today's mechanism already does *by omission*, without ever having been a deliberate choice.
- **Rollover:** unused credits carry forward. Would require new logic — today's balance formula has no memory of prior periods at all (it only sums the *current* period's ledger rows against the *current* period's allowance; a prior period's unspent difference isn't tracked anywhere, so "rollover" isn't a flag to flip on the existing system, it's new accounting logic).

If rollover is chosen, these sub-questions have **zero existing evidence** and must not be invented: maximum rollover amount/cap; expiry age of rolled-over credits; behavior on a plan change (does rolled-over credit survive a downgrade?); behavior on cancellation.

**Tag: current behavior CONFIRMED (functionally "expire" by omission, never stated as policy); the actual choice is OWNER DECISION REQUIRED; every rollover sub-parameter is UNRESOLVED with zero evidence to anchor a recommendation.**

---

## 12. Low/Exhausted Semantics

**Definitions per the brief:**
- **Low:** credits remain available but crossed a configured notification threshold.
- **Exhausted:** available credits are zero, or otherwise insufficient under the final consumption rule.

**Evidence that exists today, on the *wrong* system for a future unified contract:** System B (not System A) already computes a threshold classification — `UsageService.level(used, limit)` classifies into `"ok" | "warning" | "critical"` at 75%/90% (cited by Email Sprint 1 §8, `UsageService.ts:47-52`), and `Entitlements.aiMessages.atLimit` is a direct boolean (`EntitlementService.ts:26-29`, `toEntitlement()`: `atLimit: limit > 0 && used >= limit`). This is a real, already-computed signal — but it classifies *assistant-message count*, not System A's spendable-balance concept, and nothing reads it to fire a notification (confirmed, no caller of `.level()` outside display code was found in either sprint's tracing).

**System A's real "exhausted" behavior:** `charge()` throws `InsufficientCreditsError` and writes **no ledger entry** when `available < amount` (`credit-ledger.ts:122-124`, tested `scripts/validate-agent-credit.ts` per CREDITS-01 §16) — this is System A's genuine, tested exhaustion boundary, a hard block at exactly zero *remaining relative to the next requested charge*, not a separate "zero balance" state that's computed and stored ahead of time.

**Open questions per the brief, all currently undecided in the repo:**
- Percentage-based vs. absolute low threshold — System B's 75%/90% is the only percedent in the repo, but it was built for a different metric (message count, not spendable balance) and was never ratified as *the* product threshold.
- Once-per-period vs. repeatable low notification — no notification exists at all yet, so no precedent either way.
- Once-per-period exhausted notification — same, no precedent.
- Whether a user can continue with a cheaper operation after "low" — undefined; System A's hard block only fires when a specific charge would exceed the balance, so a sufficiently cheap operation *could* still succeed near-zero under today's mechanics, but this was never stated as intended behavior.
- Whether **all** AI operations block at exhaustion, or only some — undefined for a unified system; today only Agent/Automation/Support tool calls are subject to any block at all.

**Tag: System A's real block-at-insufficient-balance behavior is CONFIRMED; System B's 75%/90% classifier is CONFIRMED to exist but not wired to anything; every specific low/exhausted product rule for a unified system is OWNER DECISION REQUIRED.**

---

## 13. Failure/Retry/Idempotency Semantics

**Confirmed, tested, real (System A only):**
- **Idempotency boundary:** `(AgentRun.id, plan-step-index)`, not a fresh attempt/request id — `credit-ledger.ts:59-62` comment, enforced by `AgentCreditLedgerEntry.idempotencyKey @unique`. A resumed/retried tick reuses the same key; the store treats a unique-constraint collision as "already applied," not an error (`credit-store.ts`'s `DuplicateLedgerEntryError` handling, `credit-ledger.ts:142-148`).
- **Retry does not double-charge:** proven by test — a well-funded run charges exactly once per tool call across a re-tick (cited by CREDITS-01 §4, `scripts/validate-agent-credit.ts:254`).
- **Failed tool call:** the reservation is **kept**, not refunded automatically — refund only fires when `actual < estimate` (a cost-accuracy correction against the tool's own reported cost, `agent-runtime.ts:524-529`), never as a failure-triggered waiver. Re-verified directly: no `refund` call anywhere in `agent-runtime.ts` is conditioned on `outcome.result.status !== "ok"`.
- **Timeout:** not specially handled — a timeout is just another terminal `AgentRunStatus` (`timeout`, per Email Sprint 1 §10's enum citation); the reservation already taken for the step in progress is not refunded by any code path found.
- **Duplicate webhook/request:** Stripe/NOWPayments webhook idempotency is a *separate* mechanism (event-id-based, per Email Sprint 1 §6) unrelated to credit-charge idempotency; the two should not be conflated in a future implementation.

**What the final architecture must avoid** (per the brief) — evaluated against current reality: accidental double charge (already prevented, tested); negative balance (already prevented at the single-charge level, see §14 for the concurrency caveat); retry multiplication (already prevented, tested); duplicate notification triggers (moot today — no notifications exist yet to duplicate); UI-only deduction (does not exist — System A's deduction is server-side and ledger-backed, never a client-side counter).

**Tag: all of the above is CONFIRMED, evidence-backed, already tested. The only OWNER DECISION REQUIRED item here is whether a failed/timed-out tool call *should* eventually be refunded** — today's real behavior is "you pay for the attempt at its estimated cost, reconciled only against actual provider cost," which is a defensible engineering default but was never ratified as product policy.

---

## 14. Concurrency Semantics

**Confirmed mechanism:** `charge()` recomputes `available = allowance - SUM(period ledger rows)` fresh on every call, then throws `InsufficientCreditsError` with **no partial write** if the requested amount would exceed it (`credit-ledger.ts:118-124`). This is read-then-check-then-write inside one method, backed by a Postgres unique index on `idempotencyKey` as the actual concurrency safety net for *duplicate* charges (a race that both tries to insert the same key is resolved by the DB's unique constraint, caught as `DuplicateLedgerEntryError`, `credit-ledger.ts:142-148`).

**Gap, confirmed by direct inspection (not present in the codebase, not overlooked by this sprint):** no `SELECT ... FOR UPDATE`, no serializable transaction, and no row lock wraps the read-then-write span of `charge()` for two *different* idempotency keys. Two genuinely simultaneous charges for the same user (e.g., two different tool calls in two different runs, each with its own unique key) could both read the same `available` balance before either write lands, both pass the `available < amount` check, and both succeed — allowing the summed total to exceed the allowance. This is a narrow window (single-digit-millisecond race, single user, two truly concurrent requests) but it is real and unaddressed today.

**Recommended direction if this is judged a real risk for a future shared Assistant+Agent load (higher request concurrency per user than today's Agent-only traffic):** wrap the balance-check-then-insert in a `SERIALIZABLE` transaction or add row-level locking (e.g., a per-user advisory lock) around `charge()`. **Not implemented in this sprint, per scope.**

**Tag: current mechanism and its gap are CONFIRMED by direct code inspection. Whether the gap needs closing before CREDITS-03, and on what timeline, is OWNER DECISION REQUIRED** — it is an engineering robustness question the owner should be aware of, not purely an implementation detail, because a unified pool serving both Assistant and Agent traffic increases the real-world odds of hitting this window.

---

## 15. Cache/RAG/Web-Search Charging Semantics

Per the brief, resolved individually, with no invented defaults:

| Scenario | Current real behavior | Charge? |
|---|---|---|
| Cached answer (a Gemini/Claude cache layer) | No answer-text cache exists anywhere in the repo — `retrieval-cache.ts` is explicitly "the RETRIEVAL cache, not the ANSWER cache" (`retrieval-cache.ts:9`, its own comment) | N/A today — nothing that charges credits has a cache in front of it; **OWNER DECISION REQUIRED** for if/when the Assistant is metered |
| Knowledge/RAG retrieval (cache hit) | Retrieval cache is real and live (K2 migration applied, per CREDITS-01 §8), stores chunk ids + similarity only, always re-hydrated/re-filtered live | **OWNER DECISION REQUIRED** — a cache hit still re-runs eligibility filtering; whether that counts as "did work" worth charging for is undecided |
| Knowledge/RAG retrieval (cache miss, live embedding query) | Real work happens (embedding + similarity search) | **OWNER DECISION REQUIRED**, though a cache-miss/live-query distinction being priced differently from a hit would be consistent with System A's existing "different kinds cost different amounts" precedent (§7) |
| Web search (Claude-native, Assistant path) | No credit reference exists; no `TOOL_CREDIT_COST_PLACEHOLDERS` entry for a generic web-search tool either (§2 finding) | **OWNER DECISION REQUIRED** — this is genuinely new pricing surface, not an extension of an existing line item |
| Claude/Gemini/OpenAI model execution (Assistant fallback chain) | Multi-provider fallback exists (`AI_ASSISTANT_ORCHESTRATION_CONTRACT.md`); no credit reference at any provider tier | **OWNER DECISION REQUIRED** — specifically whether a silent fallback (e.g., Claude fails, Gemini succeeds) should charge once or reflect the actual extra provider call |
| Agent tool execution | Charged today, tested, real (§13) | Already **CONFIRMED**: charged at reserve, reconciled to actual |
| Failed provider call (inside a tool) | Reservation kept, not refunded (§13) | **CONFIRMED** as current behavior; whether it *should* stay this way is OWNER DECISION REQUIRED |
| Timeout | Reservation kept, no special handling found (§13) | Same as above |
| Retry | Never double-charges (idempotency-key-based, §13) | **CONFIRMED**, not open |
| Partial failure (some tools in a multi-tool run succeed, some fail) | Each tool call is charged/reconciled independently (`agent-runtime.ts` per-step reserve/reconcile) and summed for the run total — a partial failure simply means some of the summed charges correspond to failed steps, with the same "keep the reservation" rule applying per-step | **CONFIRMED** as current mechanics; the underlying failure-charging policy question is the same open item as above, not a new one |

**Tag: every row marked OWNER DECISION REQUIRED has zero existing precedent to lean on except System A's general "different operation kinds can be priced differently" mechanism (§7) — a mechanism, not an answer to any specific row above.**

---

## 16. Agent Multi-Tool Run — Consumption Unit

**Confirmed, existing behavior, not a decision point:** each tool call inside one `AgentRun` gets its own reserve/reconcile idempotency key (`${run.id}:step${index}:reserve/topup/refund`, `agent-runtime.ts:446,519,525`), so a multi-tool run is charged and tracked **per tool call**, then summed into `run.creditsConsumed` (`agent-runtime.ts:532`) and available via `historyForRun()` for full per-run audit (`credit-ledger.ts:179-181`). This is real, tested (13 tests including two runtime-integration tests per CREDITS-01 §4), and does not need re-litigating.

**Tag: CONFIRMED — no owner action needed on the unit itself.** (Only the *price* of each unit, per §8, needs sign-off.)

---

## 17. Credit Reset — Authoritative Mechanism

There is currently **no discrete reset event** — only an implicit lazy reset, where `balance()`/`getUsage()` always scope their `SUM`/`COUNT` to `>= periodStart`, and `periodStart` itself moves forward automatically the instant a webhook (`app/api/webhooks/stripe/route.ts`, `app/api/webhooks/nowpayments/route.ts`) updates `Subscription.currentPeriodStart/End`. Re-confirmed this sprint: no file anywhere matches `resetCredits`/`monthlyReset`/`creditReset`/similar naming, and the five `vercel.json` crons (§2) touch nothing billing- or credit-related.

**Contract options:** (a) keep the lazy-reset mechanism exactly as-is (it already works correctly for both existing systems) and add a **detection layer** on top — e.g., compare a stored "last known `periodStart`" against the live one on each read, firing a synthetic reset event the first time it's noticed to have changed; (b) build an explicit reset job (a real state transition, not a derived one). Given both existing systems already work correctly under (a) and neither has ever needed (b), **(a) is the lower-risk recommendation** — it changes nothing about the accounting, only adds an observability layer for the email system to hook into.

**Tag: current mechanism CONFIRMED; the detection-layer approach is RECOMMENDED; whether/when to build it is OWNER DECISION REQUIRED** (this is explicitly named as one of the three things blocking Credits emails, see §18).

---

## 18. Credits Email Dependency

Per Email Sprint 1 (`AT24_EMAIL_COMMUNICATION_RECONCILIATION.md` §8) and re-confirmed this sprint: **Payment Failed** email work can proceed independently of this contract (it depends on subscribing to a Stripe/NOWPayments event, not on credits). **Credits Low / Exhausted / Reset** remain correctly blocked until this contract is locked, because:

1. There is no single number that means "remaining credits" the same way in every place a user might see it (System A's spendable balance ≠ System B's message count) — §6.
2. The system with a real, tested, enforced balance (System A) doesn't yet cover the Assistant — §5.
3. No reset *event* exists to anchor a Reset email — only a moving query window — §17.
4. Per-operation prices feeding any threshold math are explicit placeholders (§8) — a Low/Exhausted email built on placeholder prices could contradict a later pricing change.

**Future events, semantics only, not implemented:**

| Event | Intended semantic meaning (not yet built) |
|---|---|
| `credits.low` | Fires once the user's canonical balance crosses the (still-undecided, §12) low threshold within the current period. Requires: a canonical balance number (§6), a ratified threshold (§12), and a place to detect the crossing (today `balance()` is computed on-demand with no watcher). |
| `credits.exhausted` | Fires when the canonical balance reaches zero (or the final, ratified insufficiency rule, §12) for the current period. Requires the same three prerequisites as `credits.low`, plus a decision on whether this can re-fire mid-period after any partial refund brings the balance back above zero. |
| `credits.reset` | Fires when the user's billing period rolls over and their allowance becomes available again. Requires the detection layer from §17. |

**Tag: dependency chain CONFIRMED (matches Email Sprint 1's finding exactly); none of the three events are proposed for implementation in this or any adjacent sprint without an explicit go-ahead.**

---

## 19. Owner Decision Matrix

| # | Decision | Current Evidence | Recommended Direction | Owner Decision |
|---|---|---|---|---|
| 1 | Canonical ledger | `AgentCreditLedgerEntry`/`CreditLedger` is live, tested, generically-ported (§4) | Reuse it; do not build a second ledger | **Confirm** |
| 2 | AI Assistant metering | Currently zero credit references anywhere in the route (§5) | Add a new call site to the same ledger; do not convert Assistant into an Agent Framework agent | **Confirm** |
| 3 | Credit pool | One `aiCredits` number read two incompatible ways today (§6) | One shared AI Credits pool across Assistant/Agents/Automation | **Confirm** |
| 4 | Agent/Automation consumption | Already live, tested, per-tool-call (§4, §16) | Preserve existing semantics unless this contract changes them | **Confirm** |
| 5 | Tool pricing | All nine existing values are explicit placeholders (§8) | Explicit, owner-approved product pricing table | **Required** |
| 6 | Plan allowance | 500/10,000/50,000/500,000 exist in config only, never product-ratified (§9); a separate DB `Plan.price` field was found and not reconciled | Explicit, owner-approved allowance per plan; reconcile config vs. DB pricing separately | **Required** |
| 7 | Billing period | Subscription-period-or-calendar-month already implemented twice, consistently (§10) | Ratify as intentional policy; decide upgrade/downgrade/cancellation/failed-payment behavior explicitly | **Required** |
| 8 | Unused credits | Functionally "expire" by omission today, never stated as policy (§11) | State explicitly: expire or rollover, with all sub-parameters if rollover | **Required** |
| 9 | Low threshold | No canonical-balance threshold exists; System B has an unrelated 75%/90% classifier never wired to notifications (§12) | Explicit fixed/percentage rule against the canonical balance | **Required** |
| 10 | Exhausted state | System A hard-blocks at insufficient balance per-charge (real, tested); no user-facing "exhausted" state exists (§12) | Explicit blocking semantics for a unified, user-facing system | **Required** |
| 11 | Failed AI request | Charged at estimate, no refund on failure today (§13) | Define charge/refund semantics explicitly | **Required** |
| 12 | Retry | Proven non-double-charging via idempotency key (§13) | No change needed; confirm as locked behavior | **Confirm** |
| 13 | Concurrent requests | Hard block per single charge; real race window across two simultaneous different-key charges (§14) | Confirm hard-block policy; decide whether/when to close the race window | **Required** (policy) / flagged (engineering) |
| 14 | Cached response | No answer cache exists yet; only a retrieval cache (§15) | Explicit charge/no-charge rule before Assistant metering ships | **Required** |
| 15 | RAG-only response | Retrieval cache is real; charging semantics undefined (§15) | Explicit charge/no-charge rule | **Required** |
| 16 | Web search | No cost line item exists anywhere for it (§8, §15) | Explicit tool/search charge semantics — new pricing surface | **Required** |
| 17 | Agent multi-tool run | Per-tool-call charging, summed per run — already real (§16) | Document as-is; no change | **Confirm** |
| 18 | Credit reset | No discrete event; lazy reset via moving query window (§17) | Add a detection layer on top of the existing mechanism; do not replace the mechanism | **Required** |
| 19 | Dashboard | Fully stale, static "not built" text (§2) | Update only after this contract locks | **Later** |
| 20 | Credit emails | Blocked on this contract per §18 | Implement only after this contract locks | **Later** |

No row above has been filled with an invented approval. Every "Confirm" row still requires the owner's explicit yes; every "Required" row has no default value proposed.

---

## 20. Explicit Unresolved Items

Listed once, not padded, carried forward from the sections above:

1. Whether the AI Assistant should be metered at all in the near term, and on what timeline (§5).
2. Whether one shared pool or per-surface pools is the intended product model (§6).
3. Final per-operation credit prices for all nine existing tool/generation costs, plus new Assistant-side operations (§8).
4. Final per-plan AI-credit allowances — and separately, reconciling `config/plan-limits.ts`'s `priceYearly` against the DB `Plan.price` field, which this sprint found are two independent numbers with no confirmed single source of truth (§9).
5. Upgrade/downgrade/cancellation/failed-payment/reactivation effects on an in-flight credit period — zero existing code addresses any of these (§10).
6. Expire vs. rollover for unused credits, and every rollover sub-parameter if rollover is chosen (§11).
7. Low-threshold definition (percentage vs. absolute, repeatable vs. once-per-period) and exhausted-state exact blocking rule for a unified, user-facing system (§12).
8. Whether failed/timed-out AI operations should ever be refunded, for either existing (Agent/Automation) or future (Assistant) surfaces (§13, §15).
9. Whether the un-locked concurrency race window (§14) needs closing before a unified pool goes live, and on what timeline.
10. Cache-hit, RAG-retrieval, and web-search charging rules for the Assistant — genuinely new surface with zero existing precedent beyond System A's general "different kinds, different prices" mechanism (§15).
11. Whether Quant Lite / Algo Testing Pro purchases should ever interact with the AI credit pool — carried forward unchanged from CREDITS-01 §25.8; this sprint found no new evidence either way.

---

## 21. CREDITS-03 Implementation Prerequisites

Before any implementation sprint (CREDITS-03) is authorized, the following must exist as owner-ratified answers to this document, not engineering defaults:

1. Signed-off answers to Decision Matrix rows 1–4 (architecture: canonical ledger, Assistant integration approach, pool structure, preserved Agent/Automation semantics) — these are the load-bearing structural decisions everything else depends on.
2. A real, committed pricing table (row 5) replacing every value in `TOOL_CREDIT_COST_PLACEHOLDERS` and `SUPPORT_GENERATION_CREDIT_COST`, plus new line items for whatever Assistant operations are approved for metering (row 16).
3. Ratified per-plan allowances (row 6), including resolution of the `config/plan-limits.ts` vs. DB `Plan.price` discrepancy found in §9 (a billing-config question this sprint flags but does not resolve).
4. An explicit billing-period policy statement (row 7) covering the mid-period edge cases listed in §10, even if the answer for several of them is "no special handling, documented as such."
5. An explicit expire-or-rollover ruling (row 8), with all sub-parameters if rollover is chosen.
6. Explicit low/exhausted thresholds and blocking semantics (rows 9–10).
7. Explicit failed-request, retry, and concurrent-request policy (rows 11–13), including a decision on whether to close the concurrency race window identified in §14 before or after initial launch of a unified pool.
8. Explicit cache/RAG/web-search charging rules (rows 14–16) — required before the Assistant is metered, not after, since it already has a live retrieval cache today that a metering rollout would otherwise silently interact with.
9. Confirmation that `/dashboard/credits` and Credits emails (rows 19–20) remain correctly out of scope until all of the above lands — i.e., CREDITS-03 should not attempt UI or email work in the same pass as the ledger-extension work, per the same separation-of-concerns this sprint itself followed.

---

## 22. Validation Gate

- Existing production Agent Framework ledger inspected — §2, §4, §13, §14, §16 (re-read `credit-ledger.ts`, `agent-runtime.ts:440-534`, `allowance-resolver.ts`, `AN1.11-agent-credit-ledger.md` in full).
- Existing production credit consumption inspected — §2, §8 (re-read `tool-credit-costs.ts`, `generate-answer.ts` charge lines).
- Automation consumption reconciled — §2, §16 (re-read `dispatcher.ts` credit-related lines directly, confirmed the locked contract comment verbatim).
- Main AI Assistant path inspected — §2, §5 (re-read `app/api/private/knowledge/chat/route.ts` header in full, confirmed zero credit references via direct grep).
- Billing/entitlement source inspected — §2, §6, §9 (re-read `EntitlementService.ts`, `UsageMeteringService.ts`, `plan-limits.ts` in full).
- Existing pricing/constants inspected — §8 (re-read `tool-credit-costs.ts` in full, confirmed all nine values and the placeholder header).
- Plan allowances inspected — §9 (re-read `plan-limits.ts` in full; additionally found and flagged the DB `Plan.price` discrepancy, new this sprint).
- Reset semantics inspected — §17 (re-read `vercel.json` crons in full, confirmed none touch credits).
- Failure/retry semantics inspected — §13 (re-read reserve/reconcile lines directly).
- Concurrency/idempotency inspected — §14 (re-read `charge()`'s read-then-write span directly, confirmed the un-locked race window by inspection).
- Credits dashboard stale state documented — §2 (re-read `app/dashboard/credits/page.tsx` in full).
- Email dependency documented — §18 (cross-referenced Email Sprint 1 directly).
- All owner decisions explicitly separated — §19 (Confirm / Required / Later, no invented approvals).
- No application code changed — confirmed, see §23 below.
- No Prisma/schema/migration changed — confirmed.
- No UI changed — confirmed.
- No production data changed — confirmed (read-only inspection throughout; no scripts executed against any database).
- Exactly one new documentation file exists — confirmed.
- Working tree contains no unrelated changes — confirmed, see §23.

---

## 23. Git Safety Record

```
git fetch origin main            → 59f481a (merge of PR #99, CREDITS-01)
git checkout -b docs/credits-product-contract origin/main
                                  → confirmed base includes CREDITS-01, merged
git status (before this file)    → clean, only this new file added
git diff --stat origin/main      → 1 file changed: docs/architecture/AT24_CREDITS_PRODUCT_CONTRACT.md
git diff --name-only origin/main → docs/architecture/AT24_CREDITS_PRODUCT_CONTRACT.md
```

No `.prisma` schema edits, no new migration folder, no `package.json` change, no edits under `app/`, `components/`, `services/`, `config/`, or any UI file. The only file created or modified in this sprint is this document.

---

*(Note on path: this repository's actual documentation tree places architecture docs at `frontend/docs/architecture/`, not a repo-root `docs/architecture/` — this file follows the same convention as the two prior reconciliation documents it builds on, both of which live at `frontend/docs/architecture/`.)*
