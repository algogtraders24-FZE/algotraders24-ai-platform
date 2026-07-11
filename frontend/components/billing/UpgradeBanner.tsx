"use client";
// components/billing/UpgradeBanner.tsx
// Sprint 13A — Subscription & Billing Foundation

import type { Plan, PlanId } from "@/types/billing";
import { PLAN_COLORS } from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";

interface Props {
  nextPlan: Plan | null;
  onUpgrade?: (planId: PlanId) => void;
}

export default function UpgradeBanner({ nextPlan, onUpgrade }: Props) {
  if (!nextPlan) return null;

  const color = PLAN_COLORS[nextPlan.id];
  const price = pricingService.formatPrice(nextPlan.priceMonthly);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-sky-500/10 via-violet-500/10 to-transparent p-6 backdrop-blur">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
        style={{ backgroundColor: color + "33" }}
      />
      <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Level Up
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">
            Unlock more with{" "}
            <span style={{ color }}>{nextPlan.name}</span>
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {nextPlan.aiCredits.toLocaleString()} credits, {nextPlan.maxAgents}{" "}
            agents, and more — from {price}/mo.
          </p>
        </div>
        <button
          onClick={() => onUpgrade?.(nextPlan.id)}
          className="flex-none rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
        >
          Upgrade to {nextPlan.name}
        </button>
      </div>
    </div>
  );
}
