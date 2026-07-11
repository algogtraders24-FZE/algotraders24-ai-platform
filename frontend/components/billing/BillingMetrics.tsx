"use client";
// components/billing/BillingMetrics.tsx
// Sprint 13A — Subscription & Billing Foundation

import { useEffect, useState } from "react";
import type { BillingMetrics as Metrics } from "@/types/billing";
import {
  PLAN_LABELS,
  PLAN_COLORS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_COLORS,
} from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";

interface Props {
  metrics: Metrics;
}

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function StatCard({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur transition hover:border-white/20 hover:bg-white/[0.07]">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <div
        className="mt-2 text-2xl font-semibold text-white"
        style={accent ? { color: accent } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export default function BillingMetrics({ metrics }: Props) {
  const credits = useCountUp(metrics.creditsRemaining);
  const storagePct =
    metrics.storageLimitMb > 0
      ? Math.round((metrics.storageUsedMb / metrics.storageLimitMb) * 100)
      : 0;
  const api = useCountUp(metrics.apiUsagePct);
  const invoices = useCountUp(metrics.invoiceCount);
  const renewal = new Date(metrics.renewalDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="Current Plan" accent={PLAN_COLORS[metrics.currentPlanId]}>
        {PLAN_LABELS[metrics.currentPlanId]}
      </StatCard>

      <StatCard label="Monthly Cost">
        {pricingService.formatPrice(metrics.monthlyCost)}
      </StatCard>

      <StatCard label="Credits Remaining">
        {Math.round(credits).toLocaleString()}
        <span className="ml-1 text-sm text-slate-500">
          / {metrics.creditsTotal.toLocaleString()}
        </span>
      </StatCard>

      <StatCard label="Renewal Date">
        <span className="text-xl">{renewal}</span>
      </StatCard>

      <StatCard label="Storage Used">
        {storagePct}%
        <span className="ml-1 text-sm text-slate-500">
          {metrics.storageUsedMb.toLocaleString()} MB
        </span>
      </StatCard>

      <StatCard label="API Usage">{Math.round(api)}%</StatCard>

      <StatCard label="Invoices">{Math.round(invoices)}</StatCard>

      <StatCard
        label="Active Subscription"
        accent={SUBSCRIPTION_STATUS_COLORS[metrics.subscriptionStatus]}
      >
        <span className="text-xl">
          {SUBSCRIPTION_STATUS_LABELS[metrics.subscriptionStatus]}
        </span>
      </StatCard>
    </div>
  );
}
