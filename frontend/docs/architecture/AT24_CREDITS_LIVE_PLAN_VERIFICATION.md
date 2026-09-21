# AT24 AI Credits — Live Plan Data Verification

**Sprint:** CREDITS-02.5 — Live Plan Data Verification
**Status:** READ-ONLY DISCOVERY / RECONCILIATION ONLY. No application code, schema, migration, config, UI, or production data was changed to produce this document.
**Date:** 2026-09-21
**Branch:** `docs/credits-live-plan-verification` (based on the current worktree HEAD, which includes CREDITS-02, PR #103 → `1d9f414`)
**Builds on:**
- `docs/architecture/AT24_CREDITS_METERING_RECONCILIATION.md` (CREDITS-01, merged PR #99 → `59f481a`)
- `docs/architecture/AT24_CREDITS_PRODUCT_CONTRACT.md` (CREDITS-02, merged PR #103 → `1d9f414`)

---

## 0. Live Production DB Query — Result

**A live, read-only query against the production `Plan` table could NOT be executed from this environment.** This is an infrastructure/environment limitation, not a decision to skip it. Exact chain of evidence:

1. This sprint runs in an isolated git worktree (`E:\algotraders24-ai-platform\.claude\worktrees\agent-a4ae85bdd7dbc2dd5`) created fresh for this task. It contains no `.env`, `.env.local`, or `.env.production` file — only `frontend/.env.example` (all values blank) is present. `printenv` in the shell confirms no `DATABASE_URL` or `DIRECT_URL` is set in the process environment either.
2. `frontend/lib/prisma.ts` reads `process.env.DATABASE_URL` at runtime via `PrismaPg` (Prisma 7 driver adapter, no built-in engine fallback) — with it unset, `new PrismaPg({ connectionString: undefined })` cannot connect.
3. `frontend/prisma.config.ts` (used by the Prisma CLI) requires `DIRECT_URL` to even load: `npx prisma generate` initially failed with `PrismaConfigEnvError: Cannot resolve environment variable: DIRECT_URL`. Supplying a dummy value let `generate` succeed (schema→client codegen needs no DB connection), but a real query still requires the real credential, which does not exist in this worktree.
4. A temporary, disposable, read-only script (`prisma.plan.findMany()`, no writes) was written, run, and then deleted per this sprint's own no-artifacts rule. It failed with an `Invalid prisma.plan.findMany() invocation` runtime error because no real connection string was ever supplied — confirmed via an explicit `DATABASE_URL present: false` log line printed immediately before the failure.
5. No credential store, secret manager, or Vercel-env-pull mechanism is available in this sandboxed session to obtain the real production connection string, and per this sprint's own Absolute Safety Rule and section 6's instruction, this document does **not** attempt to guess, fabricate, or carry over any previously-seen DB row values as if they were freshly verified.

**Consequence:** Sections 2 ("Production Plan Snapshot") and the DB columns of section 4 below are marked **NOT AVAILABLE THIS SPRINT** rather than filled with invented numbers. Every other required section (config snapshot, code-path reconciliation, price-source proof, credit-allowance-source proof, interval semantics, legacy-plan search) is fully answered from direct, re-verified repository evidence, because none of it requires a live DB connection — it is either static config or an explanation of which code paths read `Plan.id`/`Plan.price`/`Plan.interval`, not what the current values of those columns are.

**Recommended immediate follow-up (not performed here, per scope):** re-run the exact read-only query this sprint prepared (`prisma.plan.findMany({ orderBy: { sortOrder: "asc" } })`) from an environment that has the real `DATABASE_URL`/`DIRECT_URL` (e.g., the main working checkout, or `vercel env pull` into a throwaway `.env.local` that is never committed), and paste the raw result into section 2 below, replacing the placeholder table. Nothing else in this document needs to change once that is done — every reconciliation below is already keyed off `Plan.id`, `Plan.price`, `Plan.interval` by name, not by assumed value.

---

## 1. Purpose

CREDITS-02 identified one remaining evidence gap before the AI Credits allowance contract can be locked: `config/plan-limits.ts`'s four `aiCredits` values (500 / 10,000 / 50,000 / 500,000) are config-only and self-declared as "not yet product-ratified," while a separate DB `Plan.price`/`Plan.interval` pair exists and was found, but not reconciled, in CREDITS-02 §9. This sprint (CREDITS-02.5) was scoped to close that gap with a **live production DB read** of the `Plan` table, plus a full trace of every code path that reads `Plan.id`/`Plan.price`/`Plan.interval` or `config/plan-limits.ts`'s `aiCredits`/`priceYearly`, so a future CREDITS-03 implementation sprint is not built on an unverified assumption about what plans actually exist and what actually prices them.

The live DB read itself could not be completed in this environment (§0). Everything else the brief asked for — code-path tracing, config-vs-code-contract reconciliation, canonical price/allowance source identification, interval semantics, and a legacy/duplicate-plan search — was completed and independently re-verified against current code.

---

## 2. Production Plan Snapshot

**NOT AVAILABLE THIS SPRINT — see §0 for the exact reason (no `DATABASE_URL`/`DIRECT_URL` credential reachable from this isolated verification worktree).**

Template to fill in once a live read-only query is run (`prisma.plan.findMany({ orderBy: { sortOrder: "asc" } })` against `frontend/lib/prisma.ts`'s Prisma client, or the equivalent `SELECT id, name, price, interval, "isActive", "sortOrder", features, "createdAt", "updatedAt", "deletedAt" FROM "Plan" ORDER BY "sortOrder" ASC;`):

| DB Plan ID | Plan Name | DB Price | DB Interval | Relevant Credit Field(s) |
|---|---|---|---|---|
| *(unfilled)* | | | | *(none exist on `Plan` — see §6)* |

**Best available proxy evidence (code, not a live row read — do not treat as a substitute for §0's recommended follow-up):** `frontend/prisma/seed.ts:12-28` (`seedPlans()`) is the only place in the repository that writes `Plan` rows, and it is an idempotent `upsert` keyed on `id`, run as part of the documented seed flow (`main()` → `seedPlans()`). It defines **exactly four rows**, one per commercial plan, every one with `interval: "month"`:

| Seed-script `id` | Seed-script `name` | Seed-script `price` | Seed-script `interval` | `sortOrder` |
|---|---|---|---|---|
| `free` | Free | 0 | month | 1 |
| `pro` | Pro | 29 | month | 2 |
| `elite` | Elite | 99 | month | 3 |
| `enterprise` | Enterprise | 499 | month | 4 |

This is the intended/provisioned shape of the table, not a confirmation of its current live contents — the live table could have drifted from the seed script (manual admin edits via `AdminSubscriptionService`/Stripe/NOWPayments flows only ever mutate `Subscription`/`User.planId`, never `Plan` rows themselves, per §8 below, which makes drift unlikely but not impossible without a live read).

---

## 3. Config Snapshot

Re-read in full this sprint, `frontend/config/plan-limits.ts:23-80` (unchanged from CREDITS-01/02):

| Plan | `priceYearly` | `aiCredits` | `maxAgents` | `maxAutomations` | `maxKnowledgeDocuments` | `storageLimit` (MB) | `teamMembers` |
|---|---|---|---|---|---|---|---|
| free | $0 | 500 | 1 | 2 | 10 | 100 | 1 |
| pro | $279 | 10,000 | 5 | 25 | 200 | 5,000 | 3 |
| elite | $949 | 50,000 | 20 | 100 | 1,000 | 25,000 | 10 |
| enterprise | $4,790 | 500,000 | 100 | 1,000 | 100,000 | 500,000 | 100 |

File header (`plan-limits.ts:1-6`, verbatim): "Pricing, names, and feature lists live in the database (Plan table). Limits are product configuration, not user data, so they live in code until entitlement enforcement lands in Sprint 15A." This self-declared status is unchanged since CREDITS-01/02 — these four `aiCredits` numbers are still not stated anywhere in the repository as a deliberately product-ratified allowance.

`isPlanId()` (`plan-limits.ts:82-84`) hard-codes the same four keys (`"free" | "pro" | "elite" | "enterprise"`) as the only valid `PlanId` values anywhere in the app (`types/billing.ts:15`, `config/billing.config.ts:13` `PLAN_IDS`). No fifth key exists in config anywhere.

---

## 4. DB vs Config Reconciliation

| Plan | Config AI Credits | DB Plan ID (expected, per code contract) | DB Price (seed-script value; live value NOT VERIFIED) | DB Interval (seed-script value; live value NOT VERIFIED) | Match? | Notes |
|---|---|---|---|---|---|---|
| free | 500 | `free` | 0 (seed) | month (seed) | **Code-contract match, live row unverified** | `isPlanId("free")` gates every join point below |
| pro | 10,000 | `pro` | 29 (seed) | month (seed) | **Code-contract match, live row unverified** | Same gate |
| elite | 50,000 | `elite` | 99 (seed) | month (seed) | **Code-contract match, live row unverified** | Same gate |
| enterprise | 500,000 | `enterprise` | 499 (seed) | month (seed) | **Code-contract match, live row unverified** | Same gate |

**How the mapping is actually proven in code (not assumed):** `services/billing/adapters/planAdapter.ts:9-33` (`toPlan()`) is the one place a DB `Plan` row and `config/plan-limits.ts` are merged into the single UI-facing `Plan` object the Billing dashboard renders. It explicitly calls `isPlanId(row.id)` and **returns `null` (silently drops the row) if the DB `id` is not one of the four config keys** (`planAdapter.ts:10`). This means:
- The mapping is enforced by code, not by convention: any DB `Plan` row whose `id` is not exactly `free`/`pro`/`elite`/`enterprise` is invisible to the Billing dashboard today (dropped by `toPlans()`, `planAdapter.ts:35-37`).
- `services/agent-framework/credits/allowance-resolver.ts:49-50` applies the identical gate independently (`isPlanId(sub?.planId ?? user?.planId ?? "free") ... : "free"`) before reading `PLAN_LIMITS[planId].aiCredits` — a `User.planId`/`Subscription.planId` value that isn't one of the four falls back to `"free"`'s allowance, never errors.
- Both of these are **defensive fallbacks that hide a real DB/config ID mismatch rather than surfacing it** — if a live DB `Plan.id` were, say, `"pro-legacy"` or `"pro_v2"`, the Billing dashboard would simply not show that plan card, and any user on it would silently get the Free allowance from the credit ledger. This is a real risk surface worth the owner's attention once live rows are confirmed (§0's follow-up), not something this sprint found evidence of actually happening.

**Conclusion:** the four config plan keys are proven, by direct code inspection, to be the only keys every consumer (Billing dashboard, Stripe checkout, NOWPayments invoice, Agent Framework credit ledger, admin override) is written to handle. Whether the live DB table's `id` column literally contains exactly these four strings — and nothing else — is the one fact this sprint could not confirm (§0).

---

## 5. Canonical Billing Price Source

**CANONICAL BILLING PRICE SOURCE: DB `Plan.price` — CONFIRMED (independently re-verified this sprint, not merely repeated from CREDITS-02).**

Every real money-moving code path reads `Plan.price` directly from Prisma, never `config/plan-limits.ts`'s `priceYearly`:

- **Stripe subscription checkout** — `services/billing/providers/StripeProvider.ts:79-86`: `const plan = await prisma.plan.findUnique(...)`; `if (!plan || plan.price <= 0) throw ...`; `const unitAmount = Math.round(plan.price * 100)`. The billing interval sent to Stripe (`recurring.interval`) comes from the **caller-supplied `cycle` parameter** (`params.cycle === "yearly" ? "year" : "month"`), not from `plan.interval` (see §7).
- **Self-service plan change** — `services/billing/SubscriptionActionService.ts:70-79` (`changePlan()`): reads `prisma.plan.findUnique(...)`; blocks any change to a plan with `plan.price > 0` (`PaymentRequiredError`) since no payment has been collected — proof that `Plan.price`, not config, is what gates "is this plan free."
- **NOWPayments crypto invoice** — `app/api/private/billing/crypto-invoice/route.ts:36-40`: `const plan = await prisma.plan.findUnique(...)`; `if (!plan || plan.price <= 0) ...`; `const priceUsd = cycle === "yearly" ? plan.price * 12 : plan.price` — the yearly amount is **computed as 12× the DB monthly `Plan.price`**, not read from config's independent `priceYearly` figure. This means, today, the "yearly" price a NOWPayments buyer actually pays is mathematically `12 × Plan.price`, which is a different number from `config/plan-limits.ts`'s `priceYearly` unless the two happen to already agree (e.g., for `pro`: DB seed price $29 × 12 = $348, vs. config `priceYearly` $279 — these are **not the same number** in the seed data, a live discrepancy worth flagging to the owner once live rows confirm this is still true in production).
- **Stripe webhook purchase/renewal confirmation emails** — `app/api/webhooks/stripe/route.ts:41,48` (`notifySubscriptionActive`), `:246`, `:271` — every email that states an amount reads `prisma.plan.findUnique(..., select: { price: true })`, never config.
- **Admin override** — `services/admin/AdminSubscriptionService.ts:120` reads `prisma.plan.findUnique(...)` to validate the target plan exists before granting it (admin overrides don't charge, but still validate against the DB row, not config).
- **UI merge point** — `services/billing/adapters/planAdapter.ts:18` explicitly assigns `priceMonthly: row.price` (the DB value) while `priceYearly: limits.priceYearly` (the config value) — i.e., the UI's own `Plan` type structurally documents that these are two independently-sourced numbers, one from the DB, one from config, merged into one object for display.

**No code path found anywhere that uses `config/plan-limits.ts`'s `priceYearly` for an actual charge amount.** `priceYearly` is read only for marketing/display purposes: `sections/Pricing.tsx:18,62` (homepage pricing teaser, explicit header comment: "prices are the real priceYearly values... monthly pricing lives in the DB Plan table and is deliberately not fabricated here"), `sections/PricingTeaser.tsx:44`, `components/billing/PlanCard.tsx:72-74`, `services/billing/PricingService.ts` (yearly-savings math for display only).

---

## 6. AI Credits Allowance Source

**CURRENT AI CREDIT ALLOWANCE SOURCE: `config/plan-limits.ts`'s `PLAN_LIMITS[planId].aiCredits` — CONFIRMED, and this is the number actually enforced in production, not merely displayed.**

**CURRENT PRODUCTION ENFORCEMENT:** the real, already-live Agent Framework Credit Ledger. Traced end-to-end this sprint:
- `services/agent-framework/runtime/agent-runtime.ts:44,137` — `AgentRuntime` constructs its `creditLedger` via `createCreditLedger()` (production factory, `services/agent-framework/credits/index.ts:32`) unless a test double is injected.
- `services/agent-framework/credits/index.ts:32` — `createCreditLedger()` wires `new CreditLedger({ store: new PrismaCreditStore(), allowances: new PlanAllowanceResolver() })` — the real `AgentCreditLedgerEntry`-backed store plus the real plan-based allowance resolver.
- `services/agent-framework/credits/allowance-resolver.ts:37-62` (`PlanAllowanceResolver.resolve()`) — reads the user's `planId` from `Subscription` (if active) or `User.planId`, gates it through `isPlanId()` (fallback `"free"`), then: `const allowance = PLAN_LIMITS[planId as keyof typeof PLAN_LIMITS].aiCredits;` — **this is the exact, single line that makes `config/plan-limits.ts` the production allowance source**, with its own header comment confirming this is a locked, deliberate choice: "LOCKED (owner P3 / A9): no pricing changes. The allowance is exactly the existing `PLAN_LIMITS[plan].aiCredits`."
- `services/agent-framework/credits/credit-ledger.ts:82-124` — `balance()`/`charge()` compute `allowance - SUM(ledger amounts this period)` and throw `InsufficientCreditsError` (no ledger entry written) when a charge would exceed it — this is the real, tested exhaustion boundary.
- `agent-runtime.ts:448,519,525` — `this.creditLedger.charge(...)` / `.refund(...)` are called from the real reserve→execute→reconcile flow for every Agent tool call (Market Intelligence, Research, Support Agent, and Automation via its child `AgentRun`), per `TOOL_CREDIT_COST_PLACEHOLDERS` (`services/agent-framework/tools/tool-credit-costs.ts:12-21`, still explicitly placeholder pricing) and `services/support/generate-answer.ts:108` (`SUPPORT_GENERATION_CREDIT_COST = 5`).

**CURRENT DISPLAY SOURCE:** two independent, disagreeing surfaces, both ultimately reading the *same* config ceiling but computing *usage* two different ways — this is System A / System B exactly as CREDITS-02 §2/§6 described, independently re-confirmed this sprint with fresh line references:
1. **`/dashboard/billing`** — `services/billing/BillingEngine.ts:118-133` (`getMetrics()`) → `usage.getCreditsRemaining()/getCreditsTotal()` → `services/billing/UsageService.ts:66-72` → `this.entitlements.aiMessages.{remaining,limit}` → `services/billing/EntitlementService.ts:52` (`toEntitlement(usage.aiMessages, limits.aiCredits)`) → `limits = PLAN_LIMITS[planId]` (same config source) but `usage.aiMessages` = **a count of `Message` rows with `role: "assistant"`** (`services/billing/UsageMeteringService.ts:33-38`), a completely different metric from the Agent Framework ledger's spendable-balance accounting. Enforcement-wise this path is read-only/display-only (`UsageMeteringService.ts:2-9`, `EntitlementService.ts:10-14`, both re-read this sprint, unchanged: "adds zero writes," "Enforcement... intentionally NOT wired").
2. **`/dashboard/credits`** (the dedicated ACCOUNT/Credits page) — `app/dashboard/credits/page.tsx:38-43` shows a static "Not yet available" badge and explicitly states "there is no balance to show here... pricing and the credit policy have not been finalized," reading only an inert label map (`types/credits.ts`). This page reflects **neither** System A nor System B — it predates both and has not been updated to point at the now-live Agent Framework ledger.
3. **Homepage/marketing pricing** (`sections/Pricing.tsx:28`) shows `PLAN_LIMITS[id].aiCredits` directly as "X AI credits / month" copy — config, display-only, no live usage math at all.

**Conclusion, stated plainly:** the number that actually gates whether an Agent tool call is allowed to run today is `config/plan-limits.ts`'s `aiCredits`, consumed through the real, tested, production `CreditLedger`/`PlanAllowanceResolver` path — not the DB `Plan` table (which has no credit/quota/entitlement column at all, confirmed by full-schema search, see §0/§6 note below) and not the `/dashboard/billing` display number (a different, message-count-based metric that happens to share the same ceiling by coincidence of both reading the same config constant).

**No DB field related to AI credits, usage, quota, allowance, or entitlement exists anywhere in `prisma/schema.prisma`.** Confirmed by a full-file search (`grep -n "credit|quota|entitlement|allowance"` across all 2,674 lines): the only matches are (a) `AgentCreditLedgerEntry` itself (the real ledger table, keyed by `userId`, not `Plan`), (b) `AutomationRun.creditsUsed`/`AutomationStepRun.creditsUsed` (denormalized copies of the same ledger's per-run sum), and (c) doc comments. The `Plan` model (`schema.prisma:35-48`) has exactly seven real columns: `id, name, price, interval, features, isActive, sortOrder` (plus the standard `createdAt/updatedAt/deletedAt`) — no credit-related column of any kind.

---

## 7. Interval Semantics

**What `Plan.interval` actually is, proven by tracing every reader of it:**

- `prisma/schema.prisma:39` — `interval String @default("month")` — a plain string column, no enum, no CHECK constraint.
- `prisma/seed.ts:14-17` — every one of the four canonical rows the seed script provisions has `interval: "month"`. **No row is ever seeded with `interval: "year"`.** There is exactly one row per commercial plan, not one row per (plan × interval) combination.
- `app/api/private/plans/route.ts:20-32` — the one API route that lists plans passes `interval: p.interval` straight through to the client as part of the plan catalogue payload.
- `services/api/BillingApi.ts:21` — the client-side `ApiPlan` type declares `interval: string`, but **no consumer of `BillingApi.listPlans()` was found reading `.interval` for any branching logic** — `services/billing/adapters/planAdapter.ts` (the only transform applied to these rows) never reads `row.interval` at all; it only reads `row.id`, `row.name`, `row.price`, `row.features`.
- `services/marketplace/MarketplaceCatalogue.ts:86` reads a *different* `interval` field, on `MarketplaceListing.pricing` (marketplace product pricing, unrelated to subscription `Plan.interval` — a naming coincidence, not the same concept).

**The actual monthly/yearly billing-cycle decision is made entirely independently of `Plan.interval`:** both `StripeProvider.createCheckoutSession()` (`StripeProvider.ts:76,97`) and the NOWPayments crypto-invoice route (`crypto-invoice/route.ts:34,40`) take a `cycle: "monthly" | "yearly"` parameter **supplied by the client request**, not derived from the DB row's `interval` column. Yearly Stripe checkout sets `recurring.interval = "year"` on an inline `price_data` object (never reads `plan.interval`); yearly NOWPayments pricing multiplies `plan.price * 12` (again never reads `plan.interval`).

**Conclusion — direct answer to the brief's exact question:** production does **not** use multiple `Plan` rows to represent monthly/yearly variants of the same commercial plan (one row per plan, always `interval: "month"`, per the seed script), and the `Plan.interval` column, while it exists in the schema and is exposed by the plans API, is **not read by any pricing, checkout, or entitlement logic found in this codebase** — it is present but functionally vestigial today. The yearly/monthly distinction that actually reaches Stripe/NOWPayments is carried by a request-time `cycle` parameter and (separately, for display only) by config's `priceYearly`, never by `Plan.interval`. Whether the live DB table's rows still all say `"month"` — matching the seed script — could not be confirmed without the live read (§0), but no code path was found anywhere that would produce or expect a `"year"`-interval `Plan` row.

---

## 8. Legacy / Extra Plans

**Code-level search performed:** full-repository search for legacy plan names, deprecated plan IDs, "Quant Lite"/"Quant Pro" as billing plans, test/internal plan markers, and duplicate Pro/Elite/Enterprise variants.

| Candidate | Status evidence | Used by production? | Relevant to AI Credits? | Include/exclude recommendation |
|---|---|---|---|---|
| A fifth/legacy `PlanId` in config | `types/billing.ts:15` (`PlanId = "free" \| "pro" \| "elite" \| "enterprise"`), `config/billing.config.ts:13` (`PLAN_IDS`), `config/plan-limits.ts:82-84` (`isPlanId()`) — all three independently enumerate the exact same four values, nowhere else in the repo declares a fifth | No — the type system has no fifth value to use | N/A | Exclude anything not in this set (already structurally impossible in TypeScript-typed call sites) |
| Duplicate `Plan`-shaped Prisma model | Full-schema search for `^model \w*[Pp]lan\w*` returns exactly one match: `model Plan` (`schema.prisma:35`) | N/A | N/A | No duplicate model exists |
| "Quant Lite" | `services/quant-lite/*`, `app/quant-lite/*`, `data/quant-lite-*` — a distinct, separately-gated **product feature** (deterministic backtesting), not a subscription `Plan` row; explicitly "Deterministic Quant backtesting is not credit-metered" (`app/dashboard/credits/page.tsx:47`) | Yes, as a product feature — irrelevant to the `Plan` table | No — not billed via `Plan`, not credit-metered | Not a plan; exclude from any Plan-table reconciliation (false-positive from a "quant" name search, not an actual legacy plan) |
| `Billing` model rows with historical `planId: "free"`/`"pro"` strings | `prisma/schema.prisma:508-520` (`model Billing`) — a flat historical record table (`userId, planId, status, amount`), string `planId` with **no FK to `Plan`**, used only for the invoice-history list, never for pricing/entitlement lookups | Yes, historically-descriptive only | No | Not a "plan" in the Plan-table sense; out of scope for this reconciliation |
| Admin-only `enterprise`/`free` overrides | `services/admin/AdminSubscriptionService.ts:118-145` (`overridePlan()`) — reuses the same four `isPlanId()`-gated values, no separate "admin plan" concept | Yes, as an audit-logged admin action on the same four plans | Same allowance source as any other plan | Not a distinct/legacy plan — same four IDs |
| Test/mock plan ids in validation scripts | `scripts/validate-billing-entitlements.ts:137` passes `"not-a-real-plan"` **specifically to test the invalid-plan fallback path** (falls back to `"free"`'s limits) | No — test-only, never touches the real DB `Plan` table | No | Test fixture, not a real or legacy plan |

**Conclusion:** no evidence of a legacy, deprecated, duplicate, or test `Plan` row was found anywhere in the current codebase — every code path that creates, reads, or validates a `Plan`/`PlanId` is hard-gated to the same four values (`free`/`pro`/`elite`/`enterprise`). This is a strong code-level guarantee that the *intended* plan set is exactly these four. **It is not a substitute for actually reading the live table** (§0) — a stale or manually-inserted row with an unexpected `id` (e.g., from a pre-14D migration era, or a hand-run SQL fix) would be silently invisible to `planAdapter.toPlan()` (§4) rather than surfaced as an error, so its presence or absence cannot be fully ruled out without the live read this sprint could not perform.

---

## 9. Candidate Plan-to-Credit Mapping

Per the brief's explicit instruction: this is a **candidate mapping only**, not a final decision. Every "Current Config AI Credits" value below is unchanged from CREDITS-02 and remains **OWNER DECISION REQUIRED** exactly as CREDITS-02 §9/§19 (row 6) already stated — this sprint found no new evidence anywhere in the repository that these four numbers were ever deliberately, product-ratified (as opposed to carried forward as an engineering placeholder from Sprint 14E).

| Commercial Plan | Canonical DB Plan(s) | Current Config AI Credits | Evidence Status | Owner Approval |
|---|---|---|---|---|
| Free | `free` (per seed script; live row **unverified**, §0) | 500 | Config value CONFIRMED as-is-in-code; product-ratification status UNRESOLVED; live DB row unverified this sprint | **Required** |
| Pro | `pro` (per seed script; live row **unverified**, §0) | 10,000 | Same | **Required** |
| Elite | `elite` (per seed script; live row **unverified**, §0) | 50,000 | Same | **Required** |
| Enterprise | `enterprise` (per seed script; live row **unverified**, §0) | 500,000 | Same | **Required** |

No row in this table has been finalized or silently approved by this sprint.

---

## 10. Remaining Contract Decisions

Only genuinely still-unresolved items are listed here (not a re-listing of CREDITS-02's full 20-item Owner Decision Matrix, which stands as-is and is unaffected by this sprint's findings):

1. **The live production DB read for the `Plan` table (this sprint's primary mandate) is still outstanding** — §0. Recommended immediate next step: re-run `prisma.plan.findMany({ orderBy: { sortOrder: "asc" } })` from an environment with the real `DATABASE_URL`/`DIRECT_URL`, and paste the result into §2 above. This is pure data-gathering, requires no code/schema/config change, and should be low-effort once run from a connected environment (e.g., the primary working checkout rather than this isolated verification worktree).
2. **New this sprint — the DB `Plan.price` × 12 vs. config `priceYearly` discrepancy is now confirmed as a real, live-code computation, not just a "field exists in two places" observation** (§5): NOWPayments yearly checkout literally computes `plan.price * 12`, which — using the seed-script's own values — would charge a Pro-plan yearly buyer $348 (`$29 × 12`) via NOWPayments, while the same buyer would see $279 advertised on the homepage (`config/plan-limits.ts`'s `priceYearly`) and presumably via Stripe's yearly `recurring.interval` (Stripe's yearly price is also computed from `plan.price`, but note: `StripeProvider.createCheckoutSession()` passes the **same `unitAmount = plan.price * 100`** as the line-item amount regardless of `cycle`, only changing `recurring.interval` to `"year"` — meaning a Stripe yearly subscription would be **billed the monthly price every year**, not `plan.price * 12`, which is a *different* bug/discrepancy from the NOWPayments one and directly contradicts the $279/$949/$4,790 yearly prices advertised on the homepage). **This is a real, code-confirmed billing-consistency question the owner should be aware of before CREDITS-03 or any yearly-billing push, independent of the AI Credits contract itself** — flagged here because it was surfaced by this sprint's price-source tracing, but it is a billing-correctness issue, not a credits-allowance issue, and this sprint does not attempt to fix it (out of scope, no application code was changed).
3. **The `planAdapter.toPlan()` / `PlanAllowanceResolver.resolve()` silent-fallback-on-unknown-`planId` behavior** (§4) — both paths default to `"free"`'s treatment (dropped from display, or free-tier allowance) rather than erroring, if a live `User.planId`/`Subscription.planId`/DB `Plan.id` value is ever outside the four known keys. Whether this fail-safe-to-Free behavior is acceptable long-term product policy, or should instead raise a visible error/alert, is a new, small open question this sprint's tracing surfaced — not present in CREDITS-01/02.
4. Every item already listed in CREDITS-02 §19/§20 (canonical ledger reuse, AI Assistant integration, shared vs. per-surface pool, final per-operation pricing, final per-plan allowances, billing-period edge cases, expire-vs-rollover, low/exhausted thresholds, failed-request policy, concurrency race window, cache/RAG/web-search charging rules, dashboard/email work) remains exactly as stated there — this sprint neither resolves nor supersedes any of them.

---

## 11. Validation Gate

- `git status` / `git branch --show-current` / `git log -5 --oneline` run before starting — confirmed base commit (`1d9f414`, merge of PR #103) already contains the merged CREDITS-02 doc (`git show HEAD:frontend/docs/architecture/AT24_CREDITS_PRODUCT_CONTRACT.md` verified present, header "Sprint: CREDITS-02," dated 2026-09-20).
- Dedicated branch `docs/credits-live-plan-verification` created from that base; no work done directly on `main`.
- Live production DB query attempted via the repository's own configured Prisma client (`lib/prisma.ts`) — could not complete; exact reason recorded in §0. No guessed or invented DB values appear anywhere in this document.
- `config/plan-limits.ts` re-read in full — §3.
- `prisma/schema.prisma` re-read in full (all 2,674 lines) — confirmed `Plan` model has no credit/quota/entitlement field (§6), confirmed exactly one `Plan` model exists (§8), confirmed `AgentCreditLedgerEntry` is the only credit-ledger table.
- `services/billing/`, `app/api/private/billing/`, `app/api/webhooks/stripe/` re-read in full for every `plan.price`/`plan.interval` reference — §5, §7.
- `services/agent-framework/credits/` (`allowance-resolver.ts`, `credit-ledger.ts`, `credit-store.ts`, `prisma-credit-store.ts`, `index.ts`) re-read in full and traced end-to-end from `agent-runtime.ts`'s `charge()`/`refund()` calls down to `PLAN_LIMITS[planId].aiCredits` — §6.
- `prisma/seed.ts` and `app/api/private/plans/route.ts` read in full as the best available proxy for live row shape, clearly labeled as seed-script intent, not a live read — §2, §7.
- Legacy/duplicate-plan search performed across the full repository (`PlanId`, `model Plan`, `Quant Lite`, `Billing` model, admin overrides, test fixtures) — §8.
- No `INSERT`/`UPDATE`/`DELETE`/`UPSERT`/`ALTER`/migration/seed command was run against any database. `npx prisma generate` was run with a dummy, non-functional `DATABASE_URL`/`DIRECT_URL` solely to produce local TypeScript client types from the schema (schema→code generation only, no DB connection attempted or made) — required because this fresh worktree had no `node_modules`/generated client at all; `npm ci` (install-only, from the committed `package-lock.json`) was run for the same reason. Neither touches the database.
- The one temporary, disposable, read-only verification script (`scripts/__tmp_credits_plan_check.ts`) was deleted after use; confirmed via `git status --porcelain` (clean before this document was added).
- No production data changed. No application code changed. No schema changed (`prisma/schema.prisma` was only read). No migration created. No config changed (`config/plan-limits.ts` was only read). No credit allowance was silently finalized (§9 explicitly marks every value **Required**, not approved). No secrets appear anywhere in this document (no connection string, API key, or credential value is included — §0 discusses only the *absence* of a working credential, never a real one).
- Exactly one new documentation file was created: this one. `docs/architecture/AT24_CREDITS_PRODUCT_CONTRACT.md` (CREDITS-02) was read but not modified.
- `git status` / `git diff --stat` / `git diff --name-only` confirmed below (§12) to show only this one new file.

---

## 12. Git Safety Record

```
git status (before starting)          → clean (fresh worktree, base commit 1d9f414)
git branch --show-current (before)    → worktree-agent-a4ae85bdd7dbc2dd5 (isolated worktree branch)
git log -5 --oneline                  → 1d9f414 Merge PR #103 (docs/credits-product-contract)
                                          b230ee6 Merge PR #102 (NOWPayments marketplace checkout)
                                          6f95ab2 Merge PR #101 (QP-5 Quant Chat versioning v2)
                                          7b8bc5a fix(marketplace): align NOWPayments crypto path
                                          97057c2 docs(credits): CREDITS-02 AI credits product contract decision gate
git show HEAD:.../AT24_CREDITS_PRODUCT_CONTRACT.md | head -5
                                       → confirmed present, "Sprint: CREDITS-02", "Date: 2026-09-20"
git checkout -b docs/credits-live-plan-verification
                                       → new branch created from that base, not main directly
npm ci --no-audit --no-fund           → install-only, from committed package-lock.json (no DB access)
npx prisma generate (dummy env)       → schema→client codegen only (no DB access)
[temporary read-only script run + deleted]
git status --porcelain (after cleanup) → clean, confirmed before this doc was written
```

No `.prisma` schema edits, no new migration folder, no `package.json`/`package-lock.json` change (npm ci does not modify the lockfile when it already matches), no edits under `app/`, `components/`, `services/`, `config/`, or any UI file. The only file created in this sprint is this document.

*(Note on path: per this repository's established convention — followed identically by CREDITS-01 and CREDITS-02 — architecture docs live at `frontend/docs/architecture/`, not a repo-root `docs/architecture/`. This file follows that same convention.)*
