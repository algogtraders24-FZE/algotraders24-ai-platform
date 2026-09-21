# BILLING-01 — Subscription Cycle / Plan Price Reconciliation & Safety Investigation

**Status:** Investigation complete. Read-only. **No code changed.**
**Origin:** surfaced as a side-finding during CREDITS-02.5 (AI-Credits evidence gathering) while tracing where Stripe Checkout gets its price from. This sprint is a standalone billing investigation and is intentionally not linked to, and does not modify, any CREDITS-02/CREDITS-02.5 document or decision.
**Date:** 2026-09-21

---

## 1. Purpose

Determine, with file:line-level precision, whether AT24's monthly-vs-yearly subscription billing cycle (`cycle` request parameter) is actually applied anywhere in the real charge-computation code path, or whether it is cosmetic — and if cosmetic/broken, document exactly which flows are affected, by how much, and what real customer impact (if any) exists today.

Scope, per the sprint brief: Stripe subscription checkout, NOWPayments subscription invoice checkout, plan upgrade/downgrade pricing, and marketplace one-time Purchases — plus the DB `Plan`/`Subscription` schema and the `config/plan-limits.ts` display config.

---

## 2. Stripe Cycle Trace

**Files:** `frontend/services/billing/providers/StripeProvider.ts`, `frontend/app/api/private/billing/checkout/route.ts`, `frontend/app/api/webhooks/stripe/route.ts`

### 2.1 Client → API → Stripe

- `app/api/private/billing/checkout/route.ts:33-37` reads `cycle` straight from the untrusted client JSON body: `const cycle = body.cycle === "yearly" ? "yearly" : "monthly";` — no server-side validation against the user's actual selection UI, no cross-check against anything else. It is then passed unchanged into `stripeProvider.createCheckoutSession({ userId, planId, cycle })` (`route.ts:40-44`).
- `StripeProvider.createCheckoutSession` (`StripeProvider.ts:73-119`) loads the DB `Plan` row (`:79`) and computes:
  ```ts
  const unitAmount = Math.round(plan.price * 100);   // StripeProvider.ts:86
  ...
  price_data: {
    currency: "usd",
    unit_amount: unitAmount,                                                  // StripeProvider.ts:96
    recurring: { interval: params.cycle === "yearly" ? "year" : "month" },    // StripeProvider.ts:97
    product_data: { name: plan.name },
  },
  ```

### 2.2 The bug, precisely

`params.cycle` **is** read here — but only for the Stripe `recurring.interval` field (monthly vs. annual renewal cadence). It is **never** used to scale `unit_amount`. `unit_amount` is always `plan.price * 100`, i.e. always the raw monthly DB price, regardless of cycle.

This is a **more severe and more precise** finding than the CREDITS-02.5 hypothesis, which described a one-time undercharge. In fact:

- For `cycle: "yearly"`, Stripe creates a genuine **recurring annual subscription** (`recurring.interval: "year"`) whose price is the **monthly** amount (e.g. $29 for Pro).
- This is not a one-time $29 charge — it is a **standing Stripe subscription that will charge the customer $29 once every 12 months, forever** (until canceled), for a plan advertised at $279/yr. That is a ~90% revenue loss **per renewal, indefinitely**, not a single incident.

### 2.3 Webhook period bookkeeping compounds it further

`app/api/webhooks/stripe/route.ts:169-185` (`checkout.session.completed`):
```ts
const currentPeriodEnd = addMonths(now, session.metadata?.cycle === "yearly" ? 12 : 1);  // :174
await subscriptionActionService.activateFromPayment({ ..., currentPeriodEnd, ... });
```
The app's own `Subscription.currentPeriodEnd` is set 12 months out for a "yearly" checkout — internally consistent with what Stripe itself will do (Stripe's own `recurring.interval: "year"` means Stripe's real subscription period is genuinely 12 months). So the **access period genuinely is a year**; only the **price** charged for that year is wrong (the raw monthly figure). Subsequent renewals go through `customer.subscription.updated` (`route.ts:187-217`), which reads Stripe's authoritative `item.current_period_end`/`current_period_start` directly — so the DB period tracks Stripe's real (annual) billing cycle correctly on every renewal; it is only the per-period **amount** that stays wrong forever, once, at Stripe's original subscription-creation time.

