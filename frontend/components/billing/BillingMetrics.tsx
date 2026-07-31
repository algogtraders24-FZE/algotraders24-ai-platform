"use client";
// components/billing/BillingMetrics.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto Card + tokens (bg-white/5 backdrop-blur
// "glass" chrome, a third visual language distinct from both the homepage
// and the rest of the dashboard, and slate-400/500 text -> ink-2/text-2/
// text-3). Per-plan/status accent colors (PLAN_COLORS,
// SUBSCRIPTION_STATUS_COLORS) are left as-is - real product-tier/status
// branding data, not chrome.
import { useEffect, useState } from "react";
import type { BillingMetrics as Metrics } from "@/types/billing";
import {
  PLAN_LABELS,
  PLAN_COLORS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_COLORS,
} from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";
import Card from "@/components/ui/Card";

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
    <Card padding="sm" className="transition hover:border-gold/30">
      <p className="text-xs font-medium uppercase tracking-wider text-text-3">
        {label}
      </p>
      <div
        className="mt-2 text-2xl font-semibold text-text"
        style={accent ? { color: accent } : undefined}
      >
        {children}
      </div>
    </Card>
  );
}

export default function BillingMetrics({ metrics }: Props) {
  const credits = useCountUp(metrics.creditsRemaining);
  const storagePct =
    metrics.storageLimitMb > 0
      ? Math.round((metrics.storageUsedMb / metrics.storageLimitMb) * 100)
      : 0;
  const conversations = useCountUp(metrics.conversationCount);
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
        <span className="ml-1 text-sm text-text-3">
          / {metrics.creditsTotal.toLocaleString()}
        </span>
      </StatCard>

      <StatCard label="Renewal Date">
        <span className="text-xl">
          {metrics.cancelAtPeriodEnd ? "Cancels " + renewal : renewal}
        </span>
      </StatCard>

      <StatCard label="Storage Used">
        {storagePct}%
        <span className="ml-1 text-sm text-text-3">
          {metrics.storageUsedMb.toLocaleString()} MB
        </span>
      </StatCard>

      <StatCard label="Conversations">{Math.round(conversations)}</StatCard>

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
