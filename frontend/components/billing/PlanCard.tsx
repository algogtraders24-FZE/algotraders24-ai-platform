"use client";
// components/billing/PlanCard.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto the token system: the sky-blue "highlighted
// plan" treatment (border-sky-400/bg-sky-500) is replaced with gold - the
// platform's one real primary accent, per the homepage - and the glass
// (bg-white/5 border-white/10) chrome becomes the standard ink-2/border
// surface. PLAN_COLORS (per-plan text accent) is left as real product-tier
// branding data, not chrome.
import type { Plan, BillingCycle, PlanId } from "@/types/billing";
import { PLAN_COLORS, PLAN_ACCENTS } from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";
import Button from "@/components/ui/Button";

interface Props {
  plan: Plan;
  cycle: BillingCycle;
  currentPlanId: PlanId;
  onSelect?: (planId: PlanId) => void;
}

export default function PlanCard({
  plan,
  cycle,
  currentPlanId,
  onSelect,
}: Props) {
  const isCurrent = plan.id === currentPlanId;
  const price = pricingService.getEffectiveMonthly(plan, cycle);
  const color = PLAN_COLORS[plan.id];
  const accent = PLAN_ACCENTS[plan.id];
  const savings = pricingService.getYearlySavingsPct(plan);

  return (
    <div
      className={`group relative flex flex-col rounded-card border p-6 transition duration-300 hover:-translate-y-1 ${
        plan.highlighted
          ? "border-gold/40 bg-gradient-to-b from-gold/10 to-transparent shadow-raised"
          : "border-border bg-ink-2 hover:border-border"
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-control bg-gold px-3 py-1 text-xs font-semibold text-ink shadow">
          Most Popular
        </span>
      )}

      <div
        className={`mb-4 inline-flex w-fit rounded-control bg-gradient-to-br ${accent} px-3 py-1`}
      >
        <span
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color }}
        >
          {plan.name}
        </span>
      </div>

      <p className="text-sm text-text-2">{plan.description}</p>

      <div className="mt-5 flex items-end gap-1">
        <span className="text-4xl font-bold text-text">
          {pricingService.formatPrice(price)}
        </span>
        <span className="mb-1 text-sm text-text-3">/mo</span>
      </div>
      {cycle === "yearly" && plan.priceMonthly > 0 && (
        <p className="mt-1 text-xs font-medium text-success">
          Save {savings}% billed yearly
        </p>
      )}
      {cycle === "yearly" && plan.priceYearly > 0 && (
        <p className="mt-1 text-xs text-text-3">
          {pricingService.formatPrice(plan.priceYearly)} / year
        </p>
      )}

      <Button
        onClick={() => onSelect?.(plan.id)}
        disabled={isCurrent}
        variant={isCurrent ? "ghost" : plan.highlighted ? "primary" : "secondary"}
        className="mt-6"
        fullWidth
      >
        {isCurrent ? "Current Plan" : "Choose " + plan.name}
      </Button>

      <ul className="mt-6 space-y-2.5">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-text-2">
            <span
              className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold"
              style={{ backgroundColor: color + "22", color }}
            >
              ✓
            </span>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