### 2.4 Practical reachability today — important mitigating nuance

Tracing every caller of `createCheckoutSession`/`/api/private/billing/checkout` in the current UI:

- `frontend/components/billing/PricingTable.tsx:22` holds a local `cycle` state with a working Monthly/Yearly toggle UI (`:24-48`, shows a "-20%" badge from `YEARLY_DISCOUNT_PCT` in `config/billing.config.ts:82`).
- It passes `cycle` down to `PlanCard` (`:56`) which **displays** the correct yearly price (`PlanCard.tsx:29,67-76`, via `pricingService.getEffectiveMonthly`/`priceYearly`).
- But `PlanCard`'s select button is `onClick={() => onSelect?.(plan.id)}` (`PlanCard.tsx:79`) — **it does not pass `cycle` to `onSelect` at all**, even though `cycle` is in scope. `Props.onSelect` is typed `(planId: PlanId) => void` (`PlanCard.tsx:19`) — cycle is structurally excluded.
- `PricingTable`'s `onSelectPlan` prop is likewise typed `(planId: PlanId) => void` (`PricingTable.tsx:14`), and its only real caller, `app/dashboard/billing/page.tsx:350-354`, wires it to `handleSelectPlan` (`page.tsx:131-145`), which only ever receives `planId`.
- The actual `cycle` used at checkout time, in `handleCheckout` (`page.tsx:162-180`), is:
  ```ts
  const cycle: "monthly" | "yearly" = subscription?.billingCycle ?? "monthly";  // page.tsx:168
  ```
  — derived from the user's **current/existing** subscription, via `toCycle()` in `subscriptionAdapter.ts:30-34`, which infers cycle purely from `(currentPeriodEnd - currentPeriodStart) > 200 days`. A new/free-tier user has no real Subscription row and gets `fallbackSubscription()` (`subscriptionAdapter.ts:63-84`), which hardcodes `billingCycle: "monthly"` (`:76`).

**Conclusion:** in the shipped web UI, the Monthly/Yearly toggle is fully wired for *display* but **completely disconnected from the actual checkout API call**. No code path reachable through today's dashboard UI can currently send `cycle: "yearly"` to `/api/private/billing/checkout` for a first-time or free-tier subscriber — it is structurally impossible given the current prop signatures. The only way `cycle: "yearly"` reaches this endpoint today is: (a) a direct/manual API call (curl, Postman, a future mobile client, or a bug-bounty/QA probe), or (b) an existing subscription whose period already happens to span >200 days (which, per the analysis above, could itself only exist as a result of this same bug already having fired once, or of admin/seed data with an unusually long period). This materially limits — but does not eliminate — near-term exposure, and does not change the underlying code defect.

---

## 3. NOWPayments Cycle Trace

**Files:** `frontend/app/api/private/billing/crypto-invoice/route.ts`, `frontend/services/billing/providers/NowPaymentsProvider.ts`, `frontend/app/api/webhooks/nowpayments/route.ts`

### 3.1 Confirmed: a genuinely different (third) computation

`app/api/private/billing/crypto-invoice/route.ts:30-40`:
```ts
const cycle = body.cycle === "yearly" ? "yearly" : "monthly";
const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
...
const priceUsd = cycle === "yearly" ? plan.price * 12 : plan.price;   // :40
```
This confirms the CREDITS-02.5 note verbatim: NOWPayments **does** apply a cycle multiplier, unlike Stripe — but it multiplies the raw monthly DB price by 12 (`plan.price * 12`), which is a **different number** from the config's own advertised `priceYearly`:

