"use client";
// components/billing/PricingTable.tsx
// Sprint 13A — Subscription & Billing Foundation

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
        <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
          {cycles.map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`relative rounded-lg px-4 py-2 text-sm font-medium transition ${
                cycle === c
                  ? "bg-sky-500 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {BILLING_CYCLE_LABELS[c]}
              {c === "yearly" && (
                <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
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
