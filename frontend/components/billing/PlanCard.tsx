"use client";
// components/billing/PlanCard.tsx
// Sprint 13A — Subscription & Billing Foundation

import type { Plan, BillingCycle, PlanId } from "@/types/billing";
import { PLAN_COLORS, PLAN_ACCENTS } from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";

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
      className={`group relative flex flex-col rounded-2xl border p-6 backdrop-blur transition duration-300 hover:-translate-y-1 ${
        plan.highlighted
          ? "border-sky-400/40 bg-gradient-to-b from-sky-500/10 to-transparent shadow-lg shadow-sky-500/10"
          : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white shadow">
          Most Popular
        </span>
      )}

      <div
        className={`mb-4 inline-flex w-fit rounded-lg bg-gradient-to-br ${accent} px-3 py-1`}
      >
        <span
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color }}
        >
          {plan.name}
        </span>
      </div>

      <p className="text-sm text-slate-400">{plan.description}</p>

      <div className="mt-5 flex items-end gap-1">
        <span className="text-4xl font-bold text-white">
          {pricingService.formatPrice(price)}
        </span>
        <span className="mb-1 text-sm text-slate-500">/mo</span>
      </div>
      {cycle === "yearly" && plan.priceMonthly > 0 && (
        <p className="mt-1 text-xs font-medium text-emerald-400">
          Save {savings}% billed yearly
        </p>
      )}
      {cycle === "yearly" && plan.priceYearly > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {pricingService.formatPrice(plan.priceYearly)} / year
        </p>
      )}

      <button
        onClick={() => onSelect?.(plan.id)}
        disabled={isCurrent}
        className={`mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
          isCurrent
            ? "cursor-default border border-white/10 bg-white/5 text-slate-400"
            : plan.highlighted
              ? "bg-sky-500 text-white hover:bg-sky-400"
              : "border border-white/15 bg-white/5 text-white hover:bg-white/10"
        }`}
      >
        {isCurrent ? "Current Plan" : "Choose " + plan.name}
      </button>

      <ul className="mt-6 space-y-2.5">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
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