| Plan | DB `Plan.price` (monthly) | NOWPayments yearly invoice (`price*12`) | Config `priceYearly` (advertised) | Delta |
|---|---|---|---|---|
| Pro | $29 | **$348** | $279 | NOWPayments overcharges by **$69 / 24.7%** vs. advertised |
| Elite | $99 | **$1,188** | $949 | overcharges by **$239 / 25.2%** |
| Enterprise | $499 | **$5,988** | $4,790 | overcharges by **$1,198 / 25.0%** |

(`config/billing.config.ts:82` sets `YEARLY_DISCOUNT_PCT = 20`, and `$279 / ($29*12=$348) = 0.802` ≈ a 20% discount vs. `price*12` — i.e. the config's `priceYearly` values are internally consistent with a genuine "20% off `price*12`" yearly-discount policy. NOWPayments' `plan.price * 12` computation ignores that discount entirely, so a customer paying via crypto for "yearly" is charged the full undiscounted annualized rate — the exact opposite direction of the Stripe bug (overcharge, not undercharge), and neither matches the number actually advertised anywhere in the product.)

### 3.2 Webhook side

`app/api/webhooks/nowpayments/route.ts:142-159`: on a confirmed IPN, `parseOrderId()` (`:27-33`) recovers `cycle` from the `order_id` string (`userId:planId:cycle:timestamp`, built in `crypto-invoice/route.ts:41`) and sets `currentPeriodEnd = addMonths(now, cycle === "yearly" ? 12 : 1)` (`:152`) — this part is internally consistent (12-month invoice → 12-month access), matching what was actually paid via this route's own (differently-wrong) computation. There is no re-derivation of price here; the webhook trusts the amount NOWPayments already collected.

### 3.3 Reachability

Same UI gap as Stripe (Section 2.4): `BillingApi.createCryptoInvoice(planId, cycle)` (`services/api/BillingApi.ts:135`) is only called from `handleCheckout` in `app/dashboard/billing/page.tsx:172`, using the same `subscription?.billingCycle ?? "monthly"` derivation — so this path is likewise not reachable with `cycle: "yearly"` through today's UI for a new/free-tier subscriber.

---

## 4. Subscription-Change (Upgrade/Downgrade) Pricing Trace

**File:** `frontend/services/billing/SubscriptionActionService.ts`, `frontend/app/api/private/subscription/route.ts`

- `PATCH /api/private/subscription` with `action: "change-plan"` (`route.ts:80-154`) calls `subscriptionActionService.changePlan(userId, planId)` (`:121`) — this endpoint **takes no `cycle` parameter at all** (only `action`/`planId`, `route.ts:92-94`).
- `changePlan()` (`SubscriptionActionService.ts:70-110`) is real only for a transition to a **$0 plan**:
  ```ts
  if (plan.price > 0) {
    throw new PaymentRequiredError(`Switching to ${plan.name} requires payment processing, ...`);  // :75-78
  }
  ```
  Any transition to a paid plan is rejected outright (HTTP 402, per `route.ts:123-131`) — the caller is expected to fall through to the Stripe/NOWPayments checkout routes instead (this is exactly what `app/dashboard/billing/page.tsx:298-336` does: it shows a "this plan requires payment" notice and offers the Stripe/crypto checkout buttons, which is the flow already covered in Sections 2–3).
