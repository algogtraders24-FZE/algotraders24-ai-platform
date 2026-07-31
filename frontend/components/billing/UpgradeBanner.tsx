"use client";
// components/billing/UpgradeBanner.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto tokens: the sky/violet gradient becomes a
// gold-tinted glow (the platform's real accent), and the white CTA button
// becomes Button's primary (gold) variant.
import type { Plan, PlanId } from "@/types/billing";
import { PLAN_COLORS } from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";
import Button from "@/components/ui/Button";

interface Props {
  nextPlan: Plan | null;
  onUpgrade?: (planId: PlanId) => void;
}

export default function UpgradeBanner({ nextPlan, onUpgrade }: Props) {
  if (!nextPlan) return null;

  const color = PLAN_COLORS[nextPlan.id];
  const price = pricingService.formatPrice(nextPlan.priceMonthly);

  return (
    <div className="relative overflow-hidden rounded-card border border-border bg-gradient-to-r from-gold/10 via-gold/5 to-transparent p-6">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
        style={{ backgroundColor: color + "33" }}
      />
      <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-3">
            Level Up
          </p>
          <h3 className="mt-1 text-lg font-semibold text-text">
            Unlock more with{" "}
            <span style={{ color }}>{nextPlan.name}</span>
          </h3>
          <p className="mt-1 text-sm text-text-2">
            {nextPlan.aiCredits.toLocaleString()} credits, {nextPlan.maxAgents}{" "}
            agents, and more — from {price}/mo.
          </p>
        </div>
        <Button onClick={() => onUpgrade?.(nextPlan.id)} className="flex-none">
          Upgrade to {nextPlan.name}
        </Button>
      </div>
    </div>
  );
}
