// services/billing/planPricing.ts
// Sprint BILLING-03 - the single, shared source of "which of a Plan's two
// prices applies for this billing cycle", used identically by both real
// checkout providers (StripeProvider.createCheckoutSession and the
// NOWPayments crypto-invoice route) so the two can never drift again.
//
// Before this sprint each provider computed its own (different, both
// wrong) number: Stripe always charged `plan.price` (the raw monthly
// price) regardless of `cycle`, and NOWPayments computed `plan.price * 12`
// for yearly instead of the owner-approved discounted yearly price. See
// docs/architecture/AT24_BILLING02_PRICING_CONTRACT_DECISION_LOCK.md S8/S9
// for the full history and the locked dollar amounts.
export function getPlanCyclePrice(
  plan: { priceMonthly: number; priceYearly: number },
  cycle: "monthly" | "yearly",
): number {
  return cycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
}
