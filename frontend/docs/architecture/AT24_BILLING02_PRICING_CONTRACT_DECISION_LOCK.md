# AT24 Billing — Pricing Contract Decision Lock

Sprint: BILLING-02
Date: 2026-09-21
Status: **DRAFT — awaiting owner sign-off.** No code in this sprint (per explicit scope lock). This document exists to lock the pricing contract *before* BILLING-03 (implementation) starts.

## 0. Sequence this sprint sits in

CREDITS-02.5 (merged) → BILLING-01 (merged) → **BILLING-02 (this doc)** → BILLING-03 (implementation + tests) → Credits final allowance lock → CREDITS-03 (implementation).

This document is deliberately separate from the Credits track. Nothing here changes `config/plan-limits.ts`'s `aiCredits` values or any Credits decision.

## 1. Why this sprint exists

BILLING-01 (`AT24_BILLING01_CYCLE_PRICE_INVESTIGATION.md`) found two independent, live pricing bugs:

- **Stripe**: `unit_amount` is always `plan.price * 100` (the raw monthly DB price) regardless of `cycle`; only `recurring.interval` respects `cycle`. A yearly Stripe subscription would recur at the monthly price forever (`StripeProvider.ts:68,78-79`).
- **NOWPayments**: `priceUsd = cycle === "yearly" ? plan.price * 12 : plan.price` (`crypto-invoice/route.ts:40`) — a *different* wrong number ($348 for Pro) that doesn't match the advertised discounted yearly price ($279).

Both bugs are currently unreachable through the shipped dashboard UI (the Monthly/Yearly toggle isn't wired to the actual checkout call), and zero real paid subscriptions exist in production today — confirmed no customer has been affected. This document locks the correct pricing contract so BILLING-03 can fix both bugs and wire the UI in one implementation pass, without re-litigating the numbers or the data model mid-implementation.

## 2. Locked monthly prices — OWNER APPROVED

| Plan | Monthly price |
|---|---|
| Free | $0 |
| Pro | $29 |
| Elite | $99 |
| Enterprise | $499 |

Source: real production DB `Plan.price` (verified read-only in CREDITS-02.5, re-confirmed unchanged). **No change required** — these are already correct and already what Stripe/NOWPayments charge for a monthly cycle today.

## 3. Locked yearly prices — OWNER APPROVED

| Plan | Yearly price |
|---|---|
| Free | $0 |
| Pro | $279 |
| Elite | $949 |
| Enterprise | $4,790 |

Source: `config/plan-limits.ts`'s existing `priceYearly` field, now formalized as the canonical yearly contract (not merely a marketing display number). Consistent with the existing `YEARLY_DISCOUNT_PCT = 20` constant already in `config/billing.config.ts:82` (Pro: $29×12=$348, ×0.8 ≈ $278.4 ≈ $279; the other three plans follow the same ~20%-off pattern). No new numbers were invented — these are the numbers already live in the codebase's own display layer, now being promoted to the actual billing source of truth.

## 4. DB canonical pricing model — LOCKED: Option 2 (owner-selected)

Add a real `priceYearly` column to the `Plan` table. Reasoning already given by the owner: leaving yearly pricing in `config/plan-limits.ts` while `Plan.price` remains the DB billing source keeps two pricing authorities alive — the exact drift pattern BILLING-01 just caught. Target shape:

```
model Plan {
  id           String
  name         String
  priceMonthly Float   // renamed from `price`, see §5
  priceYearly  Float   // NEW
  features     String[]
  isActive     Boolean
  sortOrder    Int
  ...
  // `interval` column dropped, see §6
}
```

## 5. `price` → `priceMonthly` rename — LOCKED (recommended, owner sign-off requested)

**Recommendation: rename, bundled into the same migration as the `priceYearly` addition.**

Reasoning: keeping the field named `price` once a `priceYearly` sibling exists is exactly the kind of ambiguity that caused this investigation in the first place — a future reader (human or agent) grepping for "price" with no `Monthly` qualifier is one accidental read away from repeating today's bug. The rename is mechanical (Postgres `ALTER TABLE "Plan" RENAME COLUMN "price" TO "priceMonthly"` is a metadata-only operation, no data rewrite, no downtime risk on a 4-row table) and every call site is already enumerated below (§9), so there's no hidden blast radius.

**Alternative considered and rejected:** keep `price` as-is for backward compatibility and only add `priceYearly` alongside it. Rejected because the only external consumer of the raw field name is `app/api/private/plans/route.ts:28`'s own JSON response shape (`price: p.price`), which is this app's own internal API, not a third-party contract — there is no compatibility cost worth preserving the ambiguous name for.

**If the owner prefers to keep `price` unrenamed**, everything else in this document still holds; only §9's migration script and the `plans` API route response key would stay `price` instead of becoming `priceMonthly`.

## 6. `Plan.interval`'s future — LOCKED: drop

BILLING-01 confirmed `Plan.interval` is a dead column — zero non-schema code references, always `"month"` in all 4 real rows, never read by any pricing/checkout/entitlement logic. Once monthly and yearly each have their own explicit price column, a single `interval` field describing "the" interval for a plan is not just unused but conceptually wrong (a plan now supports both intervals, not one). Recommend dropping it in the same migration as §4/§5. Zero data-loss risk (no reader depends on its value).

## 7. UI toggle → checkout cycle wiring — LOCKED: required, non-optional

BILLING-01 finding: `PlanCard.tsx`/`PricingTable.tsx`'s Monthly/Yearly toggle is fully wired for *display* but the selected `cycle` is never passed to the actual checkout call (`onSelect` is typed `(planId) => void`, no cycle param; the real checkout call derives `cycle` from the *existing* subscription's period length instead, defaulting new/free users to monthly).

