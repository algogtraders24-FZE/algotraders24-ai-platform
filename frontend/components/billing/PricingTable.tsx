"use client";
// components/billing/PricingTable.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto tokens (bg-sky-500 active toggle -> gold,
// bg-white/5 chrome -> ink-2/border).
import { useState } from "react";
import type { Plan, BillingCycle, PlanId } from "@/types/billing";
import { BILLING_CYCLE_LABELS, YEARLY_DISCOUNT_PCT } from "@/config/billing.config";
import PlanCard from "./PlanCard";

interface Props {
  plans: Plan[];
  currentPlanId: PlanId;
  onSelectPlan?: (planId: PlanId) => void;
}

export default function PricingTable({
  plans,
  currentPlanId,
  onSelectPlan,
}: Props) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  const cycles: BillingCycle[] = ["monthly", "yearly"];

  return (
    <div>
      <div className="mb-6 flex items-center justify-center">
        <div className="inline-flex rounded-control border border-border bg-ink-2 p-1">
          {cycles.map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`relative rounded-control px-4 py-2 text-sm font-medium transition ${
                cycle === c
                  ? "bg-gold text-ink shadow"
                  : "text-text-3 hover:text-text"
              }`}
            >
              {BILLING_CYCLE_LABELS[c]}
              {c === "yearly" && (
                <span className="ml-2 rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold text-success">
                  -{YEARLY_DISCOUNT_PCT}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            cycle={cycle}
            currentPlanId={currentPlanId}
            onSelect={onSelectPlan}
          />
        ))}
      </div>
    </div>
  );
}