- Free-plan transitions always use `addMonths(now, 1)` for the new period (`:83`) — there is no yearly free-tier concept, so no cycle-scaling bug is possible here by construction.
- **Conclusion:** there is no cycle-aware (or cycle-unaware-but-buggy) *price* computation in the plan-switch path, because paid plan-switches never compute or charge a price at all today — they are hard-blocked and redirected to checkout. The only "bug" here is a UX/feature gap (self-service paid upgrades aren't wired up yet), not a pricing-correctness bug, and it is out of scope for this cycle-pricing investigation.
- `PricingService.getPriceDelta()` (`PricingService.ts:45-47`) and `BillingEngine.previewPlanChange()` (`BillingEngine.ts:135-137`) do compute a cycle-aware **preview** delta client-side (for the "+/-$X/cycle" text shown at `page.tsx:298-304`) using `plan.priceMonthly`/`plan.priceYearly` from `PLAN_LIMITS` — but this is **display-only**; it is never sent to, or re-derived by, any charge-creating endpoint.

---

## 5. Canonical Relationship (as actually implemented today)

| Data source | What it actually is | Where it's read | Does it affect what a customer is charged? |
|---|---|---|---|
| DB `Plan.price` (monthly) | The one production-canonical monthly price (`prisma/schema.prisma:38`) | Stripe `unit_amount` (`StripeProvider.ts:86`), NOWPayments base (`crypto-invoice/route.ts:40`), webhook purchase-confirmation email amount (`stripe/route.ts:41-48`), plan-switch guard (`SubscriptionActionService.ts:75`) | **Yes — for monthly, and (incorrectly, unscaled) also for "yearly" Stripe checkout.** |
| DB `Plan.interval` | Schema column, DB value is always `"month"` for all 4 plans (per parent-session read-only query, see Section 6) | Nowhere in checkout/entitlement/pricing code (confirmed: no reference found outside the Prisma schema/migrations) | **No — dead column.** |
| `config/plan-limits.ts` `priceYearly` | Product-intended, discount-consistent (~20% off `price*12`) advertised yearly price, hand-maintained per plan, not in the DB | UI display only: marketing `sections/Pricing.tsx:62`, dashboard `PlanCard.tsx:72-76`, `PricingService.getPrice/getEffectiveMonthly/getYearlySavings*` (`PricingService.ts:19-39`) for on-screen numbers/discount badges | **No — never reaches any charge-creating code.** |
| Client `cycle` request param | User's/UI's claimed billing cycle, sent in the POST body to `/checkout` and `/crypto-invoice` | Stripe: only scales `recurring.interval` (`StripeProvider.ts:97`) and `Subscription.currentPeriodEnd` (`stripe/route.ts:174`), **not** `unit_amount`. NOWPayments: scales `priceUsd` by a flat `*12`, not the discounted `priceYearly` (`crypto-invoice/route.ts:40`). Not currently reachable as `"yearly"` from the shipped UI for a first-time subscriber (Section 2.4). | **Yes, but incorrectly and inconsistently between the two providers — and practically unreachable as "yearly" through the current UI.** |

Per-flow summary:

- **(a) New Stripe subscription checkout:** `Plan.price` (monthly, DB) drives `unit_amount` unconditionally; `cycle` only sets the renewal cadence. **Yearly checkout = monthly price charged annually.**
- **(b) New NOWPayments subscription invoice:** `Plan.price * (cycle==yearly ? 12 : 1)`. **Yearly invoice = full undiscounted annualized price ($348 for Pro), not the advertised discounted $279.**
- **(c) Plan upgrade/downgrade:** No price is computed for any paid transition — it's blocked (402) and the customer is routed back into flow (a) or (b). No cycle-specific bug distinct from (a)/(b).
- **(d) Marketplace one-time Purchase:** Uses `MarketplaceListing.pricing.{model,amount,currency}` (`app/api/private/marketplace/listings/[id]/checkout/route.ts:60-65`, `.../crypto-invoice/route.ts:98-103`) — a completely separate JSON field with its own one-time `amount`. Never touches `Plan.price`, `Plan.interval`, `plan-limits.priceYearly`, or `cycle`. **Confirmed genuinely unaffected.**

---

## 6. Existing-Subscription Impact

Per parent-session read-only query (trusted evidence, re-verified against code below rather than re-queried):

- Exactly **1** row in `Subscription`: `{ planId: "pro", status: "active", provider: null, currentPeriodStart: 2026-07-15T17:24:53.875Z, currentPeriodEnd: 2026-08-15T17:24:53.875Z }` — a 31-day period (`toCycle()`'s own >200-day threshold, `subscriptionAdapter.ts:30-34`, would classify this as `"monthly"`, not `"yearly"`).
- Grepping every `prisma.subscription.create`/`.upsert` call site in the app (`SubscriptionActionService.ts:97,142`, `AdminSubscriptionService.ts:139-141`, `prisma/seed.ts:328-337`, plus a validation script) shows **only two code paths ever create a Subscription row without a `provider` value**: `SubscriptionActionService.changePlan()` (free-plan only, per Section 4) and `AdminSubscriptionService.overridePlan()` (`AdminSubscriptionService.ts:118-145`, explicit admin action, comment: "unlike the user-facing flow, ANY plan (including paid ones) can be granted here" — and it never sets `provider`). The dev seed script (`prisma/seed.ts:324-337`) creates an identical-shaped row: `planId: "pro"`, 1-month period, no `provider` field set at all.
- `activateFromPayment()` (`SubscriptionActionService.ts:116-146`), the **only** code path that ever sets a non-null `provider`, is called exclusively from the two verified webhook handlers (`stripe/route.ts:175-182,206-213`; `nowpayments/route.ts:147-154`) — i.e. only in direct response to a signature-verified real payment event.
- **Conclusion, verified in code:** a `provider: null` Subscription row is structurally impossible to produce through any real-payment path in this codebase. The one production row (`pro`, `provider: null`, exactly 1-month period matching the seed script's own shape) can only have originated from `overridePlan()` (admin grant) or the seed script — never from a real Stripe/NOWPayments charge. **No real, paying customer exists yet, and this specific row is not one.**

---

## 7. Revenue/Customer-Impact Scenarios

All scenarios below assume a hypothetical future/direct-API caller reaches `cycle: "yearly"` (Section 2.4/3.3 established this is not reachable through today's shipped dashboard UI for a first-time subscriber, but the code-level defect exists and would fire immediately if the toggle is ever wired up, or if any other client — mobile app, partner integration, API consumer, or a QA/pentest probe — sends `cycle: "yearly"` directly).

**Scenario A — Stripe, Pro + yearly:**
A customer is charged **$29.00** via Stripe Checkout (not $279/yr advertised, not $348/yr `price*12`). Stripe creates a real recurring subscription with `interval: "year"`, so this same **$29** will be auto-charged again in 12 months, and again every 12 months after that, indefinitely, until canceled. `Subscription.currentPeriodEnd` is correctly set 12 months out (`stripe/route.ts:174`), so the customer genuinely gets a full year of Pro access — for 8.3% of the advertised annual price. Net effect: a **~90% recurring annual revenue loss per affected subscriber**, not a one-time miss.

**Scenario B — NOWPayments, Pro + yearly:**
A customer is invoiced **$348.00** (`plan.price * 12`) for one year of Pro access, against an advertised price of $279/yr — a **24.7% overcharge**. NOWPayments has no native recurring billing (confirmed: `NowPaymentsProvider.ts` header comment, "NOWPayments has no native recurring-subscription concept ... this pays for exactly one billing period upfront"), so this is a one-time overcharge per period, not a compounding one — but it recurs every time the customer manually renews via a fresh invoice, since nothing about the computation changes between periods.

**Scenario C — Elite/Enterprise, either provider:** Same proportional pattern scales with plan price (Section 3.1 table): Stripe yearly ≈ 8.3%–10.4% of advertised annual price; NOWPayments yearly ≈ 125% of advertised annual price.

**Actual impact today:** Per Section 6, zero real customers have a non-null-provider subscription in production, and the shipped UI cannot currently send `cycle: "yearly"` to either checkout endpoint for a first-time subscriber. **No real customer has been undercharged or overcharged by this bug to date.** This is a live, armed defect in the charge-computation code, not a historical billing incident.

---

## 8. Fix Recommendations — **NOT IMPLEMENTED, OWNER DECISION REQUIRED**

Two viable approaches, not mutually exclusive with each other short-term:

**Option 1 — Treat DB `Plan.price` as canonical-monthly and config `priceYearly` as canonical-yearly (no migration).**
- In `StripeProvider.createCheckoutSession`, compute `unitAmount` as `cycle === "yearly" ? Math.round(PLAN_LIMITS[plan.id].priceYearly * 100) : Math.round(plan.price * 100)`.
- In `crypto-invoice/route.ts`, replace `plan.price * 12` with `PLAN_LIMITS[plan.id].priceYearly` for the yearly case.
- Wire `PlanCard`'s `onSelect` to actually pass `cycle` up through `PricingTable` → `handleSelectPlan` → `preview` → `handleCheckout`, so a user-selected cycle (not the current-subscription-derived guess) is what's actually sent.
- **Scope:** ~4-5 files touched (`StripeProvider.ts`, `crypto-invoice/route.ts`, `PlanCard.tsx`, `PricingTable.tsx`, `app/dashboard/billing/page.tsx`), no schema/migration needed, no backfill needed (Section 6: the one existing row is not a real paid subscription and is a 1-month/no-provider row unaffected by any yearly-cycle change).

**Option 2 — Add a real `Plan.priceYearly` DB column and stop relying on the config file for any pricing.**
- Adds `priceYearly Float @default(0)` to the `Plan` model, migrates the 4 existing rows to the values currently hardcoded in `config/plan-limits.ts` ($0/$279/$949/$4,790), and updates the same call sites as Option 1 to read `plan.priceYearly` instead of the config constant.
- More architecturally correct (single source of truth for all pricing, matching the existing "Pricing ... live in the database" comment at `config/plan-limits.ts:3`), but requires a migration + a one-time data backfill of 4 rows (trivial, since only 4 plans exist) and touches one more file (`prisma/schema.prisma` + migration + `planAdapter.ts`).

**Either option must also decide:**
- Whether to retroactively correct the one existing non-real Subscription row (Section 6 concludes this is unnecessary — it's not a real customer and not price-cycle-related at all).
- Whether the NOWPayments "no native recurring billing" limitation (manual per-period re-invoicing) is acceptable long-term, independent of this pricing fix.
- Whether Stripe's already-created (if any, in test-mode) subscriptions with `recurring.interval: "year"` at the wrong price need any provider-side correction — not applicable today since zero real Stripe subscriptions exist in production (Section 6), but worth a pre-launch checklist item.

No code, schema, or config changes were made as part of this investigation.

---

## 9. Remaining Open Questions

1. Is a monthly/yearly toggle on the **public marketing** pricing page (`sections/Pricing.tsx`) or a real self-service upgrade-with-cycle-choice flow even on the near-term roadmap? If not, the "UI doesn't currently send `cycle: yearly`" mitigation (Sections 2.4/3.3) may not need to be treated as urgent — but the underlying API-level bug should still be fixed before any such UI work ships, since it would activate immediately and silently.
2. Is there any external API consumer (mobile app in development, partner integration, admin tooling) that might already call `/api/private/billing/checkout` or `/crypto-invoice` directly with `cycle: "yearly"`, bypassing the web dashboard entirely? This investigation found none in this repo, but the sprint brief noted 40+ parallel worktrees exist for other in-flight work — a mobile/API-client codebase outside this repo was not in scope to check.
3. Should the NOWPayments "no recurring billing, must re-invoice manually each period" limitation itself be flagged as a separate product gap (distinct from the pricing-correctness bug documented here)?
4. Does the owner want `Plan.interval` (confirmed dead/unread column, Section 5) removed from the schema, or left as-is for potential future use?
5. Whichever fix option is chosen, should it also correct the underlying `getYearlySavingsPct`/`getAdvertisedDiscountPct` display math to guarantee it can never drift from whatever new canonical yearly-price source is chosen? (Not investigated in depth here — out of this sprint's charge-computation scope.)

---

*Investigation performed under sprint BILLING-01. Read-only; no application code, config, or schema modified. See CREDITS-02.5 for the unrelated originating context (not referenced further here per explicit instruction to keep these tracks separate).*