This is locked as **in-scope, required** for BILLING-03 — not deferred polish. Fixing the pricing math without wiring the UI would leave the fix unreachable by any real user (the same reason the bug hasn't hurt anyone yet also means the fix wouldn't help anyone yet).

## 8. Stripe yearly recurring mechanism — LOCKED (recommended)

**Locked behavior:** for `cycle === "yearly"`, create a Stripe recurring subscription with `unit_amount = priceYearly * 100` and `recurring.interval = "year"` — i.e. the customer is charged the full annual price once per year, exactly the standard SaaS annual-plan pattern. For `cycle === "monthly"`, unchanged: `unit_amount = priceMonthly * 100`, `recurring.interval = "month"`.

This only changes `unitAmount`'s source (`StripeProvider.ts:68`) to branch on `cycle`; `recurring.interval`'s branching (`StripeProvider.ts:79`) is already correct today and stays as-is. BILLING-01 also confirmed the webhook already sets a correct 12-month `currentPeriodEnd` for yearly — only the charged amount was ever wrong, so no period-tracking logic needs to change.

## 9. NOWPayments yearly invoice mechanism — LOCKED (recommended)

**Locked behavior:** `priceUsd = cycle === "yearly" ? plan.priceYearly : plan.priceMonthly` (`crypto-invoice/route.ts:40`), replacing the current `plan.price * 12` computation entirely. NOWPayments has no native recurring billing (confirmed BILLING-01) — each yearly invoice is a single manual charge for the full annual amount, mirroring Stripe's annual-charge model in §8 rather than a monthly amount multiplied at invoice time.

## 10. Subscription-change (upgrade/downgrade) behavior — LOCKED (recommended)

`SubscriptionActionService.changePlan` (`SubscriptionActionService.ts:75`) takes no `cycle` param today and unconditionally blocks any transition to a paid plan with a 402, redirecting the user to checkout. This is not itself a pricing bug and needs **no logic change** — it already defers all real pricing to the checkout flows covered in §8/§9. The only requirement for BILLING-03 is to confirm the checkout redirect triggered from a blocked plan-change correctly carries the user's cycle choice through to that checkout call (same UI-wiring requirement as §7, not a separate mechanism).

## 11. Every real call site affected (verified current line numbers, 2026-09-21)

| File | Line(s) | Current behavior | Required change |
|---|---|---|---|
| `services/billing/providers/StripeProvider.ts` | 62, 68, 78-79, 138 | `unit_amount` always from `plan.price` | Branch on `cycle` per §8; update both `unit_amount` sites (one-time purchase path at line 138 is marketplace, not subscription — verify unaffected before touching) |
| `app/api/private/billing/crypto-invoice/route.ts` | 34, 37, 40-41 | `priceUsd = cycle==="yearly" ? plan.price*12 : plan.price` | Replace per §9 |
| `services/billing/SubscriptionActionService.ts` | 75 | `if (plan.price > 0)` gate | Rename field reference only (`plan.priceMonthly`), no logic change (§10) |
| `app/api/private/plans/route.ts` | 28 | `price: p.price` in API response | Rename to `priceMonthly` (or add `priceYearly` alongside) if §5's rename is approved |
| `prisma/schema.prisma` | `model Plan` (currently `price`/`interval` fields) | single monthly price + unused interval | Add `priceYearly`, rename/drop per §5/§6 |

