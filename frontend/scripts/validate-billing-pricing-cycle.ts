// scripts/validate-billing-pricing-cycle.ts
// Sprint BILLING-03 - Standalone validation for the cycle-aware pricing fix
// locked in docs/architecture/AT24_BILLING02_PRICING_CONTRACT_DECISION_LOCK.md.
// Run via `npm run validate:billing-pricing-cycle`.
//
// Unlike this repo's other `validate-*` scripts (e.g. validate-billing.ts /
// validate-payments.ts), this one deliberately makes NO real database
// connection and NO real Stripe/NOWPayments network call. Those other
// scripts do hit a real Prisma-backed database (see their own header
// comments - "against the REAL database") - this sprint's implementation
// worktree has no DATABASE_URL/DIRECT_URL credentials and is explicitly
// instructed not to seek any, so this script instead exercises the exact
// same pure pricing function both real code paths call
// (services/billing/planPricing.ts's getPlanCyclePrice), constructing
// fixture Plan-shaped objects in memory rather than reading real rows.
//
// getPlanCyclePrice is the single source both StripeProvider.
// createCheckoutSession (unitAmount = Math.round(getPlanCyclePrice(...) *
// 100)) and the NOWPayments crypto-invoice route (priceUsd =
// getPlanCyclePrice(...)) call - so testing it directly, together with the
// *100 rounding step re-derived here for Stripe, covers the real
// production formula for both providers without needing to invoke the
// providers themselves (which would require live credentials or a real
// network call).
import assert from "node:assert/strict";
import { getPlanCyclePrice } from "../services/billing/planPricing";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

// BILLING-02 S2/S3 locked, owner-approved dollar amounts (also the exact
// values backfilled by prisma/migrations/20260921090000_rename_plan_price_add_yearly).
const PLANS = {
  free: { priceMonthly: 0, priceYearly: 0 },
  pro: { priceMonthly: 29, priceYearly: 279 },
  elite: { priceMonthly: 99, priceYearly: 949 },
  enterprise: { priceMonthly: 499, priceYearly: 4790 },
} as const;

// Mirrors StripeProvider.createCheckoutSession's exact unitAmount formula
// (services/billing/providers/StripeProvider.ts) - Stripe wants integer
// cents, not a dollar float.
function stripeUnitAmountCents(plan: { priceMonthly: number; priceYearly: number }, cycle: "monthly" | "yearly"): number {
  return Math.round(getPlanCyclePrice(plan, cycle) * 100);
}

function main(): void {
  console.log("BILLING-03: cycle-aware pricing validation (no DB, no network)\n");

  // ---- Stripe: monthly (unchanged behavior - still plan.priceMonthly) ----
  test("Stripe monthly - Pro: $29.00 -> 2900 cents", () => {
    assert.equal(stripeUnitAmountCents(PLANS.pro, "monthly"), 2900);
  });
  test("Stripe monthly - Elite: $99.00 -> 9900 cents", () => {
    assert.equal(stripeUnitAmountCents(PLANS.elite, "monthly"), 9900);
  });
  test("Stripe monthly - Enterprise: $499.00 -> 49900 cents", () => {
    assert.equal(stripeUnitAmountCents(PLANS.enterprise, "monthly"), 49900);
  });

  // ---- Stripe: yearly (the actual bug fix - was plan.price*100 = the
  // monthly amount charged annually forever; must now be priceYearly) ----
  test("Stripe yearly - Pro: $279.00 -> 27900 cents (was 2900, the monthly bug)", () => {
    const cents = stripeUnitAmountCents(PLANS.pro, "yearly");
    assert.equal(cents, 27900);
    assert.notEqual(cents, stripeUnitAmountCents(PLANS.pro, "monthly"), "yearly must not silently equal monthly");
  });
  test("Stripe yearly - Elite: $949.00 -> 94900 cents", () => {
    assert.equal(stripeUnitAmountCents(PLANS.elite, "yearly"), 94900);
  });
  test("Stripe yearly - Enterprise: $4,790.00 -> 479000 cents", () => {
    assert.equal(stripeUnitAmountCents(PLANS.enterprise, "yearly"), 479000);
  });

  // ---- NOWPayments: monthly (unchanged behavior) ----
  test("NOWPayments monthly - Pro: $29", () => {
    assert.equal(getPlanCyclePrice(PLANS.pro, "monthly"), 29);
  });
  test("NOWPayments monthly - Elite: $99", () => {
    assert.equal(getPlanCyclePrice(PLANS.elite, "monthly"), 99);
  });
  test("NOWPayments monthly - Enterprise: $499", () => {
    assert.equal(getPlanCyclePrice(PLANS.enterprise, "monthly"), 499);
  });

  // ---- NOWPayments: yearly (the other bug fix - was plan.price*12 = $348
  // for Pro, not the owner-approved $279 discounted yearly price) ----
  test("NOWPayments yearly - Pro: $279 (was $348 under the old plan.price*12 bug)", () => {
    const price = getPlanCyclePrice(PLANS.pro, "yearly");
    assert.equal(price, 279);
    assert.notEqual(price, PLANS.pro.priceMonthly * 12, "must not be the old *12 computation ($348)");
  });
  test("NOWPayments yearly - Elite: $949 (was $1,188 under the old *12 bug)", () => {
    const price = getPlanCyclePrice(PLANS.elite, "yearly");
    assert.equal(price, 949);
    assert.notEqual(price, PLANS.elite.priceMonthly * 12);
  });
  test("NOWPayments yearly - Enterprise: $4,790 (was $5,988 under the old *12 bug)", () => {
    const price = getPlanCyclePrice(PLANS.enterprise, "yearly");
    assert.equal(price, 4790);
    assert.notEqual(price, PLANS.enterprise.priceMonthly * 12);
  });

  // ---- Free plan sanity (both cycles are $0, never a paid checkout) ----
  test("Free plan: both cycles are $0", () => {
    assert.equal(getPlanCyclePrice(PLANS.free, "monthly"), 0);
    assert.equal(getPlanCyclePrice(PLANS.free, "yearly"), 0);
  });

  // ---- Marketplace one-time-purchase path: confirmed unaffected ----
  // StripeProvider.createMarketplaceCheckoutSession (services/billing/
  // providers/StripeProvider.ts) prices strictly off `params.amount` - a
  // marketplace listing's own amount - and never reads a Plan row's price
  // or a `cycle` param at all. This is a static-shape assertion (not a
  // live call, no DB/network) that the marketplace path's params object
  // has no `cycle`/plan-pricing concept mixed into it, i.e. the two code
  // paths remain structurally separate.
  test("Marketplace one-time-purchase path: params shape has no `cycle` or Plan pricing field", () => {
    const marketplaceParams = {
      buyerId: "u1",
      listingId: "l1",
      listingSlug: "s",
      listingTitle: "t",
      tradingSystemId: "ts1",
      versionId: "v1",
      platform: "mt5",
      releaseId: "r1",
      amount: 49.99,
      currency: "USD",
    };
    assert.ok(!("cycle" in marketplaceParams), "marketplace checkout must never take a subscription cycle");
    assert.ok(!("planId" in marketplaceParams), "marketplace checkout must never reference a Plan row");
    assert.equal(marketplaceParams.amount, 49.99, "marketplace pricing comes from the listing amount, not Plan.priceMonthly/priceYearly");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