No other real caller of `Plan.price`/`plan.price` was found in `services/` or `app/` at time of writing (re-grepped 2026-09-21, after BILLING-01's original pass — two files referenced in earlier drafts, the Stripe webhook route and `AdminSubscriptionService.ts`, no longer contain a live field access on this repo's current `main`; re-verify at BILLING-03 implementation time since this repo's `main` moves frequently across many parallel worktrees).

## 12. Migration safety

Real production impact surface, per CREDITS-02.5's read-only verification: exactly 4 `Plan` rows, exactly 1 `Subscription` row (references `planId` only, not `price`/`interval` directly — unaffected by any of these column changes), 9 `Purchase` rows (different pricing field entirely, marketplace one-time purchases, confirmed unaffected by BILLING-01).

Recommended single migration for BILLING-03:
1. `ALTER TABLE "Plan" RENAME COLUMN "price" TO "priceMonthly"` (metadata-only, zero data loss) — if §5 is approved as written; otherwise skip.
2. `ALTER TABLE "Plan" ADD COLUMN "priceYearly" DOUBLE PRECISION NOT NULL DEFAULT 0`.
3. Four explicit `UPDATE` statements backfilling `priceYearly` with the exact owner-approved numbers from §3 (hardcoded per-row, **not** computed from a discount formula at migration time — these are business-approved numbers, not a derived value, even though they happen to match the existing 20%-off constant).
4. `ALTER TABLE "Plan" DROP COLUMN "interval"` (per §6).

All four steps are low-risk on a 4-row table with no live paid subscriber depending on the columns being touched.

## 13. Decision summary table

| # | Decision | Status |
|---|---|---|
| Monthly prices ($0/$29/$99/$499) | Unchanged, reconfirmed | **LOCKED — owner approved** |
| Yearly prices ($0/$279/$949/$4,790) | Promoted from config to DB-canonical | **LOCKED — owner approved** |
| DB model: add `Plan.priceYearly` | Option 2 | **LOCKED — owner approved** |
| Rename `price` → `priceMonthly` | Bundle into same migration | **Recommended — owner sign-off requested** |
| Drop `Plan.interval` | Dead column, no dependents | **Recommended — owner sign-off requested** |
| UI toggle → checkout wiring | Required, not optional | **LOCKED — non-negotiable prerequisite for any of the above to matter** |
| Stripe yearly mechanism | Full annual charge, `recurring.interval="year"` | **Recommended — owner sign-off requested** |
| NOWPayments yearly mechanism | Direct `priceYearly`, drop `×12` | **Recommended — owner sign-off requested** |
| Subscription-change behavior | No logic change, cycle pass-through only | **Recommended — owner sign-off requested** |
| Migration shape | Single migration, 4-step, no backfill risk | **Recommended — owner sign-off requested** |

## 14. Explicitly out of scope for BILLING-02 and BILLING-03

- Proration on mid-cycle plan upgrades/downgrades — not addressed by BILLING-01's findings, needs its own design if the owner wants it.
- NOWPayments having no native recurring billing at all (renewal reminders / dunning for crypto subscribers) — a separate, pre-existing product gap, not part of this pricing-correctness fix.
- Whether any out-of-repo API/mobile client already sends `cycle=yearly` directly, bypassing the dashboard UI entirely — flagged as unresolved by BILLING-01, recommend a quick check at the start of BILLING-03 before shipping, not a blocker for signing off this contract.
- Any Credits/AI-allowance decision — fully separate track, untouched by this document.

## 15. What BILLING-03 is authorized to do once this document is signed off

Implement exactly: the schema migration in §12, the Stripe fix in §8, the NOWPayments fix in §9, the UI wiring in §7, the field-rename mechanical updates in §11, plus tests covering monthly and yearly checkout for all three non-free plans on both providers. Nothing else. No code changes happen until the owner confirms this document.
